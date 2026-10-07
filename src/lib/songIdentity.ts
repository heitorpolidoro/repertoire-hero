/**
 * RH-95 — the one song-identity rule for the shared `songs` catalog.
 *
 * Two code paths used to disagree about what makes a catalog row unique:
 * `createAndAddSong` matched on (title, album) and `findOrCreateSong` on
 * (title, artist), so the same song arrived twice depending on which screen the
 * musician came in through. The rule in `docs/plans/repertoire-rework.md` is
 * `(lower(trim(primary artist)), lower(trim(split title)))` — album is *not*
 * in the key — and this module is the only place under `src` that resolves or
 * inserts a catalog row by it. `migrations/0009_unify_song_identity.sql` carries
 * the matching unique index, which is what makes the rule hold under
 * concurrency rather than just by convention.
 *
 * Album deliberately stays out of the key, and now that `song_versions` exists
 * (RH-122) that is no longer a compromise: two takes of the same song by the
 * same artist are one catalog row with two versions. `resolveOrCreateSongIdentity`
 * still never writes to a row it merely found — the first-entered album, cover
 * and duration represent the song for everyone until reads move onto versions.
 *
 * RH-122 changed exactly one thing in here: the title normaliser. The identity
 * pair, the album-less key and the primary-artist rule are untouched, but the
 * title is no longer *stripped* by the deleted sanitizer — it is **split** by
 * `src/lib/songTitle.ts`. The left half is the identity title and
 * the right half is handed back to the caller as `label`, so the suffix
 * `"Bad - Remaster 2012"` carries is recorded on `song_versions` instead of
 * being discarded. One parse, both keys: `src/lib/songVersions.ts` writes the
 * second one from this module's answer.
 */

import { pool, type Queryable } from '@/lib/db'
import type { SongLinksRow } from '@/lib/dbRows'
import { dedupeLinksByUrl, songLinkInsertRows, songLinksJson } from '@/lib/songLinksSql'
import { splitSongTitle } from '@/lib/songTitle'
import type { SongLink } from '@/types/database'

/**
 * The normalised identity of an incoming title: the pair a catalog row is
 * resolved by, plus the version `label` the very same parse produced. The label
 * is carried here rather than re-derived so there is exactly one parse per
 * write — re-splitting at the version upsert is how the two keys would drift.
 */
export interface SongIdentity {
  title: string
  artist: string
  label: string | null
}

/** What the caller supplies to resolve a row, and to seed it when it is absent. */
export interface SongIdentityInput {
  title: string
  artist: string
  album?: string | null
  standard_key?: string | null
  cover_url?: string | null
  duration_seconds?: number | null
  links?: SongLink[]
}

/**
 * The resolved catalog row. `links` is the row's current link array — the
 * Spotify path needs it to append its track link — and `created` says whether
 * this call is the one that inserted the row, so a caller can tell "already
 * seeded" from "found an existing row".
 */
export interface ResolvedSongIdentity {
  id: string
  links: SongLink[]
  created: boolean
  /**
   * The right half of the title split, for the caller to write to
   * `song_versions.label` (`src/lib/songVersions.ts`). Null when the incoming
   * title carried no `" - "` suffix.
   */
  label: string | null
}

/**
 * The first name of a Spotify track's `artists` array, which is the rule stated
 * in `docs/plans/repertoire-rework.md` §Song identity: a feature credit belongs
 * to the recording, not to the song's identity, so `["Michael Jackson", "Akon"]`
 * is a Michael Jackson song. Shared by both ingestion points
 * (`fetchAllSpotifyTracks` and `/api/spotify/search`) so they cannot drift.
 */
export function primarySpotifyArtist(artists: Array<{ name: string }>): string {
  return artists[0]?.name?.trim() ?? ''
}

/**
 * The primary artist of a free-text artist field. The only join this codebase
 * ever produced is `', '` (the old `artists.map(...).join(', ')`), so a comma is
 * the one separator worth honouring — `&` is left alone precisely because
 * "Hall & Oates" and "Simon & Garfunkel" are single artists.
 *
 * Known cost: a legitimately comma-bearing name ("Earth, Wind & Fire") reduces
 * to its first segment. It is the same trade the plan accepts for `artists[0]`,
 * and it stays consistent between lookup and insert — the stored `artist` is the
 * reduced one, so the row and the unique index always agree.
 */
export function primaryArtistName(artist: string): string {
  const [primary] = artist.split(',')
  return primary.trim() || artist.trim()
}

/**
 * Split title + primary artist + version label, all trimmed. Case folding
 * happens in SQL, against `uq_songs_artist_title`.
 */
export function songIdentityOf(title: string, artist: string): SongIdentity {
  const split = splitSongTitle(title)
  return { title: split.title, artist: primaryArtistName(artist), label: split.label }
}

/**
 * Mirrors `uq_songs_artist_title` exactly: `lower(btrim(...))` on both
 * columns. Any drift between this predicate and the index would hand back "no
 * row" for a row the insert below then cannot create.
 */
const LOOKUP_SQL = `
    SELECT s.id, ${songLinksJson('s')} AS links FROM songs s
    WHERE LOWER(BTRIM(title)) = LOWER(BTRIM($1)) AND LOWER(BTRIM(artist)) = LOWER(BTRIM($2))
    LIMIT 1
  `

/**
 * `ON CONFLICT DO NOTHING` in the bare form — it covers `uq_songs_artist_title`
 * without naming it — and never a caught 23505: inside a transaction a caught
 * 23505 leaves the transaction aborted, so every later statement fails with
 * 25P02 (AGENTS.md §Transactions).
 *
 * RH-136 took `links` out of the column list and out of `RETURNING`: a link is
 * a `song_links` row now, written by {@link insertCreatedSongLinks} right after
 * this statement returns the row it created.
 */
const INSERT_SQL = `
    INSERT INTO songs (title, artist, album, standard_key, cover_url, duration_seconds)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT DO NOTHING
    RETURNING id
  `

/**
 * The create path's links, as `song_links` rows in input order.
 *
 * The conflict policy below is `DO NOTHING`, because a create has nothing to
 * overwrite: the only conflict reachable is a concurrent writer or the bridge
 * trigger, and either row already carries the same url. Not `DO UPDATE`, so no
 * re-assertion of `position` belongs here — `DO NOTHING` leaves an existing
 * row entirely alone, which is what *refuse rather than overwrite* means at this
 * writer.
 *
 * `dedupeLinksByUrl` is mandatory rather than defensive: an input array holding
 * the same url twice would raise 23505 and abort the **caller's** transaction,
 * the trap {@link INSERT_SQL} already documents for itself.
 *
 * Returns the deduplicated array, which is what the caller reports as the
 * created row's links — the rows that were just written.
 */
async function insertCreatedSongLinks(
  songId: string,
  links: SongLink[],
  db: Queryable,
): Promise<SongLink[]> {
  const deduped = dedupeLinksByUrl(links)
  const rows = songLinkInsertRows(songId, deduped)
  if (rows.count === 0) return deduped
  await db.query<never>(
    `INSERT INTO song_links (song_id, url, label, position)
     VALUES ${rows.values}
     ON CONFLICT (song_id, url) DO NOTHING`,
    rows.params,
  )
  return deduped
}

async function lookupSongIdentity(
  identity: SongIdentity,
  db: Queryable,
): Promise<ResolvedSongIdentity | null> {
  const res = await db.query<SongLinksRow>(LOOKUP_SQL, [identity.title, identity.artist])
  const row = res.rows[0]
  return row ? { id: row.id, links: row.links ?? [], created: false, label: identity.label } : null
}

/**
 * Resolves the catalog row for an identity, creating it when absent. The single
 * entry point for both UI paths, so they can no longer disagree.
 *
 * `db` defaults to the pool; pass a transaction client to make the resolution
 * part of the caller's transaction (which is what `createAndAddSong` does, so a
 * later failure cannot leave an orphan catalog row behind).
 *
 * Found rows are returned untouched: no write to an already-set field, ever.
 */
export async function resolveOrCreateSongIdentity(
  input: SongIdentityInput,
  db: Queryable = pool,
): Promise<ResolvedSongIdentity> {
  const identity = songIdentityOf(input.title, input.artist)

  const existing = await lookupSongIdentity(identity, db)
  if (existing) return existing

  const inserted = await db.query<{ id: string }>(INSERT_SQL, [
    identity.title,
    identity.artist,
    // Raw, only trimmed: RH-122 deleted the album-name stripper because
    // `albums` has a real identity key now, and stripping an edition off a name
    // would merge two genuinely separate releases with no delete path back.
    input.album?.trim() || null,
    input.standard_key ?? null,
    input.cover_url ?? null,
    input.duration_seconds ?? null,
  ])
  const row = inserted.rows[0]
  if (row) {
    // Only when the insert actually returned a row: its own `ON CONFLICT DO
    // NOTHING` returns none when a concurrent caller won
    // `uq_songs_artist_title`, and the re-lookup below is a *found* row, which
    // writes nothing.
    const links = await insertCreatedSongLinks(row.id, input.links ?? [], db)
    return { id: row.id, links, created: true, label: identity.label }
  }

  // A concurrent caller won the unique index, so the insert above was a no-op
  // instead of a 23505. Their row is committed by the time the wait ends.
  const raced = await lookupSongIdentity(identity, db)
  if (!raced) throw new Error('Failed to resolve song identity: the catalog row vanished mid-insert')
  return raced
}
