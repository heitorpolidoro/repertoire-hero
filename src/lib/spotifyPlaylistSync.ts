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

import { pool, withTransaction, type Queryable } from '@/lib/db'
import { primarySpotifyArtist, resolveOrCreateSongIdentity } from '@/lib/songIdentity'
import { representativeVersionSubquery, upsertAlbumAndVersion } from '@/lib/songVersions'

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
        // RH-95: the *primary* artist, not the joined credit list — a feature
        // credit belongs to the recording, not to the song's identity.
        artist: primarySpotifyArtist(item.track.artists),
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
// Resolve the catalog row for a Spotify track, creating it when absent.
//
// RH-95: the identity rule itself lives in `@/lib/songIdentity` — the same one
// `createAndAddSong` uses, so the two paths converge on one row instead of
// disagreeing about what makes a song unique. What stays here is the only
// Spotify-specific part: appending the track's Spotify link to a row that was
// already in the catalog, deduplicated by exact URL. A found row's own fields
// are never rewritten.
//
// RH-122: the resolver splits the track name at its `" - "` and hands the right
// half back as `label`, so the same single parse feeds both keys —
// `upsertAlbumAndVersion` records the release under the raw album name (the
// name stripper is gone) and the recording under that label.
//
// The whole import of one track is one `withTransaction` (ER10): the catalog
// row, its album, its version and the link append either all land or none do.
// Without it each helper would default to `pool`, which hands out a different
// connection per statement, so a failure at the version insert would commit a
// `songs` row with no `song_versions` row — or an `albums` row orphaned by the
// failing version insert — and the catalog has no delete path to undo either.
// `transactionAtomicity.db.test.ts` has no bearing on that; it is the trigger
// test in `catalogVersions.db.test.ts` that pins it.
// ---------------------------------------------------------------------------
export async function findOrCreateSong(track: SpotifyRawTrack): Promise<string> {
  const spotifyLink = { label: track.title.trim(), url: track.spotifyUrl }

  // One input object, read by both the resolver and the version upsert, so the
  // album and cover they record cannot disagree.
  const input = {
    title: track.title,
    artist: track.artist,
    album: track.album,
    cover_url: track.albumArt,
    duration_seconds: track.durationSeconds,
    links: [spotifyLink],
  }

  return withTransaction(async (client) => {
    const song = await resolveOrCreateSongIdentity(input, client)
    await upsertAlbumAndVersion(song, input, client)

    if (!song.created && !song.links.some((l) => l.url === track.spotifyUrl)) {
      await client.query<never>('UPDATE songs SET links = $1, updated_at = now() WHERE id = $2', [
        JSON.stringify([...song.links, spotifyLink]),
        song.id,
      ])
    }

    return song.id
  })
}

// ---------------------------------------------------------------------------
// Ensures the song is in the owner's repertoire, against that song's
// representative version. Safe to call multiple times.
//
// Set-based on purpose (RH-36, finding F19): the previous shape ran a lookup
// and possibly an insert per band member — 3 + 2N statements per track, inside
// the per-track loop of the sync and import routes, on a pool capped at 10.
// The duplicates are absorbed by the bare `ON CONFLICT DO NOTHING`, which
// covers `uq_user_songs_user_version` / `uq_band_songs_band_version` without
// naming either, rather than by catching 23505: inside a transaction a caught
// 23505 leaves the transaction aborted, so every later statement fails with
// 25P02.
//
// No "does this song have a version?" guard is needed here, unlike in the two
// song-keyed add paths: both callers reach this through `findOrCreateSong`,
// which always upserts the album and the version first.
//
// **Who may call this is decided by the caller, not here** (RH-124): it takes a
// resolved owner and no caller id, so there is nothing for it to authorize
// against. Both entry points gate at their own guard — the import route's
// body-`band_id` check and the sync route's playlist check, both
// `assertBandAdmin` through `resolveBandOwnership`.
//
// The band branch's second statement — a row for **every** member — is the dual
// write RH-126 removes. It is repointed here, not deleted.
//
// `db` defaults to the pool; pass a transaction client to make the seeding part
// of a caller's transaction.
// ---------------------------------------------------------------------------
export async function ensureInRepertoire(
  songId: string,
  owner: { userId?: string; bandId?: string },
  db: Queryable = pool,
): Promise<void> {
  const version = representativeVersionSubquery('$2')
  if (owner.bandId) {
    await db.query<never>(
      `INSERT INTO band_songs (band_id, version_id, status)
       SELECT $1, ${version}, 'unknown' ON CONFLICT DO NOTHING`,
      [owner.bandId, songId],
    )
    await db.query<never>(
      `INSERT INTO user_songs (user_id, version_id, status)
       SELECT bm.user_id, ${representativeVersionSubquery('$1')}, 'unknown'
       FROM band_members bm WHERE bm.band_id = $2 ON CONFLICT DO NOTHING`,
      [songId, owner.bandId],
    )
  } else if (owner.userId) {
    await db.query<never>(
      `INSERT INTO user_songs (user_id, version_id, status)
       SELECT $1, ${version}, 'unknown' ON CONFLICT DO NOTHING`,
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
