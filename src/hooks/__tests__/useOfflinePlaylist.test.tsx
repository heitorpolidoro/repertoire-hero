// @vitest-environment jsdom
/**
 * RH-79 / RH-192 — the download controller, over the real store and fake ports.
 *
 * Every test here injects `createOfflineStore(createFakePorts())`: the real
 * store, with only `indexedDB`, Cache Storage and `fetch` replaced, so what is
 * asserted is the fake ports' own contents after the hook has settled.
 *
 * Since RH-192 each song is stored on its own and the playlist as its ordered
 * list: one failing song never stops the others, "Make available offline" and
 * "Try again" fetch only what is missing, and "Refresh offline copy" refetches
 * everything.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import {
  PLAYLIST_READ_FAILED_KEPT,
  useOfflinePlaylist,
  type OfflineDownloadActions,
  type UseOfflinePlaylistOptions,
} from '@/hooks/useOfflinePlaylist'
import { OfflineDownloadButton } from '@/components/playlists/OfflineDownloadButton'
import { OFFLINE_STORE, createOfflineStore } from '@/lib/offlineStore'
import { isSetlistRecord, isSongRecord } from '@/lib/offlineRecords'
import { songRecordId } from '@/lib/offlineSongRecord'
import { createFakePorts, type FakeOfflinePorts } from '@/lib/__tests__/offlineStoreFakes'
import type { Repertoire, ResolvedSongEntry, SongFile } from '@/types/database'

afterEach(cleanup)

function resolvedEntry(versionId: string): ResolvedSongEntry {
  const ownerRowId = versionId.replace(/^v-/, '')
  return {
    ownerRowId,
    song_id: `song-${ownerRowId}`,
    version_id: versionId,
    key: null,
    tuning: null,
    map: null,
    status: 'learning',
    tags: [],
    last_practiced: null,
    lyrics: null,
  }
}

function personalRow(songId: string): Repertoire {
  return {
    id: `personal-${songId}`,
    user_id: 'user-1',
    band_id: null,
    song_id: songId,
    version_id: `v-${songId}`,
    key: null,
    tuning: null,
    map: null,
    status: 'learning',
    tags: [],
    last_practiced: null,
    lyrics: null,
  }
}

function tabRow(id: string, songId: string): SongFile {
  return {
    id,
    user_id: 'user-1',
    song_id: songId,
    title: `Chart ${id}`,
    file_url: `https://store.public.blob.vercel-storage.com/tabs/${id}.pdf`,
    created_at: '2026-05-01T00:00:00Z',
  }
}

const ENTRIES = [
  { repertoireId: 'rep-1', versionId: 'v-rep-1', songId: 'song-rep-1', title: 'Tempo Perdido', artist: 'Legião Urbana' },
  { repertoireId: 'rep-2', versionId: 'v-rep-2', songId: 'song-rep-2', title: 'Faroeste Caboclo', artist: null },
  { repertoireId: 'rep-3', versionId: 'v-rep-3', songId: 'song-rep-3', title: 'Índios', artist: null },
]

function makeActions(): OfflineDownloadActions {
  return {
    getPlaylistDetailsWithEntries: vi.fn().mockResolvedValue({ name: 'Gig', entries: ENTRIES }),
    getResolvedEntryForVersion: vi.fn((versionId: string) => Promise.resolve(resolvedEntry(versionId))),
    getTabs: vi.fn((songId: string) => Promise.resolve([tabRow(`tab-${songId}`, songId)])),
    getPersonalEntryForSong: vi.fn((songId: string) => Promise.resolve(personalRow(songId))),
    getCustomFieldValues: vi.fn((versionId: string) =>
      Promise.resolve([{ fieldId: 'f-preset', name: 'Preset', value: `Preset of ${versionId}` }]),
    ),
  }
}

function setup(overrides: Partial<UseOfflinePlaylistOptions> = {}, ports?: FakeOfflinePorts) {
  const fakePorts = ports ?? createFakePorts()
  const options: UseOfflinePlaylistOptions = {
    playlistId: 'pl-1',
    playlistName: 'Gig',
    bandId: 'band-1',
    actions: makeActions(),
    store: createOfflineStore(fakePorts),
    ...overrides,
  }
  const statuses: string[] = []
  const view = renderHook(() => {
    const controller = useOfflinePlaylist(options)
    statuses.push(controller.status)
    return controller
  })
  return { ...view, ports: fakePorts, options, statuses }
}

function storedSongs(ports: FakeOfflinePorts) {
  return [...ports.records.rows.values()].filter(isSongRecord)
}

function storedVersionIds(ports: FakeOfflinePorts): string[] {
  return storedSongs(ports).map((song) => song.versionId).sort()
}

/** Fails exactly the song whose version is `versionId`, on its files read. */
function failingOn(versionId: string, error: unknown = new Error('network down')) {
  const actions = makeActions()
  actions.getTabs = vi.fn((songId: string) =>
    songId === `song-${versionId.replace(/^v-/, '')}`
      ? Promise.reject(error)
      : Promise.resolve([tabRow(`tab-${songId}`, songId)]),
  )
  return actions
}

describe('importing the store under jsdom (ER6)', () => {
  it('constructs OFFLINE_STORE without touching indexedDB or caches', () => {
    expect(OFFLINE_STORE).toBeDefined()
    expect(typeof OFFLINE_STORE.saveOfflineSong).toBe('function')
    expect('indexedDB' in globalThis).toBe(false)
    expect('caches' in globalThis).toBe(false)
  })
})

describe('useOfflinePlaylist — the happy path', () => {
  it('starts idle when nothing is stored for this playlist', async () => {
    const { result } = setup()

    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(result.current.summary).toBeNull()
    expect(result.current.count).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('goes idle -> downloading -> downloaded, storing each song once and the list in order', async () => {
    const { result, ports } = setup()
    await waitFor(() => expect(result.current.status).toBe('idle'))

    let finished: Promise<void> = Promise.resolve()
    act(() => {
      finished = result.current.download()
    })
    expect(result.current.status).toBe('downloading')
    await act(async () => {
      await finished
    })

    expect(result.current.status).toBe('downloaded')
    expect(result.current.progress).toEqual({ done: 3, total: 3 })
    expect(result.current.count).toEqual({ onDevice: 3, total: 3 })
    expect(result.current.summary?.playlistId).toBe('pl-1')
    expect(result.current.summary?.bytes).toBeGreaterThan(3 * 1024)
    expect(storedVersionIds(ports)).toEqual(['v-rep-1', 'v-rep-2', 'v-rep-3'])
    const list = ports.records.rows.get('pl-1')
    expect(list && isSetlistRecord(list) ? list.entries.map((entry) => entry.versionId) : null).toEqual([
      'v-rep-1',
      'v-rep-2',
      'v-rep-3',
    ])
    // Every song is a setlist song, not an individual download.
    expect(storedSongs(ports).every((song) => !song.individualDownload)).toBe(true)
  })

  it('calls getTabs with the song id, and reads the member own row in band context', async () => {
    const actions = makeActions()
    const { result, ports } = setup({ actions, bandId: 'band-1' })

    await act(async () => {
      await result.current.download()
    })

    expect(vi.mocked(actions.getTabs).mock.calls.map(([id]) => id)).toEqual(['song-rep-1', 'song-rep-2', 'song-rep-3'])
    expect(vi.mocked(actions.getPersonalEntryForSong)).toHaveBeenCalledTimes(3)
    expect(vi.mocked(actions.getCustomFieldValues).mock.calls).toEqual([['v-rep-1'], ['v-rep-2'], ['v-rep-3']])
    const first = ports.records.rows.get(songRecordId('v-rep-1', 'band-1'))
    expect(first && isSongRecord(first) ? first.personalRepertoire?.id : null).toBe('personal-song-rep-1')
    expect(first && isSongRecord(first) ? first.customFields?.[0].value : null).toBe('Preset of v-rep-1')
  })

  it('never reads the personal row outside a band context', async () => {
    const actions = makeActions()
    const { result, ports } = setup({ actions, bandId: null })

    await act(async () => {
      await result.current.download()
    })

    expect(actions.getPersonalEntryForSong).not.toHaveBeenCalled()
    expect(storedSongs(ports).map((song) => song.personalRepertoire)).toEqual([null, null, null])
  })

  it('reports downloaded on mount when the playlist is already stored', async () => {
    const ports = createFakePorts()
    const { result } = setup({}, ports)
    await act(async () => {
      await result.current.download()
    })
    cleanup()

    const second = renderHook(() =>
      useOfflinePlaylist({
        playlistId: 'pl-1',
        playlistName: 'Gig',
        bandId: 'band-1',
        actions: makeActions(),
        store: createOfflineStore(ports),
      }),
    )

    await waitFor(() => expect(second.result.current.status).toBe('downloaded'))
    expect(second.result.current.summary?.playlistName).toBe('Gig')
    expect(second.result.current.count).toEqual({ onDevice: 3, total: 3 })
  })

  it('removes the offline copy and returns to idle', async () => {
    const { result, ports } = setup()
    await act(async () => {
      await result.current.download()
    })

    await act(async () => {
      await result.current.remove()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.summary).toBeNull()
    expect(ports.records.rows.size).toBe(0)
    expect(ports.blobs.entries.size).toBe(0)
  })

  it('reports a failed removal as an error rather than claiming the copy is gone', async () => {
    const ports = createFakePorts()
    const { result } = setup({}, ports)
    await act(async () => {
      await result.current.download()
    })
    ports.blobs.delete = () => Promise.reject('cache vanished')

    await act(async () => {
      await result.current.remove()
    })

    expect(result.current.error).toBe('Failed to remove the offline copy')
    expect(result.current.status).toBe('downloaded')
  })
})

describe('useOfflinePlaylist — per-song failure isolation (RH-192)', () => {
  it('when one song fails during a setlist download, shows the other songs stored, the count one short, and the alert offering Try again', async () => {
    const ports = createFakePorts()
    const actions = failingOn('v-rep-2')
    const { result } = setup({ actions }, ports)

    await act(async () => {
      await result.current.download()
    })

    // The others are stored; the failing one is not, and nothing was rolled back.
    expect(storedVersionIds(ports)).toEqual(['v-rep-1', 'v-rep-3'])
    expect(result.current.status).toBe('downloaded')
    expect(result.current.count).toEqual({ onDevice: 2, total: 3 })
    expect(result.current.error).toBe('1 of 3 songs could not be downloaded.')

    // The control renders the same run's alert with its Try again action.
    cleanup()
    const fresh = createFakePorts()
    render(
      <OfflineDownloadButton
        playlistId="pl-1"
        playlistName="Gig"
        bandId="band-1"
        actions={failingOn('v-rep-2')}
        store={createOfflineStore(fresh)}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Make available offline' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('1 of 3 songs could not be downloaded.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined()
    expect(screen.getByText('Available offline')).toBeDefined()
    expect(storedVersionIds(fresh)).toEqual(['v-rep-1', 'v-rep-3'])
  })

  it('Try again fetches only the songs missing from the device, and M is what that run attempted', async () => {
    const ports = createFakePorts()
    const actions = failingOn('v-rep-2')
    const { result } = setup({ actions }, ports)
    await act(async () => {
      await result.current.download()
    })
    vi.mocked(actions.getResolvedEntryForVersion).mockClear()
    vi.mocked(actions.getTabs).mockImplementation(() => Promise.reject(new Error('still down')))

    await act(async () => {
      await result.current.download()
    })

    expect(vi.mocked(actions.getResolvedEntryForVersion).mock.calls.map(([id]) => id)).toEqual(['v-rep-2'])
    expect(result.current.error).toBe('1 of 1 songs could not be downloaded.')
    expect(result.current.count).toEqual({ onDevice: 2, total: 3 })
  })

  it('Try again that succeeds completes the playlist and clears the alert', async () => {
    const ports = createFakePorts()
    const actions = failingOn('v-rep-2')
    const { result } = setup({ actions }, ports)
    await act(async () => {
      await result.current.download()
    })
    vi.mocked(actions.getTabs).mockImplementation((songId: string) => Promise.resolve([tabRow(`tab-${songId}`, songId)]))

    await act(async () => {
      await result.current.download()
    })

    expect(result.current.error).toBeNull()
    expect(result.current.count).toEqual({ onDevice: 3, total: 3 })
  })

  it('Refresh offline copy refetches every song', async () => {
    const actions = makeActions()
    const { result } = setup({ actions })
    await act(async () => {
      await result.current.download()
    })
    vi.mocked(actions.getResolvedEntryForVersion).mockClear()

    await act(async () => {
      await result.current.refresh()
    })

    expect(vi.mocked(actions.getResolvedEntryForVersion)).toHaveBeenCalledTimes(3)
    expect(result.current.status).toBe('downloaded')
  })

  it('names a quota failure in the partial alert', async () => {
    const ports = createFakePorts()
    const actions = failingOn('v-rep-3', new DOMException('quota', 'QuotaExceededError'))
    const { result } = setup({ actions }, ports)

    await act(async () => {
      await result.current.download()
    })

    expect(result.current.error).toBe('Not enough storage. 1 of 3 songs could not be downloaded.')
  })

  it('counts a song whose entry read answers null as missing', async () => {
    const actions = makeActions()
    actions.getResolvedEntryForVersion = vi.fn((versionId: string) =>
      Promise.resolve(versionId === 'v-rep-2' ? null : resolvedEntry(versionId)),
    )
    const { result, ports } = setup({ actions })

    await act(async () => {
      await result.current.download()
    })

    expect(storedVersionIds(ports)).toEqual(['v-rep-1', 'v-rep-3'])
    expect(result.current.count).toEqual({ onDevice: 2, total: 3 })
  })

  it('keeps no list when every song failed and the playlist was not downloaded before', async () => {
    const actions = makeActions()
    actions.getTabs = vi.fn().mockRejectedValue(new DOMException('quota', 'QuotaExceededError'))
    const { result, ports, statuses } = setup({ actions })

    await act(async () => {
      await result.current.download()
    })

    expect(statuses).not.toContain('downloaded')
    expect(result.current.status).toBe('idle')
    expect(result.current.error).toBe('Not enough storage. Nothing from this playlist was kept.')
    expect(ports.records.rows.size).toBe(0)
    expect(ports.blobs.entries.size).toBe(0)
  })

  it('dismisses the error banner without touching what is stored', async () => {
    const ports = createFakePorts()
    const { result } = setup({ actions: failingOn('v-rep-2') }, ports)
    await act(async () => {
      await result.current.download()
    })

    act(() => result.current.dismissError())

    expect(result.current.error).toBeNull()
    expect(storedVersionIds(ports)).toEqual(['v-rep-1', 'v-rep-3'])
  })
})

describe('useOfflinePlaylist — a failed playlist read (RH-192)', () => {
  it('a failed playlist read on an already downloaded setlist leaves stored records and bytes unchanged and shows Could not reach this playlist. Your offline copy was not changed.', async () => {
    const ports = createFakePorts()
    const actions = makeActions()
    const { result } = setup({ actions }, ports)
    await act(async () => {
      await result.current.download()
    })
    const recordsBefore = structuredClone([...ports.records.rows.entries()])
    const keysBefore = [...ports.blobs.entries.keys()].sort()
    vi.mocked(actions.getPlaylistDetailsWithEntries).mockRejectedValue(new TypeError('Failed to fetch'))

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.error).toBe('Could not reach this playlist. Your offline copy was not changed.')
    expect(PLAYLIST_READ_FAILED_KEPT).toBe(result.current.error)
    expect(result.current.status).toBe('downloaded')
    expect([...ports.records.rows.entries()]).toEqual(recordsBefore)
    expect([...ports.blobs.entries.keys()].sort()).toEqual(keysBefore)
  })

  it('a failed playlist read on a playlist not downloaded keeps nothing and says so', async () => {
    const ports = createFakePorts()
    const actions = makeActions()
    // A song already stored individually stays stored.
    const store = createOfflineStore(ports)
    await store.saveOfflineSong({
      song: { entry: ENTRIES[0], repertoire: resolvedEntry('v-rep-1'), personalRepertoire: null, tabs: [], customFields: [] },
      bandId: 'band-1',
      savedAt: '2026-09-20T18:04:00.000Z',
      individualDownload: true,
    })
    vi.mocked(actions.getPlaylistDetailsWithEntries).mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = setup({ actions }, ports)

    await act(async () => {
      await result.current.download()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.error).toBe('Could not download this playlist. Nothing from this playlist was kept.')
    expect(ports.records.rows.has('pl-1')).toBe(false)
    expect(storedVersionIds(ports)).toEqual(['v-rep-1'])
  })
})

describe('useOfflinePlaylist — the list itself cannot be written', () => {
  it('says the playlist could not be saved, naming a quota failure', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    store.saveOfflineSetlist = () => Promise.reject(new DOMException('quota', 'QuotaExceededError'))
    const { result } = setup({ store }, ports)

    await act(async () => {
      await result.current.download()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.error).toBe('Not enough storage to save this playlist offline.')
  })

  it('stays quiet when reading the library fails on mount', async () => {
    const store = createOfflineStore(createFakePorts())
    store.listOfflineSetlists = () => Promise.reject(new Error('IndexedDB unavailable'))
    const { result } = setup({ store })

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.error).toBeNull()
  })
})

describe('useOfflinePlaylist — a refresh that drops a song', () => {
  it('deletes the dropped song unless another playlist holds it', async () => {
    const ports = createFakePorts()
    const actions = makeActions()
    const { result } = setup({ actions }, ports)
    await act(async () => {
      await result.current.download()
    })
    vi.mocked(actions.getPlaylistDetailsWithEntries).mockResolvedValue({ name: 'Gig', entries: ENTRIES.slice(0, 2) })

    await act(async () => {
      await result.current.refresh()
    })

    expect(storedVersionIds(ports)).toEqual(['v-rep-1', 'v-rep-2'])
    expect(result.current.count).toEqual({ onDevice: 2, total: 2 })
  })
})
