/**
 * The offline snapshot: one playlist, photographed at a moment (RH-79).
 *
 * This module is the *contract* between the download (RH-79, `offlineStore.ts`)
 * and the Fast View offline read path (RH-80, `offlineFirst.ts`). It is pure by
 * construction — it touches no Cache Storage, no IndexedDB, no `window`, no
 * browser global and no clock: `savedAt` arrives as an argument, so a snapshot
 * is a deterministic function of its inputs and its tests need no mock.
 *
 * Two shapes carry the weight:
 *
 *   - `OfflineTabSnapshot.createdAt` is **mandatory** and holds the tab row's
 *     `created_at` verbatim. `RepertoireTab` requires it and `mergeTabs`
 *     (`@/lib/tabLibrary`) sorts on it, so dropping it would both break RH-80's
 *     type-check against `getTabs` and silently reorder tabs offline.
 *   - `OfflineSongSnapshot.repertoireId` is the id `getTabs` is called with.
 *     `new Set(snapshot.songs.map(s => s.repertoireId))` is therefore exactly
 *     the "was this captured?" predicate: an id *in* the set with an empty
 *     `tabs` array is a genuinely tab-less song, an id *outside* it was never
 *     captured. The member's personal repertoire row is deliberately not
 *     captured (see docs/tasks/RH-80-spec.md §1), so RH-80 answers
 *     `getPersonalEntryForSong` with `null` and the second `getTabs` call never
 *     fires offline.
 *
 * See docs/tasks/RH-80-spec.md §1 for the full reasoning.
 */

import type { PlaylistEntry } from '@/lib/playlistNav'
import type { Repertoire, RepertoireTab } from '@/types/database'

/**
 * The stored shape's version. A snapshot written under any other number is read
 * back as absent rather than migrated — a photograph is cheap to retake.
 */
export const OFFLINE_SCHEMA_VERSION = 1

/** One tab PDF, as stored: the row's fields plus where its bytes live and how many. */
export interface OfflineTabSnapshot {
  id: string
  repertoireId: string
  title: string
  fileUrl: string
  /** The row's `created_at`, verbatim — `mergeTabs` sorts on it. */
  createdAt: string
  /** The Cache Storage key the bytes were written under. */
  cacheKey: string
  bytes: number
}

/**
 * One song of the playlist, shaped so RH-80 can answer all three Fast View
 * reads from it without a second lookup.
 *
 * `entry` is typed as `@/lib/playlistNav`'s `PlaylistEntry`, the client-safe
 * mirror of `PlaylistEntrySummary` (`@/lib/playlists`) the setlist already
 * uses; importing the `pg`-bound module for a type would be legal but pointless.
 */
export interface OfflineSongSnapshot {
  /** Equals `entry.repertoireId` and `repertoire.id`; the `getTabs` lookup key. */
  repertoireId: string
  entry: PlaylistEntry
  repertoire: Repertoire
  tabs: OfflineTabSnapshot[]
}

/** One playlist, captured whole. */
export interface OfflineSnapshot {
  schemaVersion: number
  playlistId: string
  playlistName: string
  bandId: string | null
  /** ISO-8601 UTC, supplied by the caller. */
  savedAt: string
  songs: OfflineSongSnapshot[]
}

/** One tab row plus the byte count measured while it was fetched. */
export interface OfflineTabMaterial {
  tab: RepertoireTab
  bytes: number
}

/** Everything read for one song, before it becomes an `OfflineSongSnapshot`. */
export interface OfflineSongMaterial {
  entry: PlaylistEntry
  repertoire: Repertoire
  tabs: OfflineTabMaterial[]
}

export interface BuildOfflineSnapshotInput {
  playlistId: string
  playlistName: string
  bandId: string | null
  /** ISO-8601 UTC. Never `Date.now()` in here — that is what keeps this pure. */
  savedAt: string
  songs: OfflineSongMaterial[]
}

/**
 * The Cache Storage key one tab's bytes live under.
 *
 * Synthetic, same-origin (which `cache.put` requires) and never routed by the
 * app. Scoping it by playlist is what makes per-playlist removal a prefix scan,
 * and what keeps a changed `file_url` from orphaning bytes.
 */
export function offlineTabCacheKey(playlistId: string, tabId: string): string {
  return `/__offline-tab/${playlistId}/${tabId}`
}

function toTabSnapshot(playlistId: string, material: OfflineTabMaterial): OfflineTabSnapshot {
  return {
    id: material.tab.id,
    repertoireId: material.tab.repertoire_id,
    title: material.tab.title,
    fileUrl: material.tab.file_url,
    createdAt: material.tab.created_at,
    cacheKey: offlineTabCacheKey(playlistId, material.tab.id),
    bytes: material.bytes,
  }
}

/** One versioned snapshot from the material the download gathered. */
export function buildOfflineSnapshot(input: BuildOfflineSnapshotInput): OfflineSnapshot {
  return {
    schemaVersion: OFFLINE_SCHEMA_VERSION,
    playlistId: input.playlistId,
    playlistName: input.playlistName,
    bandId: input.bandId,
    savedAt: input.savedAt,
    songs: input.songs.map((song) => ({
      repertoireId: song.entry.repertoireId,
      entry: song.entry,
      repertoire: song.repertoire,
      tabs: song.tabs.map((tab) => toTabSnapshot(input.playlistId, tab)),
    })),
  }
}

/**
 * The stored tab as Fast View's tab library wants it. The only mapping between
 * the two shapes, declared here so RH-80's reader does not have to invent one.
 * `annotations` is optional on `RepertoireTab` and out of scope for the
 * snapshot, so it is omitted rather than faked.
 */
export function offlineTabToRepertoireTab(tab: OfflineTabSnapshot): RepertoireTab {
  return {
    id: tab.id,
    repertoire_id: tab.repertoireId,
    title: tab.title,
    file_url: tab.fileUrl,
    created_at: tab.createdAt,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isString(value: unknown): boolean {
  return typeof value === 'string'
}

function isTabSnapshot(value: unknown): boolean {
  if (!isRecord(value)) return false
  const strings = [value.id, value.repertoireId, value.title, value.fileUrl, value.createdAt]
  return strings.every(isString) && typeof value.bytes === 'number' && isString(value.cacheKey)
}

function isSongSnapshot(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (!isString(value.repertoireId)) return false
  if (!isRecord(value.entry) || !isRecord(value.repertoire)) return false
  return Array.isArray(value.tabs) && value.tabs.every(isTabSnapshot)
}

/**
 * The stored value as an `OfflineSnapshot`, or `null`.
 *
 * `null` means "there is no usable offline copy" for every reason at once: a
 * different `schemaVersion`, a shape that does not validate, or a value that is
 * not an object at all. Callers do not have to tell those apart — all three
 * lead to the same place, "not downloaded".
 */
export function readValidSnapshot(value: unknown): OfflineSnapshot | null {
  if (!isRecord(value)) return null
  if (value.schemaVersion !== OFFLINE_SCHEMA_VERSION) return null
  if (!isString(value.playlistId) || !isString(value.playlistName) || !isString(value.savedAt)) return null
  if (value.bandId !== null && !isString(value.bandId)) return null
  if (!Array.isArray(value.songs) || !value.songs.every(isSongSnapshot)) return null
  return value as unknown as OfflineSnapshot
}

/**
 * How many bytes a string occupies once serialized as UTF-8.
 *
 * Computed rather than measured through `TextEncoder`/`Blob`, so this module
 * stays free of any platform global and the snapshot's own contribution to the
 * stored size is the same number in every environment.
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code < 0x10000) bytes += 3
    else bytes += 4
  }
  return bytes
}
