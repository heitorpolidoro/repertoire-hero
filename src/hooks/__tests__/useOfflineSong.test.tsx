// @vitest-environment jsdom
/**
 * RH-116 — the single-song download controller, over the real store and fake
 * ports. Assertions read the fake ports' own contents after the hook settles.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useOfflineSong } from '@/hooks/useOfflineSong'
import type { OfflineCaptureActions } from '@/lib/offlineCapture'
import { songRecordId } from '@/lib/offlineSongRecord'
import { createOfflineStore } from '@/lib/offlineStore'
import { createFakePorts, type FakeOfflinePorts } from '@/lib/__tests__/offlineStoreFakes'
import type { Repertoire, ResolvedSongEntry, SongFile } from '@/types/database'

afterEach(cleanup)

const OWNER_ROW_ID = 'owner-row-9'

function resolved(overrides: Partial<ResolvedSongEntry> = {}): ResolvedSongEntry {
  return {
    ownerRowId: OWNER_ROW_ID,
    song_id: 'song-7',
    version_id: 'v-7',
    key: null,
    tuning: null,
    map: null,
    status: 'learning',
    tags: [],
    last_practiced: null,
    lyrics: null,
    song: {
      id: 'song-7',
      title: 'Tempo Perdido',
      artist: 'Legião Urbana',
      album: null,
      standard_key: null,
      cover_url: null,
      duration_seconds: null,
      links: [],
      created_at: '2026-01-01T00:00:00Z',
    },
    ...overrides,
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

function personalRow(songId: string): Repertoire {
  return {
    id: `personal-${songId}`,
    user_id: 'user-1',
    band_id: null,
    song_id: songId,
    version_id: 'v-personal',
    key: null,
    tuning: null,
    map: null,
    status: 'learning',
    tags: [],
    last_practiced: null,
    lyrics: 'mine',
  }
}

function makeActions(overrides: Partial<OfflineCaptureActions> = {}): OfflineCaptureActions {
  return {
    getResolvedEntryForVersion: vi.fn(() => Promise.resolve(resolved())),
    getTabs: vi.fn((songId: string) => Promise.resolve([tabRow('tab-a', songId)])),
    getPersonalEntryForSong: vi.fn((songId: string) => Promise.resolve(personalRow(songId))),
    ...overrides,
  }
}

function setup(
  options: { bandId?: string | null; actions?: OfflineCaptureActions; ports?: FakeOfflinePorts } = {},
) {
  const ports = options.ports ?? createFakePorts()
  const actions = options.actions ?? makeActions()
  const bandId = options.bandId === undefined ? 'band-1' : options.bandId
  // One store for the whole render: a fresh one per render would change the
  // hook's dependencies on every pass.
  const store = createOfflineStore(ports)
  const view = renderHook(() => useOfflineSong({ versionId: 'v-7', bandId, actions, store }))
  return { ...view, ports, actions }
}

describe('useOfflineSong — download', () => {
  it('stores exactly one record holding exactly that version (ER1)', async () => {
    const { result, ports } = setup()
    await waitFor(() => expect(result.current.status).toBe('idle'))

    await act(async () => {
      await result.current.download()
    })

    expect(result.current.status).toBe('downloaded')
    expect(result.current.progress).toEqual({ done: 1, total: 1 })
    expect(ports.records.rows.size).toBe(1)
    const record = [...ports.records.rows.values()][0]
    expect(record.playlistId).toBe(songRecordId('v-7', 'band-1'))
    expect(record.playlistName).toBe('Tempo Perdido')
    expect(record.snapshot.songs).toHaveLength(1)
    expect(record.snapshot.songs[0].versionId).toBe('v-7')
    expect(record.snapshot.songs[0].personalRepertoire?.lyrics).toBe('mine')
    expect(ports.blobs.keysFor(record.playlistId)).toHaveLength(1)
  })

  it('passes the song id, never the owner row id, to getTabs (ER2)', async () => {
    const { result, actions } = setup()
    await waitFor(() => expect(result.current.status).toBe('idle'))

    await act(async () => {
      await result.current.download()
    })

    expect(actions.getTabs).toHaveBeenCalledTimes(1)
    expect(actions.getTabs).toHaveBeenCalledWith('song-7')
    expect(actions.getTabs).not.toHaveBeenCalledWith(OWNER_ROW_ID)
    expect(actions.getResolvedEntryForVersion).toHaveBeenCalledWith('v-7', 'band-1')
    expect(actions.getPersonalEntryForSong).toHaveBeenCalledWith('song-7')
  })

  it('reads no personal row outside band context and stores a row-less version', async () => {
    const actions = makeActions({
      getResolvedEntryForVersion: vi.fn(() =>
        Promise.resolve(resolved({ ownerRowId: null, status: null })),
      ),
    })
    const { result, ports } = setup({ bandId: null, actions })
    await waitFor(() => expect(result.current.status).toBe('idle'))

    await act(async () => {
      await result.current.download()
    })

    expect(actions.getPersonalEntryForSong).not.toHaveBeenCalled()
    expect(result.current.status).toBe('downloaded')
    expect([...ports.records.rows.keys()]).toEqual([songRecordId('v-7', null)])
  })

  it('shows the stored copy on mount', async () => {
    const ports = createFakePorts()
    const first = setup({ ports })
    await waitFor(() => expect(first.result.current.status).toBe('idle'))
    await act(async () => {
      await first.result.current.download()
    })
    cleanup()

    const second = setup({ ports })

    await waitFor(() => expect(second.result.current.status).toBe('downloaded'))
    expect(second.result.current.summary?.playlistName).toBe('Tempo Perdido')
    expect(second.result.current.downloadedAgo).not.toBeNull()
  })

  it('stays quiet when reading the library fails on mount', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    store.listOfflinePlaylists = () => Promise.reject(new Error('IndexedDB unavailable'))
    const { result } = renderHook(() =>
      useOfflineSong({ versionId: 'v-7', bandId: null, actions: makeActions(), store }),
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.status).toBe('idle')
  })
})

describe('useOfflineSong — failure (ER4)', () => {
  it('a rejected file fetch leaves idle, an error, no record and no bytes', async () => {
    const ports = createFakePorts()
    ports.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch
    const { result } = setup({ ports })
    await waitFor(() => expect(result.current.status).toBe('idle'))

    await act(async () => {
      await result.current.download()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.error).toBe('Failed to fetch')
    expect(ports.records.rows.size).toBe(0)
    expect(ports.blobs.entries.size).toBe(0)
  })

  it('fails with an error when the entry read answers null', async () => {
    const actions = makeActions({ getResolvedEntryForVersion: vi.fn(() => Promise.resolve(null)) })
    const { result, ports } = setup({ actions })
    await waitFor(() => expect(result.current.status).toBe('idle'))

    await act(async () => {
      await result.current.download()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.error).toMatch(/could not be read/)
    expect(ports.records.rows.size).toBe(0)

    act(() => result.current.dismissError())
    expect(result.current.error).toBeNull()
  })

  it('fails with an error when the entry read throws', async () => {
    const actions = makeActions({
      getResolvedEntryForVersion: vi.fn(() => Promise.reject(new Error('Access denied'))),
    })
    const { result } = setup({ actions })
    await waitFor(() => expect(result.current.status).toBe('idle'))

    await act(async () => {
      await result.current.download()
    })

    expect(result.current.error).toBe('Access denied')
  })

  it('names a quota failure and keeps nothing', async () => {
    const ports = createFakePorts({ failBlobPutOnCall: 1 })
    const { result } = setup({ ports })
    await waitFor(() => expect(result.current.status).toBe('idle'))

    await act(async () => {
      await result.current.download()
    })

    expect(result.current.error).toMatch(/Not enough storage/)
    expect(ports.blobs.entries.size).toBe(0)
  })

  it('falls back to a generic message for a non-Error rejection', async () => {
    const actions = makeActions({ getTabs: vi.fn(() => Promise.reject('boom')) })
    const { result } = setup({ actions })
    await waitFor(() => expect(result.current.status).toBe('idle'))

    await act(async () => {
      await result.current.download()
    })

    expect(result.current.error).toBe('Failed to make this song available offline')
  })
})

describe('useOfflineSong — remove (ER6)', () => {
  it('removes its own cached files and leaves a stored playlist record intact', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await store.saveOfflinePlaylist({
      playlistId: 'pl-1',
      playlistName: 'Gig',
      bandId: null,
      savedAt: '2026-09-20T18:04:00.000Z',
      songs: [
        {
          entry: { repertoireId: 'rep-1', versionId: 'v-7', songId: 'song-7', title: 'T', artist: null },
          repertoire: resolved(),
          personalRepertoire: null,
          tabs: [tabRow('tab-pl', 'song-7')],
        },
      ],
    })
    const { result } = setup({ ports })
    await waitFor(() => expect(result.current.status).toBe('idle'))
    await act(async () => {
      await result.current.download()
    })
    const songId = songRecordId('v-7', 'band-1')
    expect(ports.blobs.keysFor(songId)).toHaveLength(1)

    await act(async () => {
      await result.current.remove()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.summary).toBeNull()
    expect(ports.blobs.keysFor(songId)).toEqual([])
    expect(ports.records.rows.has(songId)).toBe(false)
    expect(ports.blobs.keysFor('pl-1')).toEqual(['/__offline-tab/pl-1/tab-pl'])
    expect(ports.records.rows.has('pl-1')).toBe(true)
  })

  it('surfaces an error when the removal fails', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    store.removeOfflinePlaylist = () => Promise.reject(new Error('locked'))
    const { result } = renderHook(() =>
      useOfflineSong({ versionId: 'v-7', bandId: null, actions: makeActions(), store }),
    )

    await act(async () => {
      await result.current.remove()
    })

    expect(result.current.error).toBe('locked')
  })
})
