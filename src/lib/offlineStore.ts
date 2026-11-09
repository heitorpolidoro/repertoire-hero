/**
 * The browser storage boundary for offline songs and setlists (RH-79, RH-192).
 *
 * The store never touches `indexedDB` or `caches` itself. It talks to three small
 * ports plus `fetch`, passed as one optional trailing argument that defaults to
 * the real adapter in `@/lib/offlineBackends`. That is what makes every write
 * testable over in-memory fakes with no mocking library and no
 * `fake-indexeddb`, and it is what keeps this module importable under `jsdom`,
 * which implements neither global: `createOfflineStore()` captures nothing at
 * construction, and the default adapter reaches for a global only inside a
 * call. Importing this module — `OFFLINE_STORE` included — is inert.
 *
 * ## Songs once, setlists as lists (RH-192)
 *
 * A song is stored **once per `(versionId, owner context)`** under
 * `songRecordId(versionId, bandId)`, with its resolved entry, the member's own
 * row, its files and the reader's custom field values. A setlist is stored as
 * its ordered list only (`offlineRecords.ts`). So:
 *
 *   - `saveOfflineSong` is all-or-nothing **for that song**: its files are
 *     cached first and its record written last, and a failure removes only the
 *     bytes this attempt added — a song already stored keeps its copy. A setlist
 *     download is a run of these, so one failing song stops nothing else.
 *   - `removeOfflineSong` deletes that song's record and bytes and leaves every
 *     setlist list as it is.
 *   - `removeOfflinePlaylist` deletes a setlist's list and only the songs no
 *     other stored setlist holds and nobody downloaded individually (the
 *     protection rule, `releasableSongIds`). A refresh that drops a song from
 *     the list applies the same rule to it.
 *   - bytes are deleted per key, and never while another stored song still
 *     points at them.
 *   - a stored song's Fast View document is fetched and kept in the worker's
 *     page cache, best-effort and never deleted (RH-195).
 *
 * Every read goes through `loadLibrary`, which converts any pre-RH-192 record
 * first, without the network (`offlineConversion.ts`).
 *
 * See docs/tasks/RH-79-spec.md and docs/tasks/RH-192-spec.md.
 */

import { logger } from '@/lib/logger'
import {
  applyOfflineConversion,
  conversionPending,
  planOfflineConversion,
  type OfflineLibraryView,
} from '@/lib/offlineConversion'
import {
  OFFLINE_SCHEMA_VERSION,
  buildOfflineSnapshot,
  offlineTabCacheKey,
  type OfflineSetlistList,
  type OfflineTabMaterial,
} from '@/lib/offlineSnapshot'
import {
  newestFirst,
  releasableSongIds,
  setlistListBytes,
  setlistSummary,
  songCacheKeys,
  songSummary,
  storedSongBytes,
  type OfflinePlaylistSummary,
  type OfflineSetlistRecord,
  type OfflineSongRecord,
  type OfflineStorePorts,
} from '@/lib/offlineRecords'
import { isSongRecordId, offlineFastViewPath, songRecordId } from '@/lib/offlineSongRecord'
import type { PlaylistEntry } from '@/lib/playlistNav'
import type { Repertoire, ResolvedSongEntry, SongFile } from '@/types/database'
import type { CustomFieldEntry } from '@/types/customField'

/**
 * The Cache Storage caches the tab PDFs and the Fast View documents (RH-195)
 * live in.
 *
 * Re-exported, not defined here: `src/app/sw.ts` needs the same names and must
 * not reach this module, whose graph (`@/lib/logger` → `@sentry/nextjs`) needs
 * node builtins a browser bundle cannot resolve. See
 * `src/lib/offlineCacheNames.ts` (RH-80).
 */
export { OFFLINE_PAGE_CACHE, OFFLINE_TAB_CACHE } from '@/lib/offlineCacheNames'

/** The IndexedDB database and object store holding the records. */
export const OFFLINE_DB_NAME = 'repertoire-hero-offline'
export const OFFLINE_DB_VERSION = 1
export const OFFLINE_SNAPSHOT_STORE = 'snapshots'

/** Everything read for one song being downloaded. */
export interface OfflineSongInput {
  entry: PlaylistEntry
  /** The resolved `(owner, version)` pair; `ownerRowId` may be null (RH-132). */
  repertoire: ResolvedSongEntry
  /** The member's own row for the song; `null` outside a band (RH-83 ER10). */
  personalRepertoire: Repertoire | null
  tabs: SongFile[]
  /** The reader's own custom field values on this version (RH-186). */
  customFields: CustomFieldEntry[]
}

export interface SaveOfflineSongInput {
  song: OfflineSongInput
  bandId: string | null
  /** ISO-8601 UTC, supplied by the caller so the store keeps no clock. */
  savedAt: string
  /**
   * True only from a tap on an idle single-song control. Never clears a stored
   * `true`: a setlist download or a refresh leaves that flag as it was.
   */
  individualDownload?: boolean
}

/** The operations every offline surface goes through. */
export interface OfflineStore {
  /** All-or-nothing for this one song; a song already stored keeps its copy on failure. */
  saveOfflineSong(input: SaveOfflineSongInput): Promise<OfflineSongRecord>
  /** Writes the ordered list; songs a refresh dropped go by the protection rule. */
  saveOfflineSetlist(list: OfflineSetlistList): Promise<OfflineSetlistRecord>
  listOfflineSongs(): Promise<OfflineSongRecord[]>
  listOfflineSetlists(): Promise<OfflineSetlistRecord[]>
  /** Setlists plus individually downloaded songs, as the library lists them. */
  listOfflinePlaylists(): Promise<OfflinePlaylistSummary[]>
  removeOfflineSong(versionId: string, bandId: string | null): Promise<void>
  /** A setlist by playlist id (protection rule), or one song by its record id. */
  removeOfflinePlaylist(recordId: string): Promise<void>
  /** Never throws: a sign-out must always be able to await it. */
  clearAllOfflineData(): Promise<void>
}

/**
 * The two assertions the design insists on, in one place.
 *
 * Vercel Blob is CORS-enabled (measured — see the design's second correction
 * note), so a tab response is a normal one. `type === 'opaque'` would mean the
 * bytes are unreadable and the size unknowable, and a non-`ok` response would
 * cache an error page as a chart. Either fails the song.
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
  recordId: string,
  tab: SongFile,
  written: string[],
): Promise<OfflineTabMaterial> {
  const response = await ports.fetch(tab.file_url)
  assertUsableTabResponse(response, tab.file_url)
  const bytes = (await response.clone().arrayBuffer()).byteLength
  const key = offlineTabCacheKey(recordId, tab.id)
  written.push(key)
  await ports.blobs.put(key, response)
  return { tab, bytes }
}

/**
 * Stores the song's Fast View document for the worker to answer a cold offline
 * navigation with (RH-195), so a song never opened online still opens.
 *
 * Best-effort, after the song is stored: a rejected fetch, an answer that is
 * not a plain same-URL 200 (a redirect to `/login` would store the sign-in
 * page as the song) or a refused write is logged and the save still resolves.
 * Nothing deletes these documents: a removed song's Fast View must still boot
 * offline to say the song is not available.
 */
async function cacheFastViewDocument(ports: OfflineStorePorts, versionId: string, bandId: string | null): Promise<void> {
  const path = offlineFastViewPath(versionId, bandId)
  try {
    const response = await ports.fetch(path)
    if (response.type === 'opaque' || response.redirected || response.status !== 200) {
      throw new Error(`Fast View document answered ${response.status} (${response.type}): ${path}`)
    }
    await ports.pages.put(path, response)
  } catch (error) {
    logger.error('Failed to store the Fast View document', error, { path })
  }
}

/** Deletes each key no song in `remaining` still points at. */
async function deleteUnreferenced(
  ports: OfflineStorePorts,
  keys: string[],
  remaining: OfflineSongRecord[],
): Promise<void> {
  const kept = new Set(remaining.flatMap(songCacheKeys))
  for (const key of new Set(keys)) {
    if (!kept.has(key)) await ports.blobs.delete(key)
  }
}

/** Deletes these songs' bytes, then their records. */
async function deleteSongs(
  ports: OfflineStorePorts,
  view: OfflineLibraryView,
  ids: string[],
): Promise<void> {
  const doomed = new Set(ids)
  const leaving = view.songs.filter((song) => doomed.has(song.playlistId))
  const remaining = view.songs.filter((song) => !doomed.has(song.playlistId))
  await deleteUnreferenced(ports, leaving.flatMap(songCacheKeys), remaining)
  for (const song of leaving) await ports.records.delete(song.playlistId)
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
  let converting: Promise<void> | undefined

  async function resolvePorts(): Promise<OfflineStorePorts> {
    if (resolved) return resolved
    pending ??= import('@/lib/offlineBackends').then((module) => module.createDefaultOfflinePorts())
    resolved = await pending
    return resolved
  }

  /**
   * Every stored record as one song per id plus every setlist, converting any
   * pre-RH-192 record on the way. A conversion that fails is logged and the
   * view still answers, from the legacy records themselves.
   */
  async function loadLibrary(active: OfflineStorePorts): Promise<OfflineLibraryView> {
    const plan = planOfflineConversion(await active.records.list())
    if (conversionPending(plan)) {
      converting ??= applyOfflineConversion(active, plan)
        .catch((error: unknown) => logger.error('Failed to convert the offline library', error))
        .finally(() => {
          converting = undefined
        })
      await converting
    }
    return { songs: plan.songs, setlists: plan.setlists }
  }

  async function writeSong(
    active: OfflineStorePorts,
    input: SaveOfflineSongInput,
    previous: OfflineSongRecord | undefined,
    written: string[],
  ): Promise<OfflineSongRecord> {
    const recordId = songRecordId(input.song.entry.versionId, input.bandId)
    const tabs: OfflineTabMaterial[] = []
    for (const tab of input.song.tabs) tabs.push(await cacheOneTab(active, recordId, tab, written))
    const [song] = buildOfflineSnapshot({
      playlistId: recordId,
      playlistName: input.song.entry.title,
      bandId: input.bandId,
      savedAt: input.savedAt,
      songs: [{ ...input.song, tabs }],
    }).songs
    const record: OfflineSongRecord = {
      ...song,
      kind: 'song',
      playlistId: recordId,
      schemaVersion: OFFLINE_SCHEMA_VERSION,
      bandId: input.bandId,
      savedAt: input.savedAt,
      bytes: storedSongBytes(song),
      individualDownload: input.individualDownload === true || previous?.individualDownload === true,
    }
    // Last, deliberately: the record is what marks the song as on the device.
    await active.records.put(record)
    return record
  }

  async function removeSongById(recordId: string): Promise<void> {
    const active = await resolvePorts()
    await deleteSongs(active, await loadLibrary(active), [recordId])
  }

  return {
    async saveOfflineSong(input) {
      const active = await resolvePorts()
      const recordId = songRecordId(input.song.entry.versionId, input.bandId)
      const view = await loadLibrary(active)
      const previous = view.songs.find((song) => song.playlistId === recordId)
      const others = view.songs.filter((song) => song.playlistId !== recordId)
      const written: string[] = []
      let record: OfflineSongRecord
      try {
        record = await writeSong(active, input, previous, written)
      } catch (error) {
        // Unwinds only what this attempt added; a stored copy keeps its bytes.
        await deleteUnreferenced(active, written, previous ? [...others, previous] : others)
        throw error
      }
      // A refreshed song's files that are gone from its latest version.
      const fresh = new Set(songCacheKeys(record))
      const gone = previous ? songCacheKeys(previous).filter((key) => !fresh.has(key)) : []
      await deleteUnreferenced(active, gone, [...others, record])
      await cacheFastViewDocument(active, input.song.entry.versionId, input.bandId)
      return record
    },

    async saveOfflineSetlist(list) {
      const active = await resolvePorts()
      const view = await loadLibrary(active)
      const previous = view.setlists.find((setlist) => setlist.playlistId === list.playlistId)
      const record: OfflineSetlistRecord = {
        ...list,
        kind: 'setlist',
        schemaVersion: OFFLINE_SCHEMA_VERSION,
        bytes: setlistListBytes(list),
      }
      await active.records.put(record)
      if (previous) {
        const now = new Set(list.entries.map((entry) => songRecordId(entry.versionId, list.bandId)))
        const dropped = previous.entries
          .map((entry) => songRecordId(entry.versionId, previous.bandId))
          .filter((id) => !now.has(id))
        const others = view.setlists.filter((setlist) => setlist.playlistId !== list.playlistId)
        await deleteSongs(active, view, releasableSongIds(dropped, [...others, record], view.songs))
      }
      return record
    },

    async listOfflineSongs() {
      return newestFirst((await loadLibrary(await resolvePorts())).songs)
    },

    async listOfflineSetlists() {
      return (await loadLibrary(await resolvePorts())).setlists
    },

    async listOfflinePlaylists() {
      const { songs, setlists } = await loadLibrary(await resolvePorts())
      return [
        ...setlists.map((setlist) => setlistSummary(setlist, songs)),
        ...songs.filter((song) => song.individualDownload).map(songSummary),
      ]
    },

    removeOfflineSong(versionId, bandId) {
      return removeSongById(songRecordId(versionId, bandId))
    },

    async removeOfflinePlaylist(recordId) {
      if (isSongRecordId(recordId)) return removeSongById(recordId)
      const active = await resolvePorts()
      const view = await loadLibrary(active)
      const setlist = view.setlists.find((row) => row.playlistId === recordId)
      if (!setlist) return
      const others = view.setlists.filter((row) => row.playlistId !== recordId)
      const ids = setlist.entries.map((entry) => songRecordId(entry.versionId, setlist.bandId))
      await deleteSongs(active, view, releasableSongIds(ids, others, view.songs))
      await active.records.delete(recordId)
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
