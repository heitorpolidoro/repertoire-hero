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
import { createOfflineStore, type OfflineStore, type SaveOfflinePlaylistInput } from '@/lib/offlineStore'
import { createFakePorts, type FakeOfflinePorts } from '@/lib/__tests__/offlineStoreFakes'
import type { Repertoire } from '@/types/database'

afterEach(cleanup)

function saveInput(playlistId: string, tabId: string): SaveOfflinePlaylistInput {
  const repertoire: Repertoire = {
    id: 'rep-1',
    user_id: null,
    band_id: null,
    song_id: 'song-1',
    version_id: 'version-1',
    key: null,
    tuning: null,
    map: null,
    status: 'learning',
    tags: [],
    last_practiced: null,
    lyrics: null,
  }
  return {
    playlistId,
    playlistName: `Playlist ${playlistId}`,
    bandId: null,
    savedAt: '2026-09-20T18:04:00.000Z',
    songs: [
      {
        entry: { repertoireId: 'rep-1', songId: 'song-1', title: 'Song', artist: null },
        repertoire,
        tabs: [
          {
            id: tabId,
            repertoire_id: 'rep-1',
            title: 'Chart',
            file_url: `https://store.public.blob.vercel-storage.com/tabs/${tabId}.pdf`,
            created_at: '2026-05-01T00:00:00Z',
          },
        ],
      },
    ],
  }
}

async function seededStore(): Promise<{ store: OfflineStore; ports: FakeOfflinePorts }> {
  const ports = createFakePorts()
  const store = createOfflineStore(ports)
  await store.saveOfflinePlaylist(saveInput('pl-1', 'tab-a'))
  await store.saveOfflinePlaylist(saveInput('pl-2', 'tab-b'))
  return { store, ports }
}

describe('useOfflineLibrary', () => {
  it('publishes what is stored, and totals the records own bytes', async () => {
    const { store, ports } = await seededStore()

    const { result } = renderHook(() => useOfflineLibrary({ store }))

    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    const stored = [...ports.records.rows.values()]
    expect(result.current.rows.map((row) => row.playlistId).sort()).toEqual(['pl-1', 'pl-2'])
    expect(result.current.totalBytes).toBe(stored[0].bytes + stored[1].bytes)
  })

  it('removes one playlist and leaves the other record and its cached keys intact', async () => {
    const { store, ports } = await seededStore()
    const { result } = renderHook(() => useOfflineLibrary({ store }))
    await waitFor(() => expect(result.current.rows).toHaveLength(2))

    await act(async () => {
      await result.current.remove('pl-1')
    })

    await waitFor(() => expect(result.current.rows.map((row) => row.playlistId)).toEqual(['pl-2']))
    expect(ports.blobs.keysFor('pl-1')).toEqual([])
    expect(ports.blobs.keysFor('pl-2')).toEqual(['/__offline-tab/pl-2/tab-b'])
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
