import { useEffect, useState } from 'react'
import { logger } from '@/lib/logger'
import { OFFLINE_STORE, type OfflineStore } from '@/lib/offlineStore'
import type { SongQueueEntry } from '@/lib/songQueue'

/** The one store read this hook makes. */
export type QueueAvailabilityStore = Pick<OfflineStore, 'listOfflineSongs'>

interface Availability {
  /** The queue the read answered for, so a different queue never reuses it. */
  key: string
  versionIds: ReadonlySet<string>
}

/**
 * Which entries of the queue are stored on this device (RH-196).
 *
 * `null` means "treat every entry as available": online, for an empty queue,
 * before the offline read settles and when it fails. Only offline is the store
 * read, and a version counts as available when **any** owner context holds it —
 * the same fallback `getResolvedEntryForVersion` answers with offline
 * (`src/lib/offlineFirst.ts`), so a song marked available always opens.
 *
 * The state is set from the read's promise, never synchronously in the effect,
 * and is tagged with the queue it answered so a stale answer is never served.
 */
export function useQueueAvailability(
  entries: SongQueueEntry[],
  offline: boolean,
  store: QueueAvailabilityStore = OFFLINE_STORE,
): ReadonlySet<string> | null {
  const key = entries.map((entry) => entry.versionId).join('\n')
  const [availability, setAvailability] = useState<Availability | null>(null)
  const shouldRead = offline && entries.length > 0

  useEffect(() => {
    if (!shouldRead) return
    let active = true
    const queued = new Set(key.split('\n'))
    store
      .listOfflineSongs()
      .then((songs) => {
        if (!active) return
        const versionIds = new Set(songs.map((song) => song.versionId).filter((id) => queued.has(id)))
        setAvailability({ key, versionIds })
      })
      .catch((cause: unknown) => logger.error('Failed to read the offline library', cause))
    return () => {
      active = false
    }
  }, [key, shouldRead, store])

  if (!shouldRead || availability?.key !== key) return null
  return availability.versionIds
}
