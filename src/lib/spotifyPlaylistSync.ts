/**
 * Shared Spotify playlist helpers used by the import, sync and tracks route
 * handlers. Moved here verbatim from
 * `src/app/api/spotify/playlists/[id]/import/route.ts` so the three routes stop
 * carrying their own copies.
 *
 * The thrown messages stay plain (not the `L1` log-then-wrap form): the callers
 * are route handlers whose `R1` catch already logs with the route tag and
 * answers with a fixed, user-facing message.
 */

import { pool, query, type Queryable } from '@/lib/db'
import type { GlobalSongLinksRow } from '@/lib/dbRows'
import { sanitizeSongTitle, sanitizeAlbumName } from '@/lib/songSanitizer'

export interface SpotifyRawTrack {
  spotifyTrackId: string
  title: string
  artist: string
  album: string | null
  albumArt: string | null
  spotifyUrl: string
  durationSeconds: number | null
}

interface SpotifyTracksPage {
  items: Array<{
    track: {
      id: string
      name: string
      duration_ms: number
      artists: Array<{ name: string }>
      album: { name: string; images: Array<{ url: string }> }
      external_urls: { spotify: string }
    } | null
  }>
  next: string | null
}

// ---------------------------------------------------------------------------
// Paginate through all tracks for a Spotify playlist.
// ---------------------------------------------------------------------------
export async function fetchAllSpotifyTracks(
  playlistId: string,
  accessToken: string
): Promise<SpotifyRawTrack[]> {
  const tracks: SpotifyRawTrack[] = []
  let url: string | null =
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`

  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      throw new Error(`Spotify tracks fetch failed: ${response.status}`)
    }

    const page = (await response.json()) as SpotifyTracksPage

    for (const item of page.items) {
      // Local tracks and podcast episodes have a null track field — skip them.
      if (!item.track) continue
      tracks.push({
        spotifyTrackId: item.track.id,
        title: item.track.name,
        artist: item.track.artists.map((a) => a.name).join(', '),
        album: item.track.album?.name ?? null,
        albumArt: item.track.album?.images?.[0]?.url ?? null,
        spotifyUrl: item.track.external_urls.spotify,
        durationSeconds: item.track.duration_ms ? Math.round(item.track.duration_ms / 1000) : null,
      })
    }

    url = page.next
  }

  return tracks
}

// ---------------------------------------------------------------------------
// Find an existing global_song by title+artist (sanitized) or create it.
// Returns the song id.
// ---------------------------------------------------------------------------
export async function findOrCreateGlobalSong(track: SpotifyRawTrack): Promise<string> {
  const cleanTitle = sanitizeSongTitle(track.title)
  const cleanAlbum = sanitizeAlbumName(track.album)
  const fullTrackLabel = track.title.trim()
  const spotifyLink = { label: fullTrackLabel, url: track.spotifyUrl }

  const lookupSql = `
    SELECT id, links FROM global_songs 
    WHERE LOWER(title) = LOWER($1) AND LOWER(artist) = LOWER($2)
    LIMIT 1
  `
  const { rows } = await query<GlobalSongLinksRow>(lookupSql, [cleanTitle, track.artist.trim()])

  if (rows.length > 0) {
    const existingSongId = rows[0].id
    const existingLinks = rows[0].links ?? []

    if (!existingLinks.some((l) => l.url === track.spotifyUrl)) {
      const updatedLinks = [...existingLinks, spotifyLink]
      await query<never>('UPDATE global_songs SET links = $1 WHERE id = $2', [
        JSON.stringify(updatedLinks),
        existingSongId,
      ])
    }
    return existingSongId
  }

  const insertSql = `
    INSERT INTO global_songs (title, artist, album, cover_url, duration_seconds, links)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `
  const insertRes = await query<{ id: string }>(insertSql, [
    cleanTitle,
    track.artist.trim(),
    cleanAlbum || null,
    track.albumArt ?? null,
    track.durationSeconds,
    JSON.stringify([spotifyLink]),
  ])
  return insertRes.rows[0].id
}

// ---------------------------------------------------------------------------
// Ensures the song is in the owner's repertoire. Safe to call multiple times.
//
// Set-based on purpose (RH-36, finding F19): the previous shape ran a lookup
// and possibly an insert per band member — 3 + 2N statements per track, inside
// the per-track loop of the sync and import routes, on a pool capped at 10.
// The duplicates are absorbed by `ON CONFLICT DO NOTHING` (the bare form, which
// covers the partial unique indexes `uq_repertoire_user_song` and
// `uq_repertoire_band_song`) rather than by catching 23505: inside a
// transaction a caught 23505 leaves the transaction aborted, so every later
// statement fails with 25P02.
//
// `db` defaults to the pool; pass a transaction client to make the seeding part
// of a caller's transaction.
// ---------------------------------------------------------------------------
export async function ensureInRepertoire(
  songId: string,
  owner: { userId?: string; bandId?: string },
  db: Queryable = pool,
): Promise<void> {
  if (owner.bandId) {
    await db.query<never>(
      "INSERT INTO repertoire (band_id, song_id, status) VALUES ($1, $2, 'unknown') ON CONFLICT DO NOTHING",
      [owner.bandId, songId],
    )
    await db.query<never>(
      "INSERT INTO repertoire (user_id, song_id, status) SELECT bm.user_id, $1, 'unknown' FROM band_members bm WHERE bm.band_id = $2 ON CONFLICT DO NOTHING",
      [songId, owner.bandId],
    )
  } else if (owner.userId) {
    await db.query<never>(
      "INSERT INTO repertoire (user_id, song_id, status) VALUES ($1, $2, 'unknown') ON CONFLICT DO NOTHING",
      [owner.userId, songId],
    )
  }
}

// ---------------------------------------------------------------------------
// Builds the positional bulk insert of playlist songs: ($1, $2, $3), ($4, …
// Positions are 1-based and follow the order of `songIds`.
// ---------------------------------------------------------------------------
export function buildPlaylistSongsInsert(
  playlistId: string,
  songIds: string[]
): { sql: string; values: unknown[] } {
  const valueClauses: string[] = []
  const values: unknown[] = []
  let index = 1
  for (let i = 0; i < songIds.length; i++) {
    valueClauses.push(`($${index++}, $${index++}, $${index++})`)
    values.push(playlistId, songIds[i], i + 1)
  }
  const sql = `
        INSERT INTO playlist_songs (playlist_id, song_id, position)
        VALUES ${valueClauses.join(', ')}
      `
  return { sql, values }
}
