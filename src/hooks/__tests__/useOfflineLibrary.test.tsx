// @vitest-environment jsdom
/**
 * RH-79, RH-194 — the aggregate view `/settings` renders.
 *
 * The library is published through `useSyncExternalStore` over a module-level
 * cache (the `useOfflineStatus.ts` / `useHydrated.ts` precedent) precisely so
 * the mount effect writes no React state: `src/app/settings/page.tsx` already
 * carries one `react-hooks/set-state-in-effect` error and must carry no more.
 *
 * Since RH-194 it is two lists: the downloaded playlists, each measured against
 * its stored list (`N of M songs`, the bytes of its songs on the device), and
 * every stored song once, with where it came from. The total counts each song
 * record once, so two playlists sharing a song do not count it twice.
 *
 * Every test injects `createOfflineStore(createFakePorts())` and reads the
 * fakes back, so the protection rule is asserted against real storage
 * behaviour rather than against a double's bookkeeping. The cache is
 * module-level and outlives a test, so each test waits for names only its own
 * seed holds.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useOfflineLibrary, type OfflineLibraryController } from '@/hooks/useOfflineLibrary'
import { isSongRecord } from '@/lib/offlineRecords'
import { songRecordId } from '@/lib/offlineSongRecord'
import { createOfflineStore, type OfflineStore } from '@/lib/offlineStore'
import {
  createFakePorts,
  seedSetlistOf,
  seedSongInput,
  type FakeOfflinePorts,
} from '@/lib/__tests__/offlineStoreFakes'

afterEach(cleanup)

const SHARED = songRecordId('v-shared', null)
const ONLY_A = songRecordId('v-only-a', null)
const SOLO = songRecordId('v-solo', null)

/**
 * `Set A` holds a shared song, one of its own and one also downloaded on its
 * own; `Set B` holds the shared song only. `Solo` is downloaded individually.
 */
async function sharedLibrary(): Promise<{ store: OfflineStore; ports: FakeOfflinePorts }> {
  const ports = createFakePorts()
  const store = createOfflineStore(ports)
  await seedSetlistOf(store, {
    playlistId: 'pl-a',
    playlistName: 'Set A',
    entries: [
      { versionId: 'v-shared', title: 'Shared song' },
      { versionId: 'v-only-a', title: 'Only in A' },
      { versionId: 'v-solo', title: 'Solo song' },
    ],
  })
  await seedSetlistOf(store, {
    playlistId: 'pl-b',
    playlistName: 'Set B',
    entries: [{ versionId: 'v-shared', title: 'Shared song' }],
  })
  await store.saveOfflineSong({
    song: seedSongInput('v-solo', 'tab-v-solo', 'Solo song'),
    bandId: null,
    savedAt: '2026-09-20T18:04:00.000Z',
    individualDownload: true,
  })
  return { store, ports }
}

/** Each stored song record's own bytes, by record id, read from the fake port. */
function storedSongBytes(ports: FakeOfflinePorts): Map<string, number> {
  const songs = [...ports.records.rows.values()].filter(isSongRecord)
  return new Map(songs.map((song) => [song.playlistId, song.bytes]))
}

function playlist(library: OfflineLibraryController, playlistId: string) {
  return library.playlists.find((row) => row.playlistId === playlistId)
}

function song(library: OfflineLibraryController, recordId: string) {
  return library.songs.find((row) => row.recordId === recordId)
}

async function renderShared() {
  const seeded = await sharedLibrary()
  const view = renderHook(() => useOfflineLibrary({ store: seeded.store }))
  await waitFor(() => expect(view.result.current.playlists.map((row) => row.playlistName).sort()).toEqual(['Set A', 'Set B']))
  return { ...seeded, result: view.result }
}

describe('useOfflineLibrary, two lists (RH-194)', () => {
  it('counts each stored song once in the total when two downloaded playlists share it (ER1)', async () => {
    const { ports, result } = await renderShared()

    const bytes = storedSongBytes(ports)
    const uniqueSum = [...bytes.values()].reduce((sum, size) => sum + size, 0)
    const playlistSum = result.current.playlists.reduce((sum, row) => sum + row.bytes, 0)
    expect(bytes.size).toBe(3)
    expect(result.current.totalBytes).toBe(uniqueSum)
    // The shared song sits in both playlist rows, but in the total only once.
    expect(result.current.totalBytes).toBeLessThan(playlistSum)
    expect(playlistSum - result.current.totalBytes).toBe(bytes.get(SHARED))
  })

  it('measures each playlist against its stored list: N of M songs and the bytes of the songs on the device', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await seedSetlistOf(store, {
      playlistId: 'pl-partial',
      playlistName: 'Partial set',
      entries: [
        { versionId: 'v-one', title: 'One' },
        { versionId: 'v-two', title: 'Two' },
        { versionId: 'v-missing', title: 'Missing' },
      ],
      notStored: ['v-missing'],
    })
    const { result } = renderHook(() => useOfflineLibrary({ store }))

    await waitFor(() => expect(result.current.playlists.map((row) => row.playlistName)).toEqual(['Partial set']))
    const bytes = storedSongBytes(ports)
    expect(result.current.playlists[0]).toMatchObject({
      playlistId: 'pl-partial',
      storedCount: 2,
      totalCount: 3,
      bytes: bytes.get(songRecordId('v-one', null))! + bytes.get(songRecordId('v-two', null))!,
      downloadedAgo: expect.stringMatching(/days ago$/),
    })
  })

  it('lists every stored song once with its size, its age and where it came from', async () => {
    const { ports, result } = await renderShared()

    const bytes = storedSongBytes(ports)
    expect(result.current.songs.map((row) => row.recordId).sort()).toEqual([ONLY_A, SHARED, SOLO].sort())
    expect(song(result.current, SHARED)).toMatchObject({
      title: 'Shared song',
      bytes: bytes.get(SHARED),
      provenance: 'In Set A, In Set B',
      downloadedAgo: expect.stringMatching(/days ago$/),
    })
    expect(song(result.current, ONLY_A)?.provenance).toBe('In Set A')
    expect(song(result.current, SOLO)?.provenance).toBe('In Set A, Downloaded individually')
  })

  it('names a song held by no list and not downloaded individually as stored on the device', async () => {
    const store = createOfflineStore(createFakePorts())
    await store.saveOfflineSong({
      song: seedSongInput('v-loose', 'tab-loose', 'Loose song'),
      bandId: null,
      savedAt: new Date().toISOString(),
    })
    const { result } = renderHook(() => useOfflineLibrary({ store }))

    await waitFor(() => expect(result.current.songs.map((row) => row.title)).toEqual(['Loose song']))
    expect(result.current.songs[0]).toMatchObject({ provenance: 'Stored on device', downloadedAgo: 'today' })
    expect(result.current.playlists).toEqual([])
  })

  it('removes a playlist under the protection rule: songs another playlist holds or downloaded individually stay', async () => {
    const { ports, result } = await renderShared()

    await act(async () => {
      await result.current.removePlaylist('pl-a')
    })

    await waitFor(() => expect(result.current.playlists.map((row) => row.playlistId)).toEqual(['pl-b']))
    expect(result.current.songs.map((row) => row.recordId).sort()).toEqual([SHARED, SOLO].sort())
    expect(ports.records.rows.has(ONLY_A)).toBe(false)
    expect(ports.blobs.keysFor(ONLY_A)).toEqual([])
    expect(song(result.current, SOLO)?.provenance).toBe('Downloaded individually')
    expect(song(result.current, SHARED)?.provenance).toBe('In Set B')
  })

  it('removes a song and lowers the stored count and size of every playlist holding it', async () => {
    const { ports, result } = await renderShared()
    const bytes = storedSongBytes(ports)
    const before = { a: playlist(result.current, 'pl-a')!, total: result.current.totalBytes }

    await act(async () => {
      await result.current.removeSong(SHARED)
    })

    await waitFor(() => expect(song(result.current, SHARED)).toBeUndefined())
    expect(ports.records.rows.has(SHARED)).toBe(false)
    expect(ports.blobs.keysFor(SHARED)).toEqual([])
    // Both lists stay stored; only what they count changes.
    expect(ports.records.rows.has('pl-a')).toBe(true)
    expect(ports.records.rows.has('pl-b')).toBe(true)
    expect(result.current.totalBytes).toBe(before.total - bytes.get(SHARED)!)
    expect(playlist(result.current, 'pl-a')).toMatchObject({
      storedCount: 2,
      totalCount: 3,
      bytes: before.a.bytes - bytes.get(SHARED)!,
    })
    expect(playlist(result.current, 'pl-b')).toMatchObject({ storedCount: 0, totalCount: 1, bytes: 0 })
  })

  it('leaves the library as it is when asked to remove a song it does not list', async () => {
    const { ports, result } = await renderShared()

    await act(async () => {
      await result.current.removeSong(songRecordId('v-unknown', null))
    })

    expect(result.current.songs).toHaveLength(3)
    expect(storedSongBytes(ports).size).toBe(3)
  })
})

describe('useOfflineLibrary', () => {
  it('publishes an empty library when nothing is stored', async () => {
    const store = createOfflineStore(createFakePorts())

    const { result } = renderHook(() => useOfflineLibrary({ store }))

    await waitFor(() => expect(result.current.songs).toEqual([]))
    expect(result.current.playlists).toEqual([])
    expect(result.current.totalBytes).toBe(0)
  })

  it('omits the quota line entirely when the browser offers no estimate', async () => {
    const store = createOfflineStore(createFakePorts())

    const { result } = renderHook(() => useOfflineLibrary({ store }))

    await waitFor(() => expect(result.current.songs).toEqual([]))
    // jsdom implements no `navigator.storage`, which is exactly the
    // "API absent" case: no placeholder, no spinner, no line.
    expect(result.current.quota).toBeNull()
  })

  it('publishes an empty library rather than throwing when the record port fails', async () => {
    const { store, result } = await renderShared()
    store.listOfflineSongs = () => Promise.reject(new Error('IndexedDB unavailable'))

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.playlists).toEqual([])
    expect(result.current.songs).toEqual([])
    expect(result.current.totalBytes).toBe(0)
  })
})
