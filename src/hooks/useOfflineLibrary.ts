import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { logger } from '@/lib/logger'
import { formatDownloadedAgo, readOfflineQuota, type OfflineQuota } from '@/lib/offlineFormat'
import {
  liveOfflineCount,
  newestFirst,
  setlistSongIds,
  type OfflineSetlistRecord,
  type OfflineSongRecord,
} from '@/lib/offlineRecords'
import { OFFLINE_STORE, type OfflineStore } from '@/lib/offlineStore'

/**
 * The aggregate view of what this device has stored offline (RH-79, RH-194).
 *
 * Shaped like `useOfflineStatus.ts` / `useHydrated.ts` on purpose: the library
 * lives in a module-level cache published through `useSyncExternalStore`, and
 * the mount effect only calls `refresh()`, which writes to that cache and
 * notifies subscribers. `useState` + `useEffect` would be the obvious spelling
 * and is a `react-hooks/set-state-in-effect` error under this repository's
 * eslint config — `/settings` carries one such error already and must carry no
 * more.
 *
 * Since RH-192 a song is stored once however many setlists hold it, so the
 * library is two lists (RH-194): the downloaded playlists, each measured
 * against its stored list, and every stored song once. The total counts each
 * song record once, so it can be less than the playlist rows added up.
 *
 * The cache is keyed by nothing and refreshed *through the passed store*, so a
 * test injecting a fake reads that fake's rows.
 *
 * `downloadedAgo` and `provenance` are derived when the library is read, not
 * while rendering: reading the clock during render is a `react-hooks/purity`
 * error, and "how old is this copy" is genuinely a property of the read.
 */

/** One downloaded playlist as a row renders it. */
export interface OfflinePlaylistRow {
  playlistId: string
  playlistName: string
  savedAt: string
  /** How many of the stored list's entries have their song on this device. */
  storedCount: number
  /** How many entries the stored list holds. */
  totalCount: number
  /** The bytes of this playlist's songs on the device; its list itself is not counted. */
  bytes: number
  downloadedAgo: string
}

/** One stored song record as a row renders it. */
export interface OfflineSongRow {
  /** `songRecordId(versionId, bandId)`, the record's key. */
  recordId: string
  versionId: string
  bandId: string | null
  title: string
  savedAt: string
  bytes: number
  downloadedAgo: string
  /** `In Friday Gig, Downloaded individually`: the playlists holding it, then an individual download. */
  provenance: string
}

interface OfflineLibrary {
  playlists: OfflinePlaylistRow[]
  songs: OfflineSongRow[]
  /** Each stored song record's `bytes`, counted once. */
  totalBytes: number
}

const EMPTY_LIBRARY: OfflineLibrary = { playlists: [], songs: [], totalBytes: 0 }

/** Shown for a song no stored playlist holds and nobody downloaded individually. */
const UNHELD_PROVENANCE = 'Stored on device'

let library: OfflineLibrary = EMPTY_LIBRARY
const listeners = new Set<() => void>()

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

function getSnapshot(): OfflineLibrary {
  return library
}

function getServerSnapshot(): OfflineLibrary {
  // The server cannot know what a device stored; an empty library keeps the
  // server render and the hydration render identical.
  return EMPTY_LIBRARY
}

function publish(next: OfflineLibrary): void {
  library = next
  for (const listener of listeners) listener()
}

function playlistRow(
  setlist: OfflineSetlistRecord,
  songBytes: ReadonlyMap<string, number>,
  now: number,
): OfflinePlaylistRow {
  const versionIds = setlist.entries.map((entry) => entry.versionId)
  const count = liveOfflineCount(versionIds, setlist.bandId, songBytes)
  return {
    playlistId: setlist.playlistId,
    playlistName: setlist.playlistName,
    savedAt: setlist.savedAt,
    storedCount: count.stored,
    totalCount: count.total,
    bytes: count.bytes,
    downloadedAgo: formatDownloadedAgo(setlist.savedAt, now),
  }
}

function provenance(song: OfflineSongRecord, setlists: OfflineSetlistRecord[]): string {
  const sources = setlists
    .filter((setlist) => setlistSongIds(setlist).includes(song.playlistId))
    .map((setlist) => `In ${setlist.playlistName}`)
  if (song.individualDownload) sources.push('Downloaded individually')
  return sources.length > 0 ? sources.join(', ') : UNHELD_PROVENANCE
}

function songRow(song: OfflineSongRecord, setlists: OfflineSetlistRecord[], now: number): OfflineSongRow {
  return {
    recordId: song.playlistId,
    versionId: song.entry.versionId,
    bandId: song.bandId,
    title: song.entry.title,
    savedAt: song.savedAt,
    bytes: song.bytes,
    downloadedAgo: formatDownloadedAgo(song.savedAt, now),
    provenance: provenance(song, setlists),
  }
}

/** Both lists and the deduplicated total, read off the stored records at `now`. */
function buildLibrary(
  setlists: OfflineSetlistRecord[],
  songs: OfflineSongRecord[],
  now: number,
): OfflineLibrary {
  const ordered = newestFirst(setlists)
  const songBytes = new Map(songs.map((song) => [song.playlistId, song.bytes]))
  return {
    playlists: ordered.map((setlist) => playlistRow(setlist, songBytes, now)),
    songs: songs.map((song) => songRow(song, ordered, now)),
    totalBytes: songs.reduce((total, song) => total + song.bytes, 0),
  }
}

export interface UseOfflineLibraryOptions {
  /** Defaults to the real `OFFLINE_STORE`; a test injects its own. */
  store?: OfflineStore
}

export interface OfflineLibraryController {
  playlists: OfflinePlaylistRow[]
  songs: OfflineSongRow[]
  /** Each stored song's own `bytes`, counted once — never the Storage API. */
  totalBytes: number
  /** `null` whenever the browser offers no usable estimate; the line is then omitted. */
  quota: OfflineQuota | null
  refresh: () => Promise<void>
  /** Removes a playlist's list and only the songs nothing else keeps (the protection rule). */
  removePlaylist: (playlistId: string) => Promise<void>
  /** Removes one song; every playlist list stays stored and counts one fewer. */
  removeSong: (recordId: string) => Promise<void>
}

/** The browser's own storage estimate, when this platform offers one. */
function readQuota(): Promise<OfflineQuota | null> {
  return readOfflineQuota(typeof navigator === 'undefined' ? undefined : navigator.storage)
}

export function useOfflineLibrary({
  store = OFFLINE_STORE,
}: UseOfflineLibraryOptions = {}): OfflineLibraryController {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const [quota, setQuota] = useState<OfflineQuota | null>(null)

  const refresh = useCallback(async () => {
    try {
      const setlists = await store.listOfflineSetlists()
      const songs = await store.listOfflineSongs()
      publish(buildLibrary(setlists, songs, Date.now()))
    } catch (error) {
      logger.error('Failed to read the offline library', error)
      publish(EMPTY_LIBRARY)
    }
  }, [store])

  useEffect(() => {
    // Writes to the module-level cache, never to React state.
    void refresh()
  }, [refresh])

  useEffect(() => {
    let active = true
    readQuota()
      .then((estimate) => {
        if (active) setQuota(estimate)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const removePlaylist = useCallback(
    async (playlistId: string) => {
      await store.removeOfflinePlaylist(playlistId)
      await refresh()
    },
    [refresh, store],
  )

  const removeSong = useCallback(
    async (recordId: string) => {
      const row = library.songs.find((song) => song.recordId === recordId)
      if (row) await store.removeOfflineSong(row.versionId, row.bandId)
      await refresh()
    },
    [refresh, store],
  )

  return {
    playlists: current.playlists,
    songs: current.songs,
    totalBytes: current.totalBytes,
    quota,
    refresh,
    removePlaylist,
    removeSong,
  }
}
