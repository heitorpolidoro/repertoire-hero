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
 *   - `OfflineTabSnapshot.createdAt` is **mandatory** and holds the file row's
 *     `created_at` verbatim. `SongFile` requires it and the file list sorts on
 *     it, so dropping it would both break the type-check against `getTabs` and
 *     silently reorder a musician's charts offline.
 *   - `OfflineTabSnapshot.songId` is the id `getTabs` is called with (RH-123).
 *     It replaced `repertoireId`: a file is keyed by `(user_id, song_id)` now,
 *     so a repertoire row id would key the capture by something the read no
 *     longer knows about.
 *   - **`OfflineSongSnapshot.repertoireId` stays**, and the two keys coexist on
 *     purpose. `findSong` — and so the `getSongEntry` reader — keys on the
 *     repertoire row, because that is what the route carries and what
 *     `isSongSnapshot` keeps requiring; `findSongBySongId` keys on
 *     `repertoire.song_id`, which is the already-present field both the
 *     `getTabs` and the `getPersonalEntryForSong` readers resolve through. The
 *     song snapshot therefore gains **no** new field for the file lookup.
 *     `new Set(snapshot.songs.map(s => s.repertoireId))` is still exactly the
 *     "was this captured?" predicate for a song entry.
 *   - `OfflineSongSnapshot.personalRepertoire` is the member's own repertoire
 *     row for the song, captured at download time in band context (RH-83).
 *     RH-80 deliberately did *not* capture it and answered
 *     `getPersonalEntryForSong` with `null`; that decision is revised here on
 *     purpose, because the band-vs-personal lyrics indicator would otherwise
 *     lie offline.
 *
 * Since RH-123 the capture takes the **reader's own** files: `getTabs` is
 * called with the song id and resolves by the session's `user_id`, so a
 * band-context download no longer photographs the band's charts and skips the
 * member's own.
 *
 * See docs/tasks/RH-80-spec.md §1, docs/tasks/RH-84-spec.md §5 and
 * docs/tasks/RH-124-spec.md §6.
 */

import type { PlaylistEntry } from '@/lib/playlistNav'
import type { Repertoire, SongFile } from '@/types/database'

/**
 * The stored shape's version. A snapshot written under any other number is read
 * back as absent rather than migrated — a photograph is cheap to retake.
 *
 * 1 -> 2 (RH-83): songs gained `personalRepertoire`, and a v1 snapshot cannot
 * tell "this member has no personal version" from "it was never captured". An
 * indicator that might be wrong is worse than no offline copy, so v1 records
 * are discarded — and `listOfflinePlaylists` purges them, so a playlist
 * downloaded before this shipped shows as not downloaded instead of claiming a
 * copy Fast View then reports unavailable.
 *
 * 2 -> 3 (RH-123): a file entry is keyed by `songId` instead of `repertoireId`.
 * What breaks without the bump is **not** that the song cannot be found —
 * `findSongBySongId` matches on `repertoire.song_id`, which a v2 snapshot
 * already carries, so the whole tab array is still returned. It is that each
 * mapped file arrives with `song_id: undefined`, because a v2 tab entry carries
 * `repertoireId` and nothing else. The list is not empty, it is wrong. (A v2
 * snapshot would also now fail `isTabSnapshot`; the version bump is what turns
 * that into a purge of a superseded version by `listOfflinePlaylists`, so the
 * download reads as not-downloaded rather than as a shape error.)
 */
export const OFFLINE_SCHEMA_VERSION = 3

/** One file PDF, as stored: the row's fields plus where its bytes live and how many. */
export interface OfflineTabSnapshot {
  id: string
  /** The owner, i.e. the downloader — a file belongs to a person (RH-123). */
  userId: string
  /** The composition. This is the key `getTabs` is called with. */
  songId: string
  title: string
  fileUrl: string
  /** The row's `created_at`, verbatim — the file list sorts on it. */
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
  /**
   * Equals `entry.repertoireId` and `repertoire.id`; the `getSongEntry` lookup
   * key. The *file* lookup key is `repertoire.song_id` instead (RH-123) — see
   * the module docblock on why the two coexist.
   */
  repertoireId: string
  entry: PlaylistEntry
  repertoire: Repertoire
  /**
   * The member's own row for this song, or `null` — both in band context (they
   * genuinely have none) and always outside one, where there is no second
   * version to have. Its `lyrics` is what the offline badge reads (RH-83).
   */
  personalRepertoire: Repertoire | null
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

/** One file row plus the byte count measured while it was fetched. */
export interface OfflineTabMaterial {
  tab: SongFile
  bytes: number
}

/** Everything read for one song, before it becomes an `OfflineSongSnapshot`. */
export interface OfflineSongMaterial {
  entry: PlaylistEntry
  repertoire: Repertoire
  personalRepertoire: Repertoire | null
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
 * The Cache Storage key one file's bytes live under.
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
    userId: material.tab.user_id,
    songId: material.tab.song_id,
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
      personalRepertoire: song.personalRepertoire,
      tabs: song.tabs.map((tab) => toTabSnapshot(input.playlistId, tab)),
    })),
  }
}

/**
 * The stored file as Fast View's file library wants it. The only mapping between
 * the two shapes, declared here so RH-80's reader does not have to invent one.
 * `annotations` is optional on `SongFile` and out of scope for the snapshot, so
 * it is omitted rather than faked.
 */
export function offlineTabToSongFile(tab: OfflineTabSnapshot): SongFile {
  return {
    id: tab.id,
    user_id: tab.userId,
    song_id: tab.songId,
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
  const strings = [value.id, value.userId, value.songId, value.title, value.fileUrl, value.createdAt]
  return strings.every(isString) && typeof value.bytes === 'number' && isString(value.cacheKey)
}

function isSongSnapshot(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (!isString(value.repertoireId)) return false
  if (!isRecord(value.entry) || !isRecord(value.repertoire)) return false
  // Absent is not null: a v1 song carried no such field, and reading it as
  // "no personal version" is exactly the wrong answer the bump avoids.
  if (!('personalRepertoire' in value)) return false
  if (value.personalRepertoire !== null && !isRecord(value.personalRepertoire)) return false
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
