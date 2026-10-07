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
 *   - **`OfflineSongSnapshot.versionId`** replaced `repertoireId` in RH-132,
 *     and the two keys still coexist on purpose. Fast View is addressed by a
 *     `song_versions.id` now, so `findSong` — and so the entry reader — keys on
 *     it, because that is what the route carries and what `isSongSnapshot`
 *     requires; `findSongBySongId` keys on `repertoire.song_id`, the
 *     already-present field both the `getTabs` and the
 *     `getPersonalEntryForSong` readers resolve through. The song snapshot
 *     therefore gains **no** new field for the file lookup.
 *     `new Set(snapshot.songs.map(s => s.versionId))` is still exactly the
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
 * See docs/tasks/RH-80-spec.md §1, docs/tasks/RH-84-spec.md §5,
 * docs/tasks/RH-124-spec.md §6 and docs/tasks/RH-125-spec.md §7.
 */

import { isSnapshotV5, upgradeSnapshotV5ToV6 } from '@/lib/offlineSnapshotV5'
import type { PlaylistEntry } from '@/lib/playlistNav'
import type { Repertoire, ResolvedSongEntry, SongFile } from '@/types/database'
import { DEFAULT_TAB_CONTENT_TYPE } from '@/lib/tabRenderer'

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
 *
 * 3 -> 4 (RH-124): `repertoire` became `user_songs` / `band_songs`, keyed by a
 * version, and the captured `Repertoire` is now a **resolved** row — it lost
 * `personal_key` and gained `version_id`, `key`, `tuning` and `map`. A v3
 * record therefore carries a `personal_key` the reader no longer looks at and
 * no `key` at all, so Fast View would show an empty key line offline and a
 * filled one online. Offline is read-only and cannot walk the three levels
 * itself, so there is nothing to recompute from a v3 record: it is discarded,
 * and `listOfflinePlaylists` purges it so the playlist reads as not downloaded
 * rather than as a copy Fast View then contradicts.
 *
 * 4 -> 5 (RH-125): `playlist_songs` names a version, so the stored
 * `entry: PlaylistEntry` changed shape — it gained a required
 * `versionId: string` and its `repertoireId` became nullable. A v4 record reads
 * back with `entry.versionId === undefined` under a type that says `string`,
 * and `isSongSnapshot` would not notice: it validates `entry` only as
 * `isRecord`. The bump is what discards those records instead, through the one
 * `schemaVersion !==` check in `readValidSnapshot`, on this module's own
 * v1 -> v2 precedent — an indicator that might be wrong is worse than no
 * offline copy.
 *
 * 5 -> 6 (RH-132): Fast View is addressed by a `song_versions.id`, so a song is
 * keyed by `versionId` instead of `repertoireId` and the captured row is a
 * `ResolvedSongEntry` whose `ownerRowId` may be null. **This one is upgraded,
 * not discarded** — the first bump that is a pure reshape of data already in
 * the record. A v5 song carries everything v6 needs: `entry.versionId` has
 * been required since RH-125 and `repertoire.id` is the owner row id, so
 * `upgradeSnapshotV5ToV6` is total and loses nothing (the only widening is
 * `status`, to `SongStatus | null`). It does not follow the v1 -> v2 precedent
 * because nothing is *absent* here, and discarding would destroy every
 * downloaded playlist and its cached PDF bytes on first launch, recoverable
 * only with a network connection. The `cacheKey`s are untouched by the
 * reshape, which is what keeps those bytes valid.
 */
export const OFFLINE_SCHEMA_VERSION = 6

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
  /**
   * The row's `content_type` (RH-128), so the viewer and the stage branch the
   * same way offline as online.
   *
   * **Optional, and absent reads as `application/pdf`** — which is why
   * `OFFLINE_SCHEMA_VERSION` is *not* bumped for it. Every snapshot already on
   * disk predates image upload, so the fallback is a fact rather than a guess,
   * and discarding those snapshots would cost a musician a downloaded setlist
   * for nothing.
   */
  contentType?: string
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
   * Equals `entry.versionId` — the Fast View address since RH-132, and this
   * reader's lookup key. The *file* lookup key is `repertoire.song_id` instead
   * (RH-123) — see the module docblock on why the two coexist.
   *
   * Always non-null: `PlaylistEntry.versionId` is the entry's identity and has
   * been required since RH-125, so every entry of a playlist reaches the
   * snapshot — including the ones whose owner holds no row, which RH-132 made
   * both addressable and capturable.
   */
  versionId: string
  entry: PlaylistEntry
  /**
   * The `(owner, version)` pair with every field already **resolved** (RH-124,
   * re-keyed by RH-132): offline is read-only and cannot walk `song_versions`
   * and `songs` itself, so what is captured is the answer, not the three
   * levels. `ownerRowId` is `null` when the owner holds no row at this version,
   * which is exactly what makes Fast View read-only for it.
   */
  repertoire: ResolvedSongEntry
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
  repertoire: ResolvedSongEntry
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
    contentType: material.tab.content_type,
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
      // `entry.versionId`, the entry's own identity and the Fast View address
      // (RH-132). Non-null by type, where the old owner-row key was not.
      versionId: song.entry.versionId,
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
 *
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
    // Absent is `application/pdf`: a snapshot written before RH-128 carries no
    // such field and is certainly a PDF (RH-128).
    content_type: tab.contentType ?? DEFAULT_TAB_CONTENT_TYPE,
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
  if (!strings.every(isString) || typeof value.bytes !== 'number' || !isString(value.cacheKey)) return false
  // Optional, unlike every field above: absent is the pre-RH-128 snapshot, and
  // it reads as `application/pdf` rather than invalidating the whole download.
  return value.contentType === undefined || isString(value.contentType)
}

function isSongSnapshot(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (!isString(value.versionId)) return false
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
 *
 * **A v5 record is upgraded before it is compared** (RH-132): a value that
 * validates as v5 is reshaped by `upgradeSnapshotV5ToV6` and then validated as
 * v6, so a playlist downloaded before this shipped keeps its cached PDFs
 * instead of being purged. Anything else still returns `null`.
 */
export function readValidSnapshot(value: unknown): OfflineSnapshot | null {
  if (isSnapshotV5(value)) return readValidSnapshot(upgradeSnapshotV5ToV6(value))
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
