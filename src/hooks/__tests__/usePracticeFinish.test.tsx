// @vitest-environment jsdom
/**
 * RH-169 - finishing a practice session from Fast View.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { usePracticeFinish, type UsePracticeFinishOptions } from '@/hooks/usePracticeFinish'
import { cachedSong, fetchSongWindow, resetSongWindow } from '@/lib/songWindow'
import type { Repertoire } from '@/types/database'

afterEach(() => {
  cleanup()
  resetSongWindow()
})

const ENTRIES = [
  { versionId: 'v1', title: 'Alpha', artist: 'A' },
  { versionId: 'v2', title: 'Bravo', artist: null },
  { versionId: 'v3', title: 'Charlie', artist: 'C' },
]
const row = (versionId: string, status: string) => ({ version_id: versionId, status }) as unknown as Repertoire

function setup(overrides: Partial<UsePracticeFinishOptions> = {}) {
  const getRepertoire = vi.fn().mockResolvedValue([row('v1', 'learning'), row('v3', 'mastered')])
  const recordPractice = vi.fn().mockResolvedValue(undefined)
  const notify = vi.fn()
  const applyStatus = vi.fn()
  const view = renderHook(() =>
    usePracticeFinish({
      actions: { getRepertoire, recordPractice },
      bandId: 'band-1',
      currentVersionId: 'v3',
      entries: ENTRIES,
      nextId: null,
      offline: false,
      notify,
      applyStatus,
      ...overrides,
    }),
  )
  return { ...view, getRepertoire, recordPractice, notify, applyStatus }
}

describe('usePracticeFinish visibility', () => {
  it('shows on the last entry when online', () => {
    expect(setup().result.current.visible).toBe(true)
  })

  it('is hidden when a next entry exists', () => {
    expect(setup({ nextId: 'v2' }).result.current.visible).toBe(false)
  })

  it('is hidden offline', () => {
    expect(setup({ offline: true }).result.current.visible).toBe(false)
  })

  it('is hidden without a queue', () => {
    expect(setup({ nextId: undefined, entries: [] }).result.current.visible).toBe(false)
  })
})

describe('usePracticeFinish list', () => {
  it('opens once over every queue entry, with levels from the map and unknown for a missing entry', async () => {
    const { result, getRepertoire } = setup()
    await act(() => result.current.open())
    expect(getRepertoire).toHaveBeenCalledTimes(1)
    expect(getRepertoire).toHaveBeenCalledWith('band-1')
    expect(result.current.isOpen).toBe(true)
    expect(result.current.rows.map(r => r.versionId)).toEqual(['v1', 'v2', 'v3'])
    expect(result.current.levels.get('v1')?.status).toBe('learning')
    expect(result.current.levels.get('v3')?.status).toBe('mastered')
    // v2 is absent from the map: the list renders it as unassessed ('unknown').
    expect(result.current.levels.get('v2')).toBeUndefined()
  })

  it('a failed repertoire read shows the error and stays closed', async () => {
    const { result, notify } = setup({
      actions: { getRepertoire: vi.fn().mockRejectedValue(new Error('down')), recordPractice: vi.fn() },
    })
    await act(() => result.current.open())
    expect(result.current.isOpen).toBe(false)
    expect(notify).toHaveBeenCalledWith('down', 'error')
  })

  it('a non-Error failure falls back to a generic message', async () => {
    const { result, notify } = setup({
      actions: { getRepertoire: vi.fn().mockRejectedValue('x'), recordPractice: vi.fn() },
    })
    await act(() => result.current.open())
    expect(notify).toHaveBeenCalledWith('Failed to load your repertoire', 'error')
  })

  it('reopening empties earlier ticks, and close hides the list', async () => {
    const { result } = setup()
    await act(() => result.current.open())
    act(() => result.current.review.toggle('v1'))
    act(() => result.current.close())
    expect(result.current.isOpen).toBe(false)
    await act(() => result.current.open())
    expect(result.current.review.ticked.size).toBe(0)
  })
})

describe('usePracticeFinish save', () => {
  it('sends one call with the ticked rows, status only where changed, with the page band id', async () => {
    const { result, recordPractice, notify } = setup()
    await act(() => result.current.open())
    act(() => {
      result.current.review.toggle('v1')
      result.current.review.toggle('v2')
      result.current.review.setLevel('v2', 'polishing')
    })
    await act(() => result.current.review.confirm())
    expect(recordPractice).toHaveBeenCalledTimes(1)
    expect(recordPractice).toHaveBeenCalledWith([{ versionId: 'v1' }, { versionId: 'v2', status: 'polishing' }], 'band-1')
    expect(notify).toHaveBeenCalledWith('Practice recorded', 'success')
    expect(result.current.isOpen).toBe(false)
  })

  it('passes a null band id unchanged for a personal session', async () => {
    const { result, recordPractice } = setup({ bandId: null })
    await act(() => result.current.open())
    act(() => result.current.review.toggle('v1'))
    await act(() => result.current.review.confirm())
    expect(recordPractice).toHaveBeenCalledWith([{ versionId: 'v1' }], null)
  })

  it('invalidates the song window of every submitted version and applies a changed current level', async () => {
    await fetchSongWindow('band-1', ['v1', 'v2'], async ids =>
      ids.map(versionId => ({ versionId, entry: { version_id: versionId } as never, files: [] })),
    )
    expect(cachedSong('band-1', 'v1')).toBeDefined()
    const { result, applyStatus } = setup()
    await act(() => result.current.open())
    act(() => {
      result.current.review.toggle('v1')
      result.current.review.toggle('v3')
      result.current.review.setLevel('v3', 'polishing')
    })
    await act(() => result.current.review.confirm())
    expect(cachedSong('band-1', 'v1')).toBeUndefined()
    expect(cachedSong('band-1', 'v2')).toBeDefined() // not submitted: left alone
    expect(applyStatus).toHaveBeenCalledWith('polishing')
  })

  it('does not touch the header when the current song level is unchanged', async () => {
    const { result, applyStatus } = setup()
    await act(() => result.current.open())
    act(() => result.current.review.toggle('v3'))
    await act(() => result.current.review.confirm())
    expect(applyStatus).not.toHaveBeenCalled()
  })

  it('a failed save shows the error, keeps the list open and invalidates nothing', async () => {
    const { result, notify, applyStatus } = setup({
      actions: {
        getRepertoire: vi.fn().mockResolvedValue([]),
        recordPractice: vi.fn().mockRejectedValue(new Error('refused')),
      },
    })
    await act(() => result.current.open())
    act(() => {
      result.current.review.toggle('v3')
      result.current.review.setLevel('v3', 'mastered')
    })
    await act(() => result.current.review.confirm())
    expect(notify).toHaveBeenCalledWith('refused', 'error')
    expect(result.current.isOpen).toBe(true)
    expect(applyStatus).not.toHaveBeenCalled()
  })
})
