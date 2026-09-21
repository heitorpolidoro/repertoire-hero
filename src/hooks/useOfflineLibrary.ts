import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { logger } from '@/lib/logger'
import { formatDownloadedAgo, readOfflineQuota, type OfflineQuota } from '@/lib/offlineFormat'
import { OFFLINE_STORE, type OfflinePlaylistSummary, type OfflineStore } from '@/lib/offlineStore'

/**
 * The aggregate view of what this device has stored offline (RH-79).
 *
 * Shaped like `useOfflineStatus.ts` / `useHydrated.ts` on purpose: the library
 * lives in a module-level cache published through `useSyncExternalStore`, and
 * the mount effect only calls `refresh()`, which writes to that cache and
 * notifies subscribers. `useState` + `useEffect` would be the obvious spelling
 * and is a `react-hooks/set-state-in-effect` error under this repository's
 * eslint config — `/settings` carries one such error already and must carry no
 * more.
 *
 * The cache is keyed by nothing and refreshed *through the passed store*, so a
 * test injecting a fake reads that fake's rows.
 */

/**
 * One stored playlist as a row renders it.
 *
 * `downloadedAgo` is derived when the library is read, not while rendering:
 * reading the clock during render is a `react-hooks/purity` error, and "how old
 * is this copy" is genuinely a property of the read, not of the paint.
 */
export interface OfflinePlaylistRow extends OfflinePlaylistSummary {
  downloadedAgo: string
}

const EMPTY_LIBRARY: OfflinePlaylistRow[] = []

let library: OfflinePlaylistRow[] = EMPTY_LIBRARY
const listeners = new Set<() => void>()

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

function getSnapshot(): OfflinePlaylistRow[] {
  return library
}

function getServerSnapshot(): OfflinePlaylistRow[] {
  // The server cannot know what a device stored; an empty library keeps the
  // server render and the hydration render identical.
  return EMPTY_LIBRARY
}

function publish(rows: OfflinePlaylistRow[]): void {
  library = rows
  for (const listener of listeners) listener()
}

export interface UseOfflineLibraryOptions {
  /** Defaults to the real `OFFLINE_STORE`; a test injects its own. */
  store?: OfflineStore
}

export interface OfflineLibraryController {
  rows: OfflinePlaylistRow[]
  /** The sum of the stored records' own `bytes` — never the Storage API. */
  totalBytes: number
  /** `null` whenever the browser offers no usable estimate; the line is then omitted. */
  quota: OfflineQuota | null
  refresh: () => Promise<void>
  remove: (playlistId: string) => Promise<void>
}

/** The browser's own storage estimate, when this platform offers one. */
function readQuota(): Promise<OfflineQuota | null> {
  return readOfflineQuota(typeof navigator === 'undefined' ? undefined : navigator.storage)
}

export function useOfflineLibrary({
  store = OFFLINE_STORE,
}: UseOfflineLibraryOptions = {}): OfflineLibraryController {
  const rows = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const [quota, setQuota] = useState<OfflineQuota | null>(null)

  const refresh = useCallback(async () => {
    try {
      const now = Date.now()
      publish(
        (await store.listOfflinePlaylists()).map((row) => ({
          ...row,
          downloadedAgo: formatDownloadedAgo(row.savedAt, now),
        })),
      )
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

  const remove = useCallback(
    async (playlistId: string) => {
      await store.removeOfflinePlaylist(playlistId)
      await refresh()
    },
    [refresh, store],
  )

  return {
    rows,
    totalBytes: rows.reduce((total, row) => total + row.bytes, 0),
    quota,
    refresh,
    remove,
  }
}
