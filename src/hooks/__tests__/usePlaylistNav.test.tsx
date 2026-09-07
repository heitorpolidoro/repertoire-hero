// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act, renderHook, cleanup } from '@testing-library/react'
import { usePlaylistNav, type PlaylistNavActions, type UsePlaylistNavOptions } from '../usePlaylistNav'
import { SLIDE_OUT_MS, type PlaylistEntry } from '@/lib/playlistNav'

afterEach(cleanup)

const ENTRIES: PlaylistEntry[] = [
  { repertoireId: 'rep-1', songId: 'song-1', title: 'Black Dog', artist: 'Led Zeppelin' },
  { repertoireId: 'rep-2', songId: 'song-2', title: 'Rosanna', artist: 'Toto' },
  { repertoireId: 'rep-3', songId: 'song-3', title: 'Untitled', artist: null },
]

type ActionSpies = { [K in keyof PlaylistNavActions]: Mock }

function makeActions(): ActionSpies {
  return {
    getPlaylistDetailsWithEntries: vi.fn().mockResolvedValue({ name: 'Gig', entries: ENTRIES }),
  }
}

function setup(overrides: Partial<UsePlaylistNavOptions> = {}) {
  const actions = (overrides.actions as ActionSpies | undefined) ?? makeActions()
  const navigate = vi.fn()
  const navigateBack = vi.fn()
  const initialProps: UsePlaylistNavOptions = {
    currentRepertoireId: 'rep-2',
    returnTo: '/playlists/pl-1',
    bandId: 'band-7',
    actions,
    navigate,
    navigateBack,
    ...overrides,
  }
  const view = renderHook((props: UsePlaylistNavOptions) => usePlaylistNav(props), { initialProps })
  return { ...view, actions, navigate, navigateBack, initialProps }
}

/** Drain the pending action promise inside `act`, without running any timer. */
async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePlaylistNav', () => {
  it('does not call the playlist action when returnTo is not a playlist path', async () => {
    const { result, actions } = setup({ returnTo: '/songs' })
    await flush()

    expect(actions.getPlaylistDetailsWithEntries).not.toHaveBeenCalled()
    expect(result.current.nav).toBeNull()
    expect(result.current.entries).toEqual([])
  })

  it('loads the playlist entries and exposes the computed navigation', async () => {
    const { result, actions } = setup()
    await flush()

    expect(actions.getPlaylistDetailsWithEntries).toHaveBeenCalledWith('pl-1', 'band-7')
    expect(result.current.entries).toEqual(ENTRIES)
    expect(result.current.nav).toEqual({
      prevId: 'rep-1',
      nextId: 'rep-3',
      position: 2,
      total: 3,
      playlistId: 'pl-1',
      playlistName: 'Gig',
    })
  })

  it('exposes no navigation when the playlist action rejects', async () => {
    const actions = makeActions()
    actions.getPlaylistDetailsWithEntries.mockRejectedValue(new Error('Access denied'))
    const { result } = setup({ actions })
    await flush()

    expect(result.current.nav).toBeNull()
    expect(result.current.entries).toEqual([])
  })

  it('exposes no navigation when the current entry is absent from the playlist', async () => {
    const { result } = setup({ currentRepertoireId: 'rep-99' })
    await flush()

    expect(result.current.nav).toBeNull()
    expect(result.current.entries).toEqual(ENTRIES)
  })

  it('opens and closes the drawer', async () => {
    const { result } = setup()
    await flush()

    expect(result.current.isDrawerOpen).toBe(false)
    act(() => result.current.openDrawer())
    expect(result.current.isDrawerOpen).toBe(true)
    act(() => result.current.closeDrawer())
    expect(result.current.isDrawerOpen).toBe(false)
  })

  it('navigates to the selected entry after the slide-out delay, preserving returnTo and bandId', async () => {
    const { result, navigate } = setup()
    await flush()

    act(() => result.current.selectEntry('rep-3'))
    expect(result.current.slideOut).toBe('left')
    expect(navigate).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
    expect(navigate).toHaveBeenCalledWith(
      '/songs/rep-3/fast-view?returnTo=%2Fplaylists%2Fpl-1&bandId=band-7',
    )
  })

  it('does not navigate when the selected entry is the current one', async () => {
    const { result, navigate } = setup()
    await flush()

    act(() => result.current.selectEntry('rep-2'))
    act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })

    expect(result.current.slideOut).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('goPrev slides right to the previous entry and does nothing on the first entry', async () => {
    const { result, navigate } = setup()
    await flush()

    act(() => result.current.goPrev())
    expect(result.current.slideOut).toBe('right')
    act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
    expect(navigate).toHaveBeenCalledWith(
      '/songs/rep-1/fast-view?returnTo=%2Fplaylists%2Fpl-1&bandId=band-7',
    )

    const first = setup({ currentRepertoireId: 'rep-1' })
    await flush()
    act(() => first.result.current.goPrev())
    act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
    expect(first.navigate).not.toHaveBeenCalled()
  })

  it('advances to the next entry on a leftward swipe past the threshold', async () => {
    const { result, navigate } = setup()
    await flush()

    act(() => result.current.onTouchStart(300))
    act(() => result.current.onTouchEnd(200))
    expect(result.current.slideOut).toBe('left')

    act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
    expect(navigate).toHaveBeenCalledWith(
      '/songs/rep-3/fast-view?returnTo=%2Fplaylists%2Fpl-1&bandId=band-7',
    )
  })

  it('ignores a swipe shorter than the threshold', async () => {
    const { result, navigate } = setup()
    await flush()

    act(() => result.current.onTouchStart(300))
    act(() => result.current.onTouchEnd(280))
    act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
    expect(result.current.slideOut).toBeNull()
    expect(navigate).not.toHaveBeenCalled()

    // A touch end without a preceding touch start is ignored too.
    act(() => result.current.onTouchEnd(0))
    act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('refetches the playlist when the bandId option changes', async () => {
    const { rerender, actions, initialProps } = setup()
    await flush()
    expect(actions.getPlaylistDetailsWithEntries).toHaveBeenCalledTimes(1)

    rerender({ ...initialProps, bandId: 'band-9' })
    await flush()

    expect(actions.getPlaylistDetailsWithEntries).toHaveBeenCalledTimes(2)
    expect(actions.getPlaylistDetailsWithEntries).toHaveBeenLastCalledWith('pl-1', 'band-9')
  })

  it('goBack pushes returnTo when there is one and otherwise walks history back', async () => {
    const { result, navigate, navigateBack } = setup()
    await flush()
    act(() => result.current.goBack())
    expect(navigate).toHaveBeenCalledWith('/playlists/pl-1')
    expect(navigateBack).not.toHaveBeenCalled()

    const bare = setup({ returnTo: null })
    await flush()
    act(() => bare.result.current.goBack())
    expect(bare.navigateBack).toHaveBeenCalledTimes(1)
    expect(bare.navigate).not.toHaveBeenCalled()
  })

  it('does not navigate when the slide-out timer fires after unmount', async () => {
    const { result, navigate, unmount } = setup()
    await flush()

    act(() => result.current.selectEntry('rep-3'))
    unmount()
    act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })

    expect(navigate).not.toHaveBeenCalled()
  })
})
