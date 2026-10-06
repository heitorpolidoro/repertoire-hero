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
import { upsertAlbumAndVersion } from '@/lib/songVersions'

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
// RH-125: it answers **both** ids, because `playlist_songs` names a version
// now. Returning only the song id would make every caller re-derive the version
// through the representative-version ordering — which is exactly the pick this
// path does not want: two takes of one song differ by album or label, resolve
// to two `song_versions` rows under RH-122's identity, and must stay two
// entries in the setlist. The representative pick would collapse them to one.
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
export interface ResolvedSpotifySong {
  songId: string
  /** `song_versions.id` — what the playlist entry is written with. */
  versionId: string
}

export async function findOrCreateSong(track: SpotifyRawTrack): Promise<ResolvedSpotifySong> {
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
    const versionId = await upsertAlbumAndVersion(song, input, client)

    if (!song.created && !song.links.some((l) => l.url === track.spotifyUrl)) {
      await client.query<never>('UPDATE songs SET links = $1, updated_at = now() WHERE id = $2', [
        JSON.stringify([...song.links, spotifyLink]),
        song.id,
      ])
    }

    return { songId: song.id, versionId }
  })
}

// ---------------------------------------------------------------------------
// Ensures the owner holds the **version** the caller resolved. Safe to call
// multiple times.
//
// RH-125: it takes the version id rather than a song id, so the
// representative-version pick that used to stand here is gone. That pick was
// wrong for this path anyway — see `findOrCreateSong` above.
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
// No "does this song have a version?" guard is needed here, unlike in the
// song-keyed add path in `@/lib/ownerSongs`: both callers reach this through
// `findOrCreateSong`, which always upserts the album and the version first and
// hands back that version's id.
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
  versionId: string,
  owner: { userId?: string; bandId?: string },
  db: Queryable = pool,
): Promise<void> {
  if (owner.bandId) {
    await db.query<never>(
      `INSERT INTO band_songs (band_id, version_id, status)
       VALUES ($1, $2, 'unknown') ON CONFLICT DO NOTHING`,
      [owner.bandId, versionId],
    )
    await db.query<never>(
      `INSERT INTO user_songs (user_id, version_id, status)
       SELECT bm.user_id, $1, 'unknown'
       FROM band_members bm WHERE bm.band_id = $2 ON CONFLICT DO NOTHING`,
      [versionId, owner.bandId],
    )
  } else if (owner.userId) {
    await db.query<never>(
      `INSERT INTO user_songs (user_id, version_id, status)
       VALUES ($1, $2, 'unknown') ON CONFLICT DO NOTHING`,
      [owner.userId, versionId],
    )
  }
}

// ---------------------------------------------------------------------------
// The pull's dedup, **by version** (RH-125) — the single implementation.
//
// Two Spotify tracks that resolve to two versions of one song are two entries
// and both are kept, in the order the playlist gave them: that is what the
// re-key buys, because the old `uq_playlist_song (playlist_id, song_id)`
// refused the second one outright and failed the whole sync. The *same* track
// twice resolves to the *same* version and must contribute one entry, because
// `uq_playlist_song_version` refuses the repeat and `buildPlaylistSongsInsert`
// deliberately carries no `ON CONFLICT` clause to absorb it.
//
// It lives here rather than inline in the sync route because `src/app/api/**`
// is outside the coverage gate (AGENTS.md: "Extract the decisions out of a
// component ... and unit-test those instead"). A copy of this loop written into
// a test asserts only itself: deleting the route's dedup entirely used to leave
// the suite green.
// ---------------------------------------------------------------------------
export function dedupeVersionIds(versionIds: string[]): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const versionId of versionIds) {
    if (seen.has(versionId)) continue
    seen.add(versionId)
    ordered.push(versionId)
  }
  return ordered
}

// ---------------------------------------------------------------------------
// Builds the positional bulk insert of playlist entries: ($1, $2, $3), ($4, …
// Positions are 1-based and follow the order of `versionIds` (RH-125: versions,
// not songs).
//
// **It stays a bare positional insert with no `ON CONFLICT` clause.** An
// arbiter here would silently skip a duplicate row and leave a `position` gap
// behind it, and a duplicate add would stop raising — and there is nothing for
// one to absorb: the sync route `DELETE`s every row of the playlist inside the
// same transaction before re-inserting, and the import route creates the
// playlist a statement earlier.
// ---------------------------------------------------------------------------
export function buildPlaylistSongsInsert(
  playlistId: string,
  versionIds: string[]
): { sql: string; values: unknown[] } {
  const valueClauses: string[] = []
  const values: unknown[] = []
  let index = 1
  for (let i = 0; i < versionIds.length; i++) {
    valueClauses.push(`($${index++}, $${index++}, $${index++})`)
    values.push(playlistId, versionIds[i], i + 1)
  }
  const sql = `
        INSERT INTO playlist_songs (playlist_id, version_id, position)
        VALUES ${valueClauses.join(', ')}
      `
  return { sql, values }
}
