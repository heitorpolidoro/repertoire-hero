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
 * `SongPickerController` is declared here too, next to `SongStatusController`
 * in `songStatus.ts`, so `src/components/playlists` can type the panel without
 * importing `src/hooks`.
 */

import type { SpotifyTrack } from '@/lib/spotify'
import type { GlobalSong, Repertoire } from '@/types/database'

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

/** Catalog results minus the songs the playlist already holds. */
export function visiblePickerCatalog(
  results: readonly GlobalSong[],
  playlistSongIds: ReadonlySet<string>,
): GlobalSong[] {
  return results.filter((song) => !playlistSongIds.has(song.id))
}

/**
 * The identity a catalog song and a Spotify track are compared by. Lowercased,
 * because the two sources spell the same release differently often enough.
 */
export function pickerDedupKey(song: PickerTrackName): string {
  return `${song.title.toLowerCase()}|${song.artist.toLowerCase()}`
}

/** One dedup key per song — the set `visiblePickerSpotify` filters against. */
export function pickerCatalogKeys(songs: readonly PickerTrackName[]): Set<string> {
  return new Set(songs.map(pickerDedupKey))
}

/** Spotify results minus the tracks the visible catalog rows already cover. */
export function visiblePickerSpotify(
  tracks: readonly SpotifyTrack[],
  catalogKeys: ReadonlySet<string>,
): SpotifyTrack[] {
  return tracks.filter((track) => !catalogKeys.has(pickerDedupKey(track)))
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

/** The repertoire song id for a track, matched on title and artist, or `null`. */
export function findRepertoireSongIdByTrack(
  entries: readonly Repertoire[],
  track: PickerTrackName,
): string | null {
  const wanted = pickerDedupKey(track)
  const existing = entries.find((rep) => rep.song && pickerDedupKey(rep.song) === wanted)
  return existing?.song_id ?? null
}

/**
 * Everything `useSongPicker` exposes: the panel's data plus the intents a click
 * expresses. No raw setter (RH-64) — `catalogResults` and `spotifyResults` are
 * already filtered and deduped, so the panel holds no decision of its own.
 */
export interface SongPickerController {
  /** What the search box shows. */
  query: string
  /** A search is in flight for the current query. */
  loading: boolean
  /** Row id currently being added, or `null`. */
  addingId: string | null
  /** Per-row failure messages, keyed by row id. */
  rowErrors: Record<string, string>
  /** Catalog matches not already in the playlist. */
  catalogResults: GlobalSong[]
  /** Spotify matches the catalog rows do not already cover. */
  spotifyResults: SpotifyTrack[]
  /** Type into the search box; the search itself is debounced. */
  changeQuery: (query: string) => void
  /** Add a catalog row. Never rejects — a failure lands in `rowErrors`. */
  addCatalogSong: (song: GlobalSong) => Promise<void>
  /** Add a Spotify row. Never rejects — a failure lands in `rowErrors`. */
  addSpotifyTrack: (track: SpotifyTrack) => Promise<void>
}
