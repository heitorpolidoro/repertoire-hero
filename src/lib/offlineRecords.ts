/**
 * What the offline store keeps, record by record (RH-192).
 *
 * Since RH-192 a song is stored **once per `(versionId, owner context)`**, under
 * `songRecordId(versionId, bandId)`, and a setlist is stored as its ordered list
 * of `{ versionId, title, artist }` entries only. Two setlists sharing a song
 * therefore share one record and one set of cached bytes.
 *
 * Every record lives in the one IndexedDB object store RH-79 created, whose
 * keyPath is `playlistId`: a song record carries its song record id there. The
 * keyPath is kept on purpose — changing it needs a database version bump whose
 * upgrade would have to drop the store, and with it every pre-RH-192 copy
 * before `offlineConversion.ts` could convert it without the network.
 *
 * A pre-RH-192 record (`OfflineSnapshotRecord`, one whole snapshot per playlist
 * or single song) carries no `kind`; that absence is what tells the three apart.
 *
 * Pure: no browser global, no clock, no network.
 */

import { songRecordId } from '@/lib/offlineSongRecord'
import {
  utf8ByteLength,
  type OfflineSetlistList,
  type OfflineSnapshot,
  type OfflineSongSnapshot,
  type OfflineStoredSong,
} from '@/lib/offlineSnapshot'

/** A stored setlist: its ordered list, plus the list's own serialized size. */
export interface OfflineSetlistRecord extends OfflineSetlistList {
  kind: 'setlist'
  schemaVersion: number
  bytes: number
}

/** A stored song. `playlistId` is the shared keyPath, holding `songRecordId(...)`. */
export interface OfflineSongRecord extends OfflineStoredSong {
  kind: 'song'
  playlistId: string
  schemaVersion: number
}

/** A pre-RH-192 record: one whole snapshot per playlist or single song (RH-79, RH-116). */
export interface OfflineSnapshotRecord {
  playlistId: string
  playlistName: string
  savedAt: string
  /** Every cached PDF's real byte length plus the serialized snapshot's. */
  bytes: number
  schemaVersion: number
  snapshot: OfflineSnapshot
}

export type OfflineStoredRecord = OfflineSetlistRecord | OfflineSongRecord | OfflineSnapshotRecord

/** A stored setlist or individually downloaded song, as a library listing shows it. */
export interface OfflinePlaylistSummary {
  playlistId: string
  playlistName: string
  savedAt: string
  bytes: number
  schemaVersion: number
}

/** The JSON side of the boundary: IndexedDB in production. */
export interface OfflineRecordPort {
  get(recordId: string): Promise<OfflineStoredRecord | null>
  put(record: OfflineStoredRecord): Promise<void>
  delete(recordId: string): Promise<void>
  list(): Promise<OfflineStoredRecord[]>
}

/** The bytes side of the boundary: Cache Storage in production. */
export interface OfflineBlobPort {
  put(key: string, response: Response): Promise<void>
  match(key: string): Promise<Response | undefined>
  /** Deletes the bytes under exactly this key (RH-192). */
  delete(key: string): Promise<void>
  deleteByPrefix(prefix: string): Promise<void>
  clear(): Promise<void>
}

export interface OfflineStorePorts {
  records: OfflineRecordPort
  blobs: OfflineBlobPort
  fetch: typeof fetch
}

export function isSongRecord(record: OfflineStoredRecord): record is OfflineSongRecord {
  return (record as { kind?: unknown }).kind === 'song'
}

export function isSetlistRecord(record: OfflineStoredRecord): record is OfflineSetlistRecord {
  return (record as { kind?: unknown }).kind === 'setlist'
}

/** Everything a pre-RH-192 record cached shares this key prefix. */
export function legacyTabKeyPrefix(recordId: string): string {
  return `/__offline-tab/${recordId}/`
}

/** Newest first, ties broken by record id ascending: total, so every read agrees. */
export function newestFirst<T extends { savedAt: string; playlistId: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    if (left.savedAt !== right.savedAt) return left.savedAt < right.savedAt ? 1 : -1
    return left.playlistId < right.playlistId ? -1 : 1
  })
}

/** A song's cached files' bytes plus its own serialized size. */
export function storedSongBytes(song: OfflineSongSnapshot): number {
  const tabBytes = song.tabs.reduce((sum, tab) => sum + tab.bytes, 0)
  return tabBytes + utf8ByteLength(JSON.stringify(song))
}

/** The bytes a setlist list itself occupies; its songs are counted on their own records. */
export function setlistListBytes(list: OfflineSetlistList): number {
  return utf8ByteLength(JSON.stringify(list))
}

/** Every Cache Storage key a song's files live under. */
export function songCacheKeys(song: OfflineSongSnapshot): string[] {
  return song.tabs.map((tab) => tab.cacheKey)
}

/** The song record ids a setlist holds, in its own owner context. */
export function setlistSongIds(setlist: OfflineSetlistList): string[] {
  return setlist.entries.map((entry) => songRecordId(entry.versionId, setlist.bandId))
}

/** How much of a playlist's live entries this device holds (RH-193). */
export interface LiveOfflineCount {
  /** The live `version_id`s stored in the playlist's owner context. */
  storedVersionIds: Set<string>
  stored: number
  total: number
  /** The stored songs' bytes, over the live entries only. */
  bytes: number
}

/**
 * Counts the page's **live** entries, not the stored list's, so a song added
 * online after the download reads `5 of 6`. `songBytes` maps every stored song
 * record id to its bytes; a copy in another owner context never counts.
 */
export function liveOfflineCount(
  versionIds: string[],
  bandId: string | null,
  songBytes: ReadonlyMap<string, number>,
): LiveOfflineCount {
  const storedVersionIds = new Set<string>()
  let bytes = 0
  for (const versionId of versionIds) {
    const size = songBytes.get(songRecordId(versionId, bandId))
    if (size === undefined) continue
    storedVersionIds.add(versionId)
    bytes += size
  }
  return { storedVersionIds, stored: storedVersionIds.size, total: versionIds.length, bytes }
}

/**
 * The protection rule (RH-192): which of `candidateIds` a setlist removal or
 * refresh may delete. A song stays when another stored setlist holds it — in the
 * same owner context, which the song record id already encodes — or when it was
 * downloaded individually.
 */
export function releasableSongIds(
  candidateIds: string[],
  otherSetlists: OfflineSetlistList[],
  songs: OfflineSongRecord[],
): string[] {
  const held = new Set(otherSetlists.flatMap(setlistSongIds))
  const individual = new Set(songs.filter((song) => song.individualDownload).map((song) => song.playlistId))
  return [...new Set(candidateIds)].filter((id) => !held.has(id) && !individual.has(id))
}

export function songSummary(song: OfflineSongRecord): OfflinePlaylistSummary {
  return {
    playlistId: song.playlistId,
    playlistName: song.entry.title,
    savedAt: song.savedAt,
    bytes: song.bytes,
    schemaVersion: song.schemaVersion,
  }
}

/** A setlist's summary: its list plus every song of it on this device. */
export function setlistSummary(
  setlist: OfflineSetlistRecord,
  songs: OfflineSongRecord[],
): OfflinePlaylistSummary {
  const held = new Set(setlistSongIds(setlist))
  const songBytes = songs
    .filter((song) => held.has(song.playlistId))
    .reduce((sum, song) => sum + song.bytes, 0)
  return {
    playlistId: setlist.playlistId,
    playlistName: setlist.playlistName,
    savedAt: setlist.savedAt,
    bytes: setlist.bytes + songBytes,
    schemaVersion: setlist.schemaVersion,
  }
}
