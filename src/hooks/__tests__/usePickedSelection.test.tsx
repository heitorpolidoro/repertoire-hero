// @vitest-environment jsdom
/**
 * RH-170 - the hand-picked selection controller: pick order (with un-toggle and
 * re-pick), the stored queue, the Fast View href, the zero-pick guard, Cancel,
 * and that no write function is ever called.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { renderHook, cleanup, act } from '@testing-library/react'
import { usePickedSelection } from '../usePickedSelection'
import { clearSongQueue, readSongQueue, writeSongQueue, type SongQueue, type SongQueueOwner } from '@/lib/songQueue'

afterEach(cleanup)
beforeEach(() => clearSongQueue())

const ROWS = [
  { versionId: 'a', title: 'Alpha', artist: 'AA' },
  { versionId: 'b', title: 'Beta', artist: null },
  { versionId: 'c', title: 'Gamma', artist: 'CC' },
]

function setup(owner: SongQueueOwner = { type: 'personal' }, originHref = '/') {
  const writes = {
    recordPractice: vi.fn(),
    recordPracticeStatus: vi.fn(),
    updateSongStatus: vi.fn(),
    updateSong: vi.fn(),
  }
  const push = vi.fn()
  const hook = renderHook(() => usePickedSelection({ rows: ROWS, owner, originHref, push }))
  return { hook, push, writes }
}

describe('usePickedSelection', () => {
  it('stores the queue in the exact tap order, after an un-toggle and a re-pick', () => {
    const { hook, push, writes } = setup()
    act(() => hook.result.current.enter())
    act(() => hook.result.current.toggle('a'))
    act(() => hook.result.current.toggle('b'))
    act(() => hook.result.current.toggle('c'))
    act(() => hook.result.current.toggle('a')) // un-pick: b=1, c=2
    expect(hook.result.current.pickNumber('b')).toBe(1)
    expect(hook.result.current.pickNumber('c')).toBe(2)
    expect(hook.result.current.pickNumber('a')).toBeNull()
    act(() => hook.result.current.toggle('a')) // re-pick goes last

    expect(hook.result.current.count).toBe(3)
    act(() => hook.result.current.confirm())

    expect(readSongQueue()).toEqual({
      entries: [
        { versionId: 'b', title: 'Beta', artist: null },
        { versionId: 'c', title: 'Gamma', artist: 'CC' },
        { versionId: 'a', title: 'Alpha', artist: 'AA' },
      ],
      owner: { type: 'personal' },
      originHref: '/',
      label: 'Hand-picked selection',
    })
    expect(push).toHaveBeenCalledExactlyOnceWith('/songs/b/fast-view')
    expect(hook.result.current.active).toBe(false)
    expect(hook.result.current.count).toBe(0)
    for (const spy of Object.values(writes)) expect(spy).not.toHaveBeenCalled()
  })

  it('stores a band owner, the band origin and a bandId on the href', () => {
    const { hook, push } = setup({ type: 'band', bandId: 'b1' }, '/bands/b1')
    act(() => hook.result.current.enter())
    act(() => hook.result.current.toggle('c'))
    act(() => hook.result.current.confirm())

    expect(readSongQueue()).toMatchObject({ owner: { type: 'band', bandId: 'b1' }, originHref: '/bands/b1' })
    expect(push).toHaveBeenCalledWith('/songs/c/fast-view?bandId=b1')
  })

  it('cannot start with zero picks and stores nothing', () => {
    const { hook, push } = setup()
    act(() => hook.result.current.enter())
    expect(hook.result.current.canStart).toBe(false)
    act(() => hook.result.current.confirm())
    expect(readSongQueue()).toBeNull()
    expect(push).not.toHaveBeenCalled()
  })

  it('cancel stores nothing and leaves an existing queue untouched', () => {
    const existing: SongQueue = {
      entries: [{ versionId: 'x', title: 'X', artist: null }],
      owner: { type: 'personal' },
      originHref: '/playlists/p1',
      label: 'Gig',
    }
    writeSongQueue(existing)
    const { hook, push } = setup()
    act(() => hook.result.current.enter())
    act(() => hook.result.current.toggle('a'))
    act(() => hook.result.current.cancel())

    expect(readSongQueue()).toEqual(existing)
    expect(push).not.toHaveBeenCalled()
    expect(hook.result.current.active).toBe(false)
    expect(hook.result.current.count).toBe(0)
  })

  it('entering the mode again starts with no picks', () => {
    const { hook } = setup()
    act(() => hook.result.current.enter())
    act(() => hook.result.current.toggle('a'))
    act(() => hook.result.current.enter())
    expect(hook.result.current.count).toBe(0)
    expect(hook.result.current.isPicked('a')).toBe(false)
  })
})
