/**
 * The browser storage boundary for offline playlists (RH-79).
 *
 * The store never touches `indexedDB` or `caches` itself. It talks to two small
 * ports plus `fetch`, passed as one optional trailing argument that defaults to
 * the real adapter in `@/lib/offlineBackends`. That is what makes the rollback
 * testable over in-memory fakes with no mocking library and no
 * `fake-indexeddb`, and it is what keeps this module importable under `jsdom`,
 * which implements neither global: `createOfflineStore()` captures nothing at
 * construction, and the default adapter reaches for a global only inside a
 * call. Importing this module — `OFFLINE_STORE` included — is inert.
 *
 * The write order in `saveOfflinePlaylist` is the all-or-nothing mechanism:
 * every PDF is cached first and the IndexedDB record is written last, so the
 * record is the only thing that marks a playlist as downloaded and any failure
 * before it already means "not downloaded". Any throw at any step also unwinds
 * what did land — including, on a failed refresh, the previous good copy, which
 * is deliberate: a half-written snapshot claiming a playlist is available is
 * worse than none.
 *
 * See docs/tasks/RH-80-spec.md §§2-4.
 */

import { logger } from '@/lib/logger'
import {
  OFFLINE_SCHEMA_VERSION,
  buildOfflineSnapshot,
  offlineTabCacheKey,
  readValidSnapshot,
  utf8ByteLength,
  type OfflineSnapshot,
  type OfflineTabMaterial,
} from '@/lib/offlineSnapshot'
import type { PlaylistEntry } from '@/lib/playlistNav'
import type { Repertoire, RepertoireTab } from '@/types/database'

/**
 * The Cache Storage cache the tab PDFs live in.
 *
 * Re-exported, not defined here: `src/app/sw.ts` needs the same name and must
 * not reach this module, whose graph (`@/lib/logger` → `@sentry/nextjs`) needs
 * node builtins a browser bundle cannot resolve. See
 * `src/lib/offlineCacheNames.ts` (RH-80).
 */
export { OFFLINE_TAB_CACHE } from '@/lib/offlineCacheNames'

/** The IndexedDB database and object store holding the snapshots. */
export const OFFLINE_DB_NAME = 'repertoire-hero-offline'
export const OFFLINE_DB_VERSION = 1
export const OFFLINE_SNAPSHOT_STORE = 'snapshots'

/** One stored playlist. `schemaVersion` mirrors `snapshot.schemaVersion`. */
export interface OfflineSnapshotRecord {
  playlistId: string
  playlistName: string
  savedAt: string
  /** Every cached PDF's real byte length plus the serialized snapshot's. */
  bytes: number
  schemaVersion: number
  snapshot: OfflineSnapshot
}

/** A stored playlist as a listing shows it — the record minus the snapshot. */
export type OfflinePlaylistSummary = Omit<OfflineSnapshotRecord, 'snapshot'>

/** The JSON side of the boundary: IndexedDB in production. */
export interface OfflineRecordPort {
  get(playlistId: string): Promise<OfflineSnapshotRecord | null>
  put(record: OfflineSnapshotRecord): Promise<void>
  delete(playlistId: string): Promise<void>
  list(): Promise<OfflineSnapshotRecord[]>
}

/** The bytes side of the boundary: Cache Storage in production. */
export interface OfflineBlobPort {
  put(key: string, response: Response): Promise<void>
  match(key: string): Promise<Response | undefined>
  deleteByPrefix(prefix: string): Promise<void>
  clear(): Promise<void>
}

export interface OfflineStorePorts {
  records: OfflineRecordPort
  blobs: OfflineBlobPort
  fetch: typeof fetch
}

/** Everything read for one song of the playlist being downloaded. */
export interface OfflineSongInput {
  entry: PlaylistEntry
  repertoire: Repertoire
  /** The member's own row for the song; `null` outside a band (RH-83 ER10). */
  personalRepertoire: Repertoire | null
  tabs: RepertoireTab[]
}

export interface SaveOfflinePlaylistInput {
  playlistId: string
  playlistName: string
  bandId: string | null
  /** ISO-8601 UTC, supplied by the caller so the store keeps no clock. */
  savedAt: string
  songs: OfflineSongInput[]
  /** Called once per finished song, with the running count and the total. */
  onProgress?: (done: number, total: number) => void
}

/** The six operations every offline surface goes through. */
export interface OfflineStore {
  /** All-or-nothing: resolves with the written record, or rolls back and throws. */
  saveOfflinePlaylist(input: SaveOfflinePlaylistInput): Promise<OfflineSnapshotRecord>
  /** `null` when nothing is stored *or* the stored schema is not this one. */
  readOfflineSnapshot(playlistId: string): Promise<OfflineSnapshot | null>
  /** Never lists a record of another schema version — it purges it instead. */
  listOfflinePlaylists(): Promise<OfflinePlaylistSummary[]>
  removeOfflinePlaylist(playlistId: string): Promise<void>
  matchOfflineTab(playlistId: string, tabId: string): Promise<Response | undefined>
  /** Never throws: a sign-out must always be able to await it. */
  clearAllOfflineData(): Promise<void>
}

/** Everything cached for one playlist shares this key prefix. */
function offlineTabKeyPrefix(playlistId: string): string {
  return `/__offline-tab/${playlistId}/`
}

/**
 * The two assertions the design insists on, in one place.
 *
 * Vercel Blob is CORS-enabled (measured — see the design's second correction
 * note), so a tab response is a normal one. `type === 'opaque'` would mean the
 * bytes are unreadable and the size unknowable, and a non-`ok` response would
 * cache an error page as a chart. Either aborts the whole download.
 */
function assertUsableTabResponse(response: Response, fileUrl: string): void {
  if (response.type === 'opaque') {
    throw new Error(`Tab download returned an opaque response: ${fileUrl}`)
  }
  if (!response.ok) {
    throw new Error(`Tab download failed (${response.status}): ${fileUrl}`)
  }
}

async function cacheOneTab(
  ports: OfflineStorePorts,
  playlistId: string,
  tab: RepertoireTab,
): Promise<OfflineTabMaterial> {
  const response = await ports.fetch(tab.file_url)
  assertUsableTabResponse(response, tab.file_url)
  const bytes = (await response.clone().arrayBuffer()).byteLength
  await ports.blobs.put(offlineTabCacheKey(playlistId, tab.id), response)
  return { tab, bytes }
}

function toSummary(record: OfflineSnapshotRecord): OfflinePlaylistSummary {
  return {
    playlistId: record.playlistId,
    playlistName: record.playlistName,
    savedAt: record.savedAt,
    bytes: record.bytes,
    schemaVersion: record.schemaVersion,
  }
}

/**
 * A store over the given ports, or over the real IndexedDB + Cache Storage
 * adapter when none are passed.
 *
 * The default is resolved lazily, once, on the first call that needs it — not
 * at construction — so that constructing `OFFLINE_STORE` at module scope stays
 * free of any browser global.
 */
export function createOfflineStore(ports?: OfflineStorePorts): OfflineStore {
  let resolved = ports
  let pending: Promise<OfflineStorePorts> | undefined

  async function resolvePorts(): Promise<OfflineStorePorts> {
    if (resolved) return resolved
    pending ??= import('@/lib/offlineBackends').then((module) => module.createDefaultOfflinePorts())
    resolved = await pending
    return resolved
  }

  async function removeOfflinePlaylist(playlistId: string): Promise<void> {
    const active = await resolvePorts()
    await active.blobs.deleteByPrefix(offlineTabKeyPrefix(playlistId))
    await active.records.delete(playlistId)
  }

  async function writePlaylist(
    active: OfflineStorePorts,
    input: SaveOfflinePlaylistInput,
  ): Promise<OfflineSnapshotRecord> {
    const songs = []
    for (const song of input.songs) {
      const tabs: OfflineTabMaterial[] = []
      for (const tab of song.tabs) {
        tabs.push(await cacheOneTab(active, input.playlistId, tab))
      }
      songs.push({
        entry: song.entry,
        repertoire: song.repertoire,
        personalRepertoire: song.personalRepertoire,
        tabs,
      })
      input.onProgress?.(songs.length, input.songs.length)
    }

    const snapshot = buildOfflineSnapshot({
      playlistId: input.playlistId,
      playlistName: input.playlistName,
      bandId: input.bandId,
      savedAt: input.savedAt,
      songs,
    })
    const serialized = JSON.stringify(snapshot)
    const tabBytes = songs.reduce(
      (total, song) => total + song.tabs.reduce((sum, tab) => sum + tab.bytes, 0),
      0,
    )
    const record: OfflineSnapshotRecord = {
      playlistId: snapshot.playlistId,
      playlistName: snapshot.playlistName,
      savedAt: snapshot.savedAt,
      bytes: tabBytes + utf8ByteLength(serialized),
      // Mirrored from the snapshot itself, so the two can never disagree.
      schemaVersion: snapshot.schemaVersion,
      snapshot,
    }
    // Last, deliberately: the record is what marks the playlist as downloaded.
    await active.records.put(record)
    return record
  }

  return {
    async saveOfflinePlaylist(input) {
      const active = await resolvePorts()
      try {
        return await writePlaylist(active, input)
      } catch (error) {
        await removeOfflinePlaylist(input.playlistId)
        throw error
      }
    },

    async readOfflineSnapshot(playlistId) {
      const active = await resolvePorts()
      const record = await active.records.get(playlistId)
      return record ? readValidSnapshot(record.snapshot) : null
    },

    async listOfflinePlaylists() {
      const active = await resolvePorts()
      const rows = await active.records.list()
      const current: OfflinePlaylistSummary[] = []
      for (const record of rows) {
        // Purged, not merely skipped: a record listed as "Downloaded" while
        // Fast View reports the playlist unavailable is the worst of both
        // (RH-83 ER11). `removeOfflinePlaylist` drops the cached PDFs too.
        if (record.schemaVersion !== OFFLINE_SCHEMA_VERSION) {
          await removeOfflinePlaylist(record.playlistId)
          continue
        }
        current.push(toSummary(record))
      }
      return current
    },

    removeOfflinePlaylist,

    async matchOfflineTab(playlistId, tabId) {
      const active = await resolvePorts()
      return active.blobs.match(offlineTabCacheKey(playlistId, tabId))
    },

    async clearAllOfflineData() {
      try {
        const active = await resolvePorts()
        for (const record of await active.records.list()) {
          await active.records.delete(record.playlistId)
        }
        await active.blobs.clear()
      } catch (error) {
        // Never rethrown: the sign-out path awaits this, and a purge failure
        // must not be able to strand the user signed in.
        logger.error('Failed to clear offline data', error)
      }
    },
  }
}

/**
 * The default store every hook and component falls back to.
 *
 * Module-scope for a stable identity (the `bandAdminActions.ts` pattern), and
 * inert at import time: no port is constructed until a method is called.
 */
export const OFFLINE_STORE: OfflineStore = createOfflineStore()
