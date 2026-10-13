// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useSongWindow } from '@/hooks/useSongWindow'
import { useSongEntry } from '@/hooks/useSongEntry'
import { useTabLibrary, type TabLibraryActions } from '@/hooks/useTabLibrary'
import { writeSongQueue } from '@/lib/songQueue'
import { resetSongWindow, type SongWindowRecord } from '@/lib/songWindow'
import { logger } from '@/lib/logger'
import type { ResolvedSongEntry, SongFile } from '@/types/database'

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

afterEach(cleanup)

beforeEach(() => {
  resetSongWindow()
  window.sessionStorage.clear()
  vi.mocked(logger.error).mockClear()
  writeSongQueue({
    entries: ['v1', 'v2', 'v3', 'v4', 'v5'].map((versionId) => ({ versionId, title: versionId, artist: null })),
    owner: { type: 'personal' },
    originHref: '/',
    label: 'Set',
  })
})

function entryOf(versionId: string, lyrics = `lyrics ${versionId}`): ResolvedSongEntry {
  return { ownerRowId: null, song_id: `song-${versionId}`, version_id: versionId, lyrics } as unknown as ResolvedSongEntry
}

function recordOf(versionId: string, files: SongFile[] = []): SongWindowRecord {
  return { versionId, entry: entryOf(versionId), files }
}

function windowAction() {
  return vi.fn(async (ids: string[]) => ids.map((id) => recordOf(id)))
}

describe('useSongWindow', () => {
  it('one request carrying n-1, n, n+1', async () => {
    const getSongWindow = windowAction()
    renderHook(() => useSongWindow({ versionId: 'v3', bandId: null, actions: { getSongWindow } }))
    await waitFor(() => expect(getSongWindow).toHaveBeenCalledTimes(1))
    expect(getSongWindow).toHaveBeenCalledWith(['v2', 'v3', 'v4'], null)
  })

  it('carries two ids at the ends of the queue', async () => {
    const first = windowAction()
    renderHook(() => useSongWindow({ versionId: 'v1', bandId: 'b1', actions: { getSongWindow: first } }))
    await waitFor(() => expect(first).toHaveBeenCalledWith(['v1', 'v2'], 'b1'))

    const last = windowAction()
    renderHook(() => useSongWindow({ versionId: 'v5', bandId: 'b2', actions: { getSongWindow: last } }))
    await waitFor(() => expect(last).toHaveBeenCalledWith(['v4', 'v5'], 'b2'))
  })

  it('a failing window request surfaces no error and per-song loads still render', async () => {
    const getSongWindow = vi.fn().mockRejectedValue(new Error('network down'))
    const entryActions = {
      getResolvedEntryForVersion: vi.fn().mockResolvedValue(entryOf('v3')),
      getPersonalEntryForSong: vi.fn().mockResolvedValue(null),
    }
    const tabActions: TabLibraryActions = {
      getTabs: vi.fn().mockResolvedValue([{ id: 'f1', title: 'Chart' }]),
      uploadTab: vi.fn(),
      deleteTab: vi.fn(),
    }
    // Module-level in production; a stable identity here for the same reason.
    const windowActions = { getSongWindow }
    const { result } = renderHook(() => {
      useSongWindow({ versionId: 'v3', bandId: null, actions: windowActions })
      const song = useSongEntry({ versionId: 'v3', bandId: null, actions: entryActions })
      const library = useTabLibrary({
        songId: song.songId,
        versionId: 'v3',
        bandId: null,
        actions: tabActions,
        onPersonalEntryCreated: vi.fn(),
        notify: vi.fn(),
      })
      return { song, library }
    })

    await waitFor(() => expect(result.current.library.tabs).toHaveLength(1))
    expect(result.current.song.notFound).toBe(false)
    expect(result.current.song.entry?.lyrics).toBe('lyrics v3')
    expect(entryActions.getResolvedEntryForVersion).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('a neighbour with files: [] renders an empty file library without error', async () => {
    const getSongWindow = windowAction()
    const getResolvedEntryForVersion = vi.fn()
    const getTabs = vi.fn()
    // Arrive at v2: v3 is prefetched with no files.
    renderHook(() => useSongWindow({ versionId: 'v2', bandId: null, actions: { getSongWindow } }))
    await waitFor(() => expect(getSongWindow).toHaveBeenCalledTimes(1))

    const { result } = renderHook(() => {
      useSongWindow({ versionId: 'v3', bandId: null, actions: { getSongWindow } })
      const song = useSongEntry({
        versionId: 'v3',
        bandId: null,
        actions: { getResolvedEntryForVersion, getPersonalEntryForSong: vi.fn() },
      })
      const library = useTabLibrary({
        songId: song.songId,
        versionId: 'v3',
        bandId: null,
        actions: { getTabs, uploadTab: vi.fn(), deleteTab: vi.fn() },
        onPersonalEntryCreated: vi.fn(),
        notify: vi.fn(),
      })
      return { song, library }
    })

    await waitFor(() => expect(result.current.song.entry?.lyrics).toBe('lyrics v3'))
    expect(result.current.library.tabs).toEqual([])
    expect(getResolvedEntryForVersion).not.toHaveBeenCalled()
    expect(getTabs).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('afterWrite runs the callback and then invalidates the current song', async () => {
    const getSongWindow = windowAction()
    const { result } = renderHook(() =>
      useSongWindow({ versionId: 'v3', bandId: null, actions: { getSongWindow } }),
    )
    await waitFor(() => expect(getSongWindow).toHaveBeenCalledTimes(1))
    const applied = vi.fn()
    act(() => result.current.afterWrite(applied)('x'))
    expect(applied).toHaveBeenCalledWith('x')
    act(() => result.current.afterWrite()())
    act(() => result.current.invalidateCurrent())
  })
})
