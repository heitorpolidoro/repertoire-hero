/**
 * RH-122 — the `albums` and `song_versions` upsert that hangs off the one
 * catalog identity resolution.
 *
 * `src/lib/songIdentity.ts` resolves the `songs` row and hands back the right
 * half of the title split as `label`. This module turns that label plus the
 * incoming album into the two rows the restructured catalog needs, and it lives
 * in its own module for two reasons: `src/lib/songs.ts` is pinned at a
 * `max-lines` ceiling it cannot grow past (AGENTS.md §Complexity budgets), and
 * both write paths — manual entry and the Spotify import — need the identical
 * pair of statements, which inline copies would hand straight to `jscpd`.
 *
 * Two rules worth stating, because each replaces something that was there:
 *
 *  - **The album name is stored raw.** The deleted album-name stripper existed
 *    to make album names collide so duplicates would merge. `albums` has a real
 *    identity key now — `(lower(artist), lower(name))` — and stripping
 *    `(30th Anniversary Super Deluxe Edition)` off a name would merge a
 *    genuinely separate release, with its own cover and its own date, into the
 *    standard album. The catalog has no delete path to undo that, so the
 *    stripper is gone and names arrive as the source reports them.
 *  - **The artist is in the album key.** Keying on the name alone merges
 *    Queen's *Greatest Hits* with Michael Jackson's into one row with one cover
 *    and one date. The artist is reduced through the resolver's own
 *    `primaryArtistName`, so the album's artist and `songs.artist` always agree.
 *
 * Both statements absorb an expected duplicate with `ON CONFLICT DO NOTHING`
 * and never by catching `23505`: inside a transaction a caught `23505` leaves
 * the transaction aborted and every later statement fails with `25P02`
 * (AGENTS.md §Transactions). `db` defaults to the pool and accepts a
 * transaction client; both production callers — `createAndAddSong` and
 * `findOrCreateSong` — pass their `withTransaction` client, which is what keeps
 * these two writes atomic with the catalog resolution they hang off. On the
 * pool they would not be: `pool.query` hands out a different connection per
 * statement, so a failure between the album and the version insert would leave
 * a committed `albums` row no version points at.
 */

import { pool, type Queryable } from '@/lib/db'
import {
  primaryArtistName,
  type ResolvedSongIdentity,
  type SongIdentityInput,
} from '@/lib/songIdentity'

/**
 * `ON CONFLICT DO NOTHING` in the bare form, which covers
 * `uq_albums_artist_name` without naming it. `RETURNING id` is empty exactly
 * when a concurrent caller won the index, which {@link lookupAlbum} then reads.
 */
const ALBUM_INSERT_SQL = `
    INSERT INTO albums (artist, name, cover_url)
    VALUES ($1, $2, $3)
    ON CONFLICT DO NOTHING
    RETURNING id
  `

/** Mirrors `uq_albums_artist_name` exactly: `lower()` on both columns. */
const ALBUM_LOOKUP_SQL = `
    SELECT id FROM albums
    WHERE LOWER(artist) = LOWER($1) AND LOWER(name) = LOWER($2)
    LIMIT 1
  `

/**
 * The version's own `ON CONFLICT DO NOTHING` arbitrates against
 * `uq_song_versions_identity`, which is declared `UNIQUE NULLS NOT DISTINCT
 * (song_id, album_id, label)` — a null label is the common case, and a plain
 * unique would let two unlabelled versions of one album both insert.
 *
 * Nothing reads the version's id yet (no screen is version-addressed until the
 * part that makes them so), so there is no `RETURNING` and no read-back here:
 * an id nobody consumes would be a statement issued for the reader's comfort.
 */
const VERSION_INSERT_SQL = `
    INSERT INTO song_versions (song_id, album_id, label, duration_seconds, key)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT DO NOTHING
  `

/** The `albums` row for `input`, or null when it carries no album name. */
async function upsertAlbum(input: SongIdentityInput, db: Queryable): Promise<string | null> {
  const name = input.album?.trim()
  if (!name) return null

  const artist = primaryArtistName(input.artist)
  const inserted = await db.query<{ id: string }>(ALBUM_INSERT_SQL, [
    artist,
    name,
    input.cover_url ?? null,
  ])
  const row = inserted.rows[0]
  if (row) return row.id

  // The insert was a no-op, so a concurrent caller owns the row. Reading it
  // back is what keeps the version pointed at a real release instead of at
  // null; if even that finds nothing the version is written album-less, which
  // the nullable `album_id` allows.
  const found = await db.query<{ id: string }>(ALBUM_LOOKUP_SQL, [artist, name])
  return found.rows[0]?.id ?? null
}

/**
 * Records the release and the recording for a catalog row just resolved.
 *
 * `song.label` is the right half of the same parse whose left half became
 * `songs.title`, so the suffix the title no longer carries is not lost — it
 * becomes this version's label.
 *
 * Idempotent: calling it twice for the same track leaves one `albums` row and
 * one `song_versions` row.
 */
export async function upsertAlbumAndVersion(
  song: ResolvedSongIdentity,
  input: SongIdentityInput,
  db: Queryable = pool,
): Promise<void> {
  const albumId = await upsertAlbum(input, db)

  await db.query<never>(VERSION_INSERT_SQL, [
    song.id,
    albumId,
    song.label,
    input.duration_seconds ?? null,
    input.standard_key ?? null,
  ])
}
