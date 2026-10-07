/**
 * RH-67 — the pure decisions behind the playlist add-song picker.
 *
 * `/playlists/[id]` used to take all of these inline: the two-character gate
 * before a search is issued, the filter that hides catalog rows already in the
 * playlist, the key that decides a Spotify track duplicates a catalog result,
 * the per-row error map, and the two halves of the catch that recovers a song
 * the repertoire already holds. They are decisions, not plumbing, so they live
 * here — no React, no fetch, no `pg` — and `useSongPicker` composes them.
 *
 * RH-108 moved the grouping half out. `pickerDedupKey`, `pickerCatalogKeys`,
 * `visiblePickerSpotify` and `visiblePickerCatalog` are gone: the first keyed
 * on the **raw** title, which is why one song drew two rows, and
 * `src/lib/songSearchMerge.ts` subsumes all four. What stays here is what was
 * never about grouping — the query gate, the error map, and the two halves of
 * the recovery catch.
 *
 * `SongPickerController` is declared here too, next to `SongStatusController`
 * in `songStatus.ts`, so `src/components/playlists` can type the panel without
 * importing `src/hooks`.
 */

import { songIdentityKey } from '@/lib/songTitle'
import type { SongSearchRow } from '@/lib/songSearchMerge'
import type { Repertoire } from '@/types/database'

/** Shortest query the picker will search for, counted after trimming. */
export const MIN_PICKER_QUERY_LENGTH = 2

/** A title/artist pair — all the dedup and lookup helpers need of either source. */
export interface PickerTrackName {
  title: string
  artist: string
}

/** The fallback shown under a row when the thrown value carries no message. */
const DEFAULT_ROW_ERROR = 'Failed to add'

/** The message `createAndAddSong` throws when the owner already has the song. */
const ALREADY_IN_REPERTOIRE = 'already in your repertoire'

/** True once the query is long enough to be worth a round trip. */
export function shouldSearchPicker(query: string): boolean {
  return query.trim().length >= MIN_PICKER_QUERY_LENGTH
}

/**
 * The version a merged row adds, or `null` when the repertoire write has to
 * resolve it first (RH-108, re-pointed from RH-125's collapsed card).
 *
 * Non-null exactly when the row's **representative candidate** names a version
 * the owner already holds: that is the one case where no `addToRepertoire`
 * round trip is needed. A row whose representative candidate is a Spotify one,
 * and a version-less catalog row, both answer `null` — `addSongToRepertoire`
 * is what gives such a song its first `song_versions` row.
 */
export function heldPickerVersionId(
  row: SongSearchRow,
  repertoire: ReadonlyMap<string, Repertoire>,
): string | null {
  const versionId = row.versions[0]?.versionId ?? null
  return versionId && repertoire.has(versionId) ? versionId : null
}

/**
 * The error map with `rowId`'s failure recorded. Only that row changes: a
 * failure under one result must leave every other row usable.
 */
export function withPickerRowError(
  errors: Readonly<Record<string, string>>,
  rowId: string,
  error: unknown,
): Record<string, string> {
  return {
    ...errors,
    [rowId]: error instanceof Error ? error.message : DEFAULT_ROW_ERROR,
  }
}

/** The error map with `rowId`'s failure dropped — what a retry starts from. */
export function withoutPickerRowError(
  errors: Readonly<Record<string, string>>,
  rowId: string,
): Record<string, string> {
  return Object.fromEntries(Object.entries(errors).filter(([key]) => key !== rowId))
}

/**
 * True when a create failed only because the owner already has the song, which
 * is recoverable: the existing repertoire entry carries the id we wanted.
 */
export function isAlreadyInRepertoireError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(ALREADY_IN_REPERTOIRE)
}

/**
 * The **version id** the owner already holds for a track, matched on the
 * split-title identity key, or `null` (RH-125, re-keyed by RH-108).
 *
 * This is the recovery path when `createAndAddSong` throws `already in your
 * repertoire`, and re-keying it is a fix: at HEAD it compared the **raw**
 * title, so adding Spotify's `"Bad - Remaster 2012"` matched the held entry's
 * `"Bad"` never, and the user saw the raw error instead of the row being
 * added. The recovery was dead for every suffixed Spotify title.
 *
 * Two consequences, both accepted. It will newly recover a held entry for the
 * *song* when the user asked for a particular *recording*, so the version
 * added may not be the one the row named — strictly better than a visible
 * error, and the pre-existing shape of this function. And post-RH-125 an owner
 * may hold several versions of one song, so the pick is made deterministic by
 * taking the **lowest** version id rather than whichever the array listed
 * first.
 */
export function findRepertoireVersionIdByTrack(
  entries: readonly Repertoire[],
  track: PickerTrackName,
): string | null {
  const wanted = songIdentityKey(track.title, track.artist)
  let lowest: string | null = null
  for (const rep of entries) {
    if (!rep.song || songIdentityKey(rep.song.title, rep.song.artist) !== wanted) continue
    if (rep.version_id && (lowest === null || rep.version_id < lowest)) lowest = rep.version_id
  }
  return lowest
}

/**
 * Everything `useSongPicker` exposes: the panel's data plus the intent a click
 * expresses. No raw setter (RH-64) — `results` is already merged, collapsed,
 * ordered and filtered, so the panel holds no decision of its own.
 *
 * One list and one command since RH-108. The two of each they replace were
 * what made a catalog row and a Spotify row for the same song two rows with
 * two ids, and therefore two independent `rowErrors` slots.
 */
export interface SongPickerController {
  /** What the search box shows. */
  query: string
  /** A search is in flight for the current query. */
  loading: boolean
  /** Row id currently being added, or `null`. Keyed by `SongSearchRow.id`. */
  addingId: string | null
  /** Per-row failure messages, keyed by `SongSearchRow.id`. */
  rowErrors: Record<string, string>
  /** One row per song, each carrying every recording both sources offered. */
  results: SongSearchRow[]
  /** Type into the search box; the search itself is debounced. */
  changeQuery: (query: string) => void
  /** Add a row. Never rejects — a failure lands in `rowErrors`. */
  addRow: (row: SongSearchRow) => Promise<void>
}
