/**
 * RH-124 — the owner row's shapes: the projection every read selects, the one
 * fold that reads it, and the patch every write is built from.
 *
 * `@/lib/ownerSongs` holds the reads and the writes themselves; this module
 * holds the shapes they share. It is split out for the reason every split in this repository is:
 * `ownerSongs.ts` would otherwise sit above the 400-line budget, and the
 * complexity ratchet may only shrink (AGENTS.md F20) — no new override entry.
 * The line is a real one, not an arbitrary cut: nothing here issues a
 * statement, and `dbRows.ts` is the same kind of implementation detail of the
 * data layer.
 *
 * {@link LEVELS} selects the three levels' columns **raw and un-coalesced** and
 * {@link resolveRow} folds them through `resolveSongFields`. That pairing is
 * what keeps the cascade out of SQL: no query under `src/` may `COALESCE`
 * `lyrics`, `map`, `key` or `tuning` across levels, because a second
 * implementation cannot be kept in step with the first.
 */

import {
  resolveSongFields,
  type OwnerOverrides,
  type ResolvedSongFields,
} from '@/lib/songResolution'
import type { OwnerSongLevelsRow } from '@/lib/dbRows'
import type { Repertoire, ResolvedSongEntry, SongMap, SongStatus } from '@/types/database'

/** Which hat the caller is wearing: their own, or a band's. */
export type RepertoireOwner = { userId: string } | { bandId: string }

/** The seven columns an owner row owns — every override, plus `status`. */
export const OWNER_SONG_COLUMNS = ['status', 'key', 'tuning', 'lyrics', 'map', 'tags', 'last_practiced']

/** A patch of those seven. An omitted key is left untouched, not nulled. */
export interface OwnerSongPatch {
  status?: SongStatus
  key?: string | null
  tuning?: string | null
  lyrics?: string | null
  map?: SongMap | null
  tags?: string[]
  last_practiced?: string | null
}

export function ownerTable(owner: RepertoireOwner): 'user_songs' | 'band_songs' {
  return 'bandId' in owner ? 'band_songs' : 'user_songs'
}

export function ownerColumn(owner: RepertoireOwner): 'user_id' | 'band_id' {
  return 'bandId' in owner ? 'band_id' : 'user_id'
}

export function ownerId(owner: RepertoireOwner): string {
  return 'bandId' in owner ? owner.bandId : owner.userId
}

/** The joined `songs` row as JSON — the display shape every read returns. */
const SONG_JSON = `json_build_object(
             'id', s.id, 'title', s.title, 'artist', s.artist,
             'album', s.album, 'standard_key', s.standard_key,
             'cover_url', s.cover_url, 'duration_seconds', s.duration_seconds,
             'links', s.links, 'created_at', s.created_at
           ) AS song`

/**
 * The three levels, raw and un-coalesced, under the aliases `o` (owner row),
 * `v` (`song_versions`) and `s` (`songs`). Spelled once: this projection and
 * {@link resolveRow} are the one place the cascade is read.
 */
export const LEVELS = `o.id AS owner_row_id, o.status AS owner_status,
           o.key AS owner_key, o.tuning AS owner_tuning,
           o.lyrics AS owner_lyrics, o.map AS owner_map,
           o.tags AS owner_tags, o.last_practiced AS owner_last_practiced,
           v.id AS version_id, v.song_id,
           v.key AS version_key, v.tuning AS version_tuning,
           v.lyrics AS version_lyrics, v.map AS version_map,
           s.lyrics AS song_lyrics, s.map AS song_map,
           ${SONG_JSON}`

/** The owner level, or `null` when the `LEFT JOIN` found no row. */
function ownerLevel(row: OwnerSongLevelsRow): OwnerOverrides | null {
  if (row.owner_row_id === null) return null
  return {
    status: row.owner_status,
    key: row.owner_key,
    tuning: row.owner_tuning,
    lyrics: row.owner_lyrics,
    map: row.owner_map,
    tags: row.owner_tags ?? [],
    last_practiced: row.owner_last_practiced,
  }
}

/** The one fold. Nothing here resolves a field any other way. */
function resolveRow(row: OwnerSongLevelsRow): ResolvedSongFields {
  return resolveSongFields({
    owner: ownerLevel(row),
    version: {
      key: row.version_key,
      tuning: row.version_tuning,
      lyrics: row.version_lyrics,
      map: row.version_map,
    },
    song: { lyrics: row.song_lyrics, map: row.song_map },
  })
}

/**
 * A located owner row as the screens consume it. Only ever called for a row
 * that exists, which is why `id` is not null and `status` needs no fallback —
 * the column is `NOT NULL DEFAULT 'unknown'`.
 */
export function toEntry(row: OwnerSongLevelsRow, owner: RepertoireOwner): Repertoire {
  const fields = resolveRow(row)
  const isBand = 'bandId' in owner
  return {
    id: row.owner_row_id as string,
    user_id: isBand ? null : owner.userId,
    band_id: isBand ? owner.bandId : null,
    song_id: row.song_id,
    version_id: row.version_id,
    key: fields.key,
    tuning: fields.tuning,
    status: fields.status ?? 'unknown',
    tags: fields.tags,
    last_practiced: fields.last_practiced,
    lyrics: fields.lyrics,
    map: fields.map,
    song: row.song,
  }
}

/** `FROM <owner table> o JOIN song_versions v JOIN songs s`, for a located row. */
export function entryFrom(owner: RepertoireOwner): string {
  return `FROM ${ownerTable(owner)} o
    JOIN song_versions v ON v.id = o.version_id
    JOIN songs s ON s.id = v.song_id`
}

/**
 * A `(owner, version)` pair resolved whether or not the owner holds a row: the
 * `LEFT JOIN` form of the same projection, so `ownerRowId`, `status`, `tags` and
 * `last_practiced` all read as absent rather than as an error (RH-124 ER12).
 */
export function toResolvedEntry(row: OwnerSongLevelsRow): ResolvedSongEntry {
  return {
    ownerRowId: row.owner_row_id,
    version_id: row.version_id,
    song_id: row.song_id,
    ...resolveRow(row),
    song: row.song,
  }
}
