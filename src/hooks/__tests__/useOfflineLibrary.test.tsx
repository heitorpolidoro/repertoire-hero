// @vitest-environment jsdom
/**
 * RH-79 — the aggregate view `/settings` renders.
 *
 * The library is published through `useSyncExternalStore` over a module-level
 * cache (the `useOfflineStatus.ts` / `useHydrated.ts` precedent) precisely so
 * the mount effect writes no React state: `src/app/settings/page.tsx` already
 * carries one `react-hooks/set-state-in-effect` error and must carry no more.
 *
 * Every test injects `createOfflineStore(createFakePorts())` and reads the
 * fakes back, so "removing one playlist leaves the other intact" is asserted
 * against real storage behaviour rather than against a double's bookkeeping.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useOfflineLibrary } from '@/hooks/useOfflineLibrary'
import { songRecordId } from '@/lib/offlineSongRecord'
import { createOfflineStore, type OfflineStore } from '@/lib/offlineStore'
import {
  createFakePorts,
  seedSetlist,
  seedSongInput,
  type FakeOfflinePorts,
} from '@/lib/__tests__/offlineStoreFakes'

afterEach(cleanup)

async function seededStore(): Promise<{ store: OfflineStore; ports: FakeOfflinePorts }> {
  const ports = createFakePorts()
  const store = createOfflineStore(ports)
  await seedSetlist(store, 'pl-1', 'Playlist pl-1', 'tab-a')
  await seedSetlist(store, 'pl-2', 'Playlist pl-2', 'tab-b')
  return { store, ports }
}

describe('useOfflineLibrary, song records (ER8)', () => {
  it('flags a stored single-song record as a song and leaves playlists unflagged', async () => {
    const { store } = await seededStore()
    const songId = songRecordId('version-1', null)
    await store.saveOfflineSong({
      song: seedSongInput('version-1', 'tab-s', 'Tempo Perdido'),
      bandId: null,
      savedAt: '2026-09-20T18:04:00.000Z',
      individualDownload: true,
    })

    const { result } = renderHook(() => useOfflineLibrary({ store }))

    await waitFor(() => expect(result.current.rows).toHaveLength(3))
    const byId = new Map(result.current.rows.map((row) => [row.playlistId, row]))
    expect(byId.get(songId)?.isSong).toBe(true)
    expect(byId.get(songId)?.playlistName).toBe('Tempo Perdido')
    expect(byId.get('pl-1')?.isSong).toBe(false)
  })
})

describe('useOfflineLibrary', () => {
  it('publishes what is stored, and totals the records own bytes', async () => {
    const { store, ports } = await seededStore()

    const { result } = renderHook(() => useOfflineLibrary({ store }))

    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    // Each playlist counts its list plus its one stored song.
    const stored = [...ports.records.rows.values()]
    expect(result.current.rows.map((row) => row.playlistId).sort()).toEqual(['pl-1', 'pl-2'])
    expect(result.current.totalBytes).toBe(stored.reduce((sum, row) => sum + row.bytes, 0))
  })

  it('removes one playlist and leaves the other record and its cached keys intact', async () => {
    const { store, ports } = await seededStore()
    const { result } = renderHook(() => useOfflineLibrary({ store }))
    await waitFor(() => expect(result.current.rows).toHaveLength(2))

    await act(async () => {
      await result.current.remove('pl-1')
    })

    await waitFor(() => expect(result.current.rows.map((row) => row.playlistId)).toEqual(['pl-2']))
    expect(ports.blobs.keysFor(songRecordId('v-pl-1', null))).toEqual([])
    expect(ports.blobs.keysFor(songRecordId('v-pl-2', null))).toEqual([
      `/__offline-tab/${songRecordId('v-pl-2', null)}/tab-b`,
    ])
    expect(ports.records.rows.has('pl-2')).toBe(true)
  })

  it('publishes an empty library when nothing is stored', async () => {
    const store = createOfflineStore(createFakePorts())

    const { result } = renderHook(() => useOfflineLibrary({ store }))

    await waitFor(() => expect(result.current.rows).toEqual([]))
    expect(result.current.totalBytes).toBe(0)
  })

  it('omits the quota line entirely when the browser offers no estimate', async () => {
    const store = createOfflineStore(createFakePorts())

    const { result } = renderHook(() => useOfflineLibrary({ store }))

    await waitFor(() => expect(result.current.rows).toEqual([]))
    // jsdom implements no `navigator.storage`, which is exactly the
    // "API absent" case: no placeholder, no spinner, no line.
    expect(result.current.quota).toBeNull()
  })

  it('publishes an empty library rather than throwing when the record port fails', async () => {
    const store = createOfflineStore(createFakePorts())
    store.listOfflinePlaylists = () => Promise.reject(new Error('IndexedDB unavailable'))

    const { result } = renderHook(() => useOfflineLibrary({ store }))

    await waitFor(() => expect(result.current.rows).toEqual([]))
    expect(result.current.totalBytes).toBe(0)
  })
})
