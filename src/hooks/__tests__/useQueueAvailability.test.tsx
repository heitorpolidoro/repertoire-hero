// @vitest-environment jsdom
/**
 * RH-196 — which queue entries are stored on this device, read only offline.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, renderHook, cleanup } from '@testing-library/react'
import { useQueueAvailability, type QueueAvailabilityStore } from '../useQueueAvailability'
import type { OfflineSongRecord } from '@/lib/offlineRecords'
import type { SongQueueEntry } from '@/lib/songQueue'

afterEach(cleanup)

const ENTRIES: SongQueueEntry[] = [
  { versionId: 'v-1', title: 'One', artist: null },
  { versionId: 'v-2', title: 'Two', artist: null },
  { versionId: 'v-3', title: 'Three', artist: null },
]

/** Stored songs, by version and owner context; only those two fields matter here. */
function storeOf(stored: Array<{ versionId: string; bandId: string | null }>): QueueAvailabilityStore {
  return {
    listOfflineSongs: vi.fn(() => Promise.resolve(stored as unknown as OfflineSongRecord[])),
  }
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useQueueAvailability', () => {
  it('is null online and never reads the store', async () => {
    const store = storeOf([{ versionId: 'v-1', bandId: null }])
    const { result } = renderHook(() => useQueueAvailability(ENTRIES, false, store))
    await flush()

    expect(result.current).toBeNull()
    expect(store.listOfflineSongs).not.toHaveBeenCalled()
  })

  it('is null for an empty queue and never reads the store', async () => {
    const store = storeOf([])
    const { result } = renderHook(() => useQueueAvailability([], true, store))
    await flush()

    expect(result.current).toBeNull()
    expect(store.listOfflineSongs).not.toHaveBeenCalled()
  })

  it('offline, is null until the read settles, then holds the stored queue versions in any context', async () => {
    const store = storeOf([
      { versionId: 'v-1', bandId: null },
      // A band-context copy still answers the version (the fallback rule).
      { versionId: 'v-3', bandId: 'band-7' },
      // Stored, but not in this queue.
      { versionId: 'v-9', bandId: null },
    ])
    const { result } = renderHook(() => useQueueAvailability(ENTRIES, true, store))
    expect(result.current).toBeNull()

    await flush()
    expect(result.current).toEqual(new Set(['v-1', 'v-3']))
  })

  it('goes back to null when the connection returns', async () => {
    const store = storeOf([{ versionId: 'v-1', bandId: null }])
    const { result, rerender } = renderHook(({ offline }) => useQueueAvailability(ENTRIES, offline, store), {
      initialProps: { offline: true },
    })
    await flush()
    expect(result.current).toEqual(new Set(['v-1']))

    rerender({ offline: false })
    expect(result.current).toBeNull()
  })

  it('stays null when the store read fails', async () => {
    const store: QueueAvailabilityStore = {
      listOfflineSongs: () => Promise.reject(new Error('IndexedDB unavailable')),
    }
    const { result } = renderHook(() => useQueueAvailability(ENTRIES, true, store))
    await flush()

    expect(result.current).toBeNull()
  })

  it('ignores a read that settles after the hook is gone', async () => {
    let resolve: (rows: OfflineSongRecord[]) => void = () => {}
    const store: QueueAvailabilityStore = {
      listOfflineSongs: () =>
        new Promise((done) => {
          resolve = done
        }),
    }
    const { result, unmount } = renderHook(() => useQueueAvailability(ENTRIES, true, store))
    unmount()
    resolve([{ versionId: 'v-1' } as unknown as OfflineSongRecord])
    await flush()

    expect(result.current).toBeNull()
  })
})
