/**
 * RH-95 — the one song-identity rule for the shared `songs` catalog.
 *
 * Two code paths used to disagree about what makes a catalog row unique:
 * `createAndAddSong` matched on (title, album) and `findOrCreateSong` on
 * (title, artist), so the same song arrived twice depending on which screen the
 * musician came in through. The rule in `docs/plans/repertoire-rework.md` is
 * `(lower(trim(primary artist)), lower(trim(sanitized title)))` — album is *not*
 * in the key — and this module is the only place under `src` that resolves or
 * inserts a catalog row by it. `migrations/0009_unify_song_identity.sql` carries
 * the matching unique index, which is what makes the rule hold under
 * concurrency rather than just by convention.
 *
 * Album deliberately stays out of the key: two takes of the same song by the
 * same artist are one catalog row until `song_versions` exists (RH-105), and the
 * consequence accepted meanwhile is that the first-entered album, cover and
 * duration represent the song for everyone. Hence `resolveOrCreateSongIdentity`
 * never writes to a row it merely found.
 *
 * Title *splitting* (`" - Live"` → a version label) is explicitly not here: on
 * the current schema there is nowhere to put the right-hand half, so splitting
 * would merge the live, acoustic and remix takes into one row. `sanitizeSongTitle`
 * only strips remaster/edition noise, which is reversible information.
 */

import { pool, type Queryable } from '@/lib/db'
import type { SongLinksRow } from '@/lib/dbRows'
import { sanitizeAlbumName, sanitizeSongTitle } from '@/lib/songSanitizer'
import type { SongLink } from '@/types/database'

/** The normalised pair a catalog row is resolved by. */
export interface SongIdentity {
  title: string
  artist: string
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

/** Sanitized title + primary artist, trimmed. Case folding happens in SQL. */
export function songIdentityOf(title: string, artist: string): SongIdentity {
  return { title: sanitizeSongTitle(title).trim(), artist: primaryArtistName(artist) }
}

/**
 * Mirrors `uq_songs_artist_title` exactly: `lower(btrim(...))` on both
 * columns. Any drift between this predicate and the index would hand back "no
 * row" for a row the insert below then cannot create.
 */
const LOOKUP_SQL = `
    SELECT id, links FROM songs
    WHERE LOWER(BTRIM(title)) = LOWER(BTRIM($1)) AND LOWER(BTRIM(artist)) = LOWER(BTRIM($2))
    LIMIT 1
  `

/**
 * `ON CONFLICT DO NOTHING` in the bare form — it covers `uq_songs_artist_title`
 * without naming it — and never a caught 23505: inside a transaction a caught
 * 23505 leaves the transaction aborted, so every later statement fails with
 * 25P02 (AGENTS.md §Transactions).
 */
const INSERT_SQL = `
    INSERT INTO songs (title, artist, album, standard_key, cover_url, duration_seconds, links)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT DO NOTHING
    RETURNING id, links
  `

async function lookupSongIdentity(
  identity: SongIdentity,
  db: Queryable,
): Promise<ResolvedSongIdentity | null> {
  const res = await db.query<SongLinksRow>(LOOKUP_SQL, [identity.title, identity.artist])
  const row = res.rows[0]
  return row ? { id: row.id, links: row.links ?? [], created: false } : null
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

  const inserted = await db.query<SongLinksRow>(INSERT_SQL, [
    identity.title,
    identity.artist,
    sanitizeAlbumName(input.album),
    input.standard_key ?? null,
    input.cover_url ?? null,
    input.duration_seconds ?? null,
    JSON.stringify(input.links ?? []),
  ])
  const row = inserted.rows[0]
  if (row) return { id: row.id, links: row.links ?? [], created: true }

  // A concurrent caller won the unique index, so the insert above was a no-op
  // instead of a 23505. Their row is committed by the time the wait ends.
  const raced = await lookupSongIdentity(identity, db)
  if (!raced) throw new Error('Failed to resolve song identity: the catalog row vanished mid-insert')
  return raced
}
