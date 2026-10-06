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
 * `RETURNING id` since RH-125: `playlist_songs` names a version, so the Spotify
 * import's caller needs the id rather than re-deriving it from the song. Empty
 * exactly when a concurrent caller won the index, which {@link lookupVersion}
 * then reads — the same pair of statements the album above uses.
 */
const VERSION_INSERT_SQL = `
    INSERT INTO song_versions (song_id, album_id, label, duration_seconds, key)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT DO NOTHING
    RETURNING id
  `

/**
 * Mirrors `uq_song_versions_identity` exactly. Both nullable columns are
 * compared with `IS NOT DISTINCT FROM`, because that index is declared
 * `NULLS NOT DISTINCT`: plain `=` would never match the common unlabelled,
 * album-less row that the insert above had just refused as a duplicate.
 */
const VERSION_LOOKUP_SQL = `
    SELECT id FROM song_versions
    WHERE song_id = $1
      AND album_id IS NOT DISTINCT FROM $2
      AND label IS NOT DISTINCT FROM $3
    LIMIT 1
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
 * Records the release and the recording for a catalog row just resolved, and
 * answers **the version's id** (RH-125) so no caller has to re-derive it from
 * the song.
 *
 * `song.label` is the right half of the same parse whose left half became
 * `songs.title`, so the suffix the title no longer carries is not lost — it
 * becomes this version's label.
 *
 * Idempotent: calling it twice for the same track leaves one `albums` row and
 * one `song_versions` row, and answers the same id both times.
 */
export async function upsertAlbumAndVersion(
  song: ResolvedSongIdentity,
  input: SongIdentityInput,
  db: Queryable = pool,
): Promise<string> {
  const albumId = await upsertAlbum(input, db)
  const params = [song.id, albumId, song.label, input.duration_seconds ?? null, input.standard_key ?? null]

  const inserted = await db.query<{ id: string }>(VERSION_INSERT_SQL, params)
  const row = inserted.rows[0]
  if (row) return row.id

  // The insert was a no-op, so the row was already there — either from an
  // earlier import of the same track or from a concurrent caller. Reading it
  // back is what lets the playlist entry point at a real recording.
  const found = await db.query<{ id: string }>(VERSION_LOOKUP_SQL, params.slice(0, 3))
  const existing = found.rows[0]
  if (!existing) throw new Error('Failed to resolve the song version just written')
  return existing.id
}

/**
 * RH-124 — the representative-version sort, spelled once.
 *
 * Several paths hold a song id and need a version: the manual add, the catalog
 * search that feeds the song picker's collapsed cards, and
 * `getPersonalEntryForSong`'s "does this song sit in *my* repertoire?". The
 * playlist reads no longer do — RH-125 gave `playlist_songs` its own
 * `version_id`, which deleted both laterals there. They all pick the same
 * version, by this ordering: `album_type = 'album'` first, then the
 * earliest `albums.release_date`, then the earliest `song_versions.created_at`,
 * then `id`. The last two make it **total**, so two runs cannot disagree —
 * which is the whole point. It is a sort, never a stored column.
 *
 * Nulls sort last at every level, and the join onto `albums` must be a
 * `LEFT JOIN` wherever this ordering is used: `song_versions.album_id` is
 * nullable on purpose, so an inner join would silently drop every album-less
 * version. The two version-level tiebreakers keep the pick total even for a
 * song whose every version is album-less.
 *
 * `migrations/0016_split_repertoire_owner_songs.sql` carries the same ordering
 * in SQL, because a migration cannot import TypeScript; its header says so.
 *
 * Both aliases are supplied by the caller so the same text can be reused inside
 * a correlated subquery or a lateral, where `v`/`a` may already be taken. They
 * are SQL identifiers written by this module's callers, never by a user.
 */
export function representativeVersionOrder(version = 'v', album = 'a'): string {
  return (
    `(${album}.album_type = 'album') DESC NULLS LAST, ` +
    `${album}.release_date ASC NULLS LAST, ` +
    `${version}.created_at ASC, ${version}.id ASC`
  )
}

/**
 * A scalar subquery resolving the representative version of the song named by
 * `songIdSql` — a `$n` placeholder or a column reference, supplied by the
 * calling module and never by a caller's input.
 */
export function representativeVersionSubquery(songIdSql: string): string {
  return `(SELECT rv.id
             FROM song_versions rv
             LEFT JOIN albums ra ON ra.id = rv.album_id
            WHERE rv.song_id = ${songIdSql}
            ORDER BY ${representativeVersionOrder('rv', 'ra')}
            LIMIT 1)`
}

/**
 * Guarantees `songId` has at least one `song_versions` row, and is a no-op when
 * it already does.
 *
 * Needed because a catalog row can be created without going through
 * `upsertAlbumAndVersion`: `scripts/seed-catalog.sql` inserts `songs` rows
 * directly, after `migrations/0016`'s backfill has already run, and both
 * song-keyed add paths (`addSongToRepertoire`, the playlist-side seed) then
 * hold a song id whose representative version would be null — a `NOT NULL`
 * violation rather than a row.
 *
 * The projection mirrors `migrate_catalog_to_versions()` in `migrations/0014`
 * column for column — the label from the title split, the key from
 * `standard_key`, `tuning` / `lyrics` / `map` left null so the cascade walks up
 * — so a row born here and a row born in the backfill are the same row.
 *
 * `db` defaults to the pool; pass a transaction client to make it part of the
 * caller's transaction, which both callers do: the version and the hold on it
 * must land together.
 */
export async function ensureSongHasVersion(songId: string, db: Queryable = pool): Promise<void> {
  await db.query<never>(
    `INSERT INTO song_versions (song_id, album_id, label, duration_seconds, key)
     SELECT s.id, a.id, song_title_label(s.title), s.duration_seconds, s.standard_key
       FROM songs s
       LEFT JOIN albums a
         ON s.album IS NOT NULL AND btrim(s.album) <> ''
        AND LOWER(a.artist) = LOWER(s.artist) AND LOWER(a.name) = LOWER(s.album)
      WHERE s.id = $1
        AND NOT EXISTS (SELECT 1 FROM song_versions v WHERE v.song_id = s.id)
     ON CONFLICT DO NOTHING`,
    [songId],
  )
}
