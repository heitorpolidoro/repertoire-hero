// @vitest-environment jsdom
/**
 * RH-159 — the whole-playlist practice review controller.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { usePracticeReview, usePracticeReviewPanel } from '@/hooks/usePracticeReview'
import type { PlaylistSong } from '@/types/database'

afterEach(cleanup)

const song = (n: number): PlaylistSong => ({
  id: `ps-${n}`,
  playlist_id: 'pl',
  version_id: `v${n}`,
  position: n,
})
const SONGS = [1, 2, 3, 4].map(song)

function setup(overrides: { recordPractice?: ReturnType<typeof vi.fn>; songs?: PlaylistSong[] } = {}) {
  const recordPractice = overrides.recordPractice ?? vi.fn().mockResolvedValue(undefined)
  const setError = vi.fn()
  const onRefresh = vi.fn()
  const onClose = vi.fn()
  const hook = renderHook(() =>
    usePracticeReview({
      songs: overrides.songs ?? SONGS,
      recordPractice,
      bandId: 'band-1',
      setError,
      onRefresh,
      onClose,
    }),
  )
  return { ...hook, recordPractice, setError, onRefresh, onClose }
}

describe('usePracticeReviewPanel', () => {
  it('opening resets ticks and levels and dispatches the panel; a confirm closes it', async () => {
    const dispatch = vi.fn()
    const recordPractice = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      usePracticeReviewPanel({ songs: SONGS, recordPractice, bandId: null, setError: vi.fn(), onRefresh: vi.fn(), dispatch }),
    )
    act(() => {
      result.current.practiceReview.toggle('v1')
      result.current.practiceReview.setLevel('v1', 'mastered')
    })
    act(() => result.current.openPracticeReview())
    expect(dispatch).toHaveBeenCalledWith({ type: 'open-practice-review' })
    expect(result.current.practiceReview.ticked.size).toBe(0)
    expect(result.current.practiceReview.levels.size).toBe(0)

    act(() => result.current.practiceReview.toggle('v2'))
    await act(() => result.current.practiceReview.confirm())
    expect(dispatch).toHaveBeenCalledWith({ type: 'close' })
  })
})

describe('usePracticeReview', () => {
  it('starts with nothing ticked and no changed level', () => {
    const { result } = setup()
    expect(result.current.ticked.size).toBe(0)
    expect(result.current.levels.size).toBe(0)
    expect(result.current.allTicked).toBe(false)
  })

  it('an empty playlist is never all ticked', () => {
    const { result } = setup({ songs: [] })
    expect(result.current.allTicked).toBe(false)
  })

  it('toggleAll ticks every row when some are unticked, then unticks every row', () => {
    const { result } = setup()
    act(() => result.current.toggle('v1'))
    act(() => result.current.toggleAll())
    expect([...result.current.ticked].sort()).toEqual(['v1', 'v2', 'v3', 'v4'])
    expect(result.current.allTicked).toBe(true)
    act(() => result.current.toggleAll())
    expect(result.current.ticked.size).toBe(0)
  })

  it('toggle unticks a ticked row', () => {
    const { result } = setup()
    act(() => result.current.toggle('v1'))
    act(() => result.current.toggle('v1'))
    expect(result.current.ticked.size).toBe(0)
  })

  it('reset empties ticks and levels', () => {
    const { result } = setup()
    act(() => {
      result.current.toggle('v1')
      result.current.setLevel('v1', 'mastered')
    })
    act(() => result.current.reset())
    expect(result.current.ticked.size).toBe(0)
    expect(result.current.levels.size).toBe(0)
  })

  it('confirm at zero ticked calls nothing', async () => {
    const { result, recordPractice } = setup()
    await act(() => result.current.confirm())
    expect(recordPractice).not.toHaveBeenCalled()
  })

  it('confirm sends one call with only the ticked rows, status only for changed levels', async () => {
    const { result, recordPractice, onRefresh, onClose, setError } = setup()
    act(() => {
      result.current.toggle('v2')
      result.current.toggle('v4')
      result.current.setLevel('v4', 'polishing')
      result.current.setLevel('v3', 'mastered') // changed but not ticked: not sent
    })
    await act(() => result.current.confirm())

    expect(recordPractice).toHaveBeenCalledTimes(1)
    const [items, bandId] = recordPractice.mock.calls[0]
    expect(items).toEqual([{ versionId: 'v2' }, { versionId: 'v4', status: 'polishing' }])
    expect('status' in items[0]).toBe(false)
    expect(bandId).toBe('band-1')
    expect(setError).toHaveBeenCalledWith(null)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a rejected confirm shows the message, keeps ticks and does not close', async () => {
    const { result, setError, onRefresh, onClose } = setup({
      recordPractice: vi.fn().mockRejectedValue(new Error('boom')),
    })
    act(() => result.current.toggle('v1'))
    await act(() => result.current.confirm())

    expect(setError).toHaveBeenLastCalledWith('boom')
    expect(onRefresh).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(result.current.ticked.has('v1')).toBe(true)
    expect(result.current.submitting).toBe(false)
  })

  it('a non-Error rejection falls back to a generic message', async () => {
    const { result, setError } = setup({ recordPractice: vi.fn().mockRejectedValue('x') })
    act(() => result.current.toggle('v1'))
    await act(() => result.current.confirm())
    expect(setError).toHaveBeenLastCalledWith('Failed to record practice')
  })
})
