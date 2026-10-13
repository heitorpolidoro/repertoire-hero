// @vitest-environment jsdom
/**
 * RH-168 - starting a practice session: the queue is stored in computed order,
 * the router receives the first song's Fast View href, an empty source stores
 * nothing, and no write function is ever called.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { renderHook, cleanup, act, waitFor } from '@testing-library/react'
import { usePracticeStart, type PracticeActions } from '../usePracticeStart'
import { clearSongQueue, readSongQueue } from '@/lib/songQueue'
import type { PracticeCandidate } from '@/lib/practiceOrder'

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

afterEach(cleanup)
beforeEach(() => clearSongQueue())

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

const SONGS: PracticeCandidate[] = [
  { versionId: 'fresh', title: 'Fresh', artist: 'A', status: 'mastered', lastPracticed: ago(1) },
  { versionId: 'overdue', title: 'Overdue', artist: null, status: 'learning', lastPracticed: ago(10) },
  { versionId: 'never', title: 'Never', artist: 'C', status: 'unknown', lastPracticed: null },
]

function setup(options: { bandId?: string | null; candidates?: PracticeCandidate[] } = {}) {
  const writes = {
    recordPractice: vi.fn(),
    recordPracticeStatus: vi.fn(),
    updateSongStatus: vi.fn(),
    updateSong: vi.fn(),
  }
  const actions = {
    getCandidates: vi.fn(async () => options.candidates ?? SONGS),
    getPlaylists: vi.fn(async () => [{ id: 'p-1', name: 'Friday gig' }]),
  } satisfies PracticeActions
  const push = vi.fn()
  const hook = renderHook(() => usePracticeStart({ bandId: options.bandId ?? null, actions, push, random: () => 0 }))
  return { hook, actions, push, writes }
}

describe('usePracticeStart', () => {
  it('stores a personal whole-repertoire queue in computed order and opens the first song', async () => {
    const { hook, actions, push, writes } = setup()

    await act(() => hook.result.current.start({ kind: 'repertoire' }))

    expect(actions.getCandidates).toHaveBeenCalledWith({ kind: 'repertoire' }, null)
    expect(readSongQueue()).toEqual({
      entries: [
        { versionId: 'never', title: 'Never', artist: 'C' },
        { versionId: 'overdue', title: 'Overdue', artist: null },
        { versionId: 'fresh', title: 'Fresh', artist: 'A' },
      ],
      owner: { type: 'personal' },
      originHref: '/',
      label: 'Whole repertoire',
    })
    expect(push).toHaveBeenCalledExactlyOnceWith('/songs/never/fast-view')
    for (const write of Object.values(writes)) expect(write).not.toHaveBeenCalled()
  })

  it('stores a band playlist queue with the band owner, origin and playlist label', async () => {
    const { hook, actions, push } = setup({ bandId: 'band-1' })

    await act(() => hook.result.current.start({ kind: 'playlist', id: 'p-1', name: 'Friday gig' }))

    expect(actions.getCandidates).toHaveBeenCalledWith({ kind: 'playlist', playlistId: 'p-1' }, 'band-1')
    const queue = readSongQueue()
    expect(queue?.owner).toEqual({ type: 'band', bandId: 'band-1' })
    expect(queue?.originHref).toBe('/bands/band-1')
    expect(queue?.label).toBe('Friday gig')
    expect(push).toHaveBeenCalledWith('/songs/never/fast-view?bandId=band-1')
  })

  it('replaces any previous queue', async () => {
    const first = setup()
    await act(() => first.hook.result.current.start({ kind: 'repertoire' }))
    const second = setup({ candidates: [SONGS[0]] })
    await act(() => second.hook.result.current.start({ kind: 'repertoire' }))
    expect(readSongQueue()?.entries.map((e) => e.versionId)).toEqual(['fresh'])
  })

  it('stores nothing, does not navigate and shows a message for an empty source', async () => {
    const { hook, push } = setup({ candidates: [] })

    await act(() => hook.result.current.start({ kind: 'repertoire' }))

    expect(readSongQueue()).toBeNull()
    expect(push).not.toHaveBeenCalled()
    expect(hook.result.current.message).toBe('Nothing to practise here')
    expect(hook.result.current.pending).toBe(false)
  })

  it('keeps an existing queue when the new source is empty', async () => {
    const first = setup()
    await act(() => first.hook.result.current.start({ kind: 'repertoire' }))
    const empty = setup({ candidates: [] })
    await act(() => empty.hook.result.current.start({ kind: 'repertoire' }))
    expect(readSongQueue()?.entries).toHaveLength(3)
  })

  it('reports a failed read inline without storing or navigating', async () => {
    const { hook, actions, push } = setup()
    actions.getCandidates.mockRejectedValue(new Error('Access denied: not a member of this band'))

    await act(() => hook.result.current.start({ kind: 'repertoire' }))

    expect(hook.result.current.message).toBe('Access denied: not a member of this band')
    expect(readSongQueue()).toBeNull()
    expect(push).not.toHaveBeenCalled()
  })

  it('reports a non-Error failure with a fallback message', async () => {
    const { hook, actions } = setup()
    actions.getCandidates.mockRejectedValue('')
    await act(() => hook.result.current.start({ kind: 'repertoire' }))
    expect(hook.result.current.message).toBe('Failed to start practice')
  })

  it('loads the playlists when the menu opens and closes it again', async () => {
    const { hook, actions } = setup({ bandId: 'band-1' })

    act(() => hook.result.current.toggle())
    expect(hook.result.current.open).toBe(true)
    await waitFor(() => expect(hook.result.current.playlists).toEqual([{ id: 'p-1', name: 'Friday gig' }]))
    expect(actions.getPlaylists).toHaveBeenCalledWith('band-1')

    act(() => hook.result.current.toggle())
    expect(hook.result.current.open).toBe(false)
  })

  it('still offers the menu when the playlists do not load', async () => {
    const { hook, actions } = setup()
    actions.getPlaylists.mockRejectedValue(new Error('boom'))
    act(() => hook.result.current.toggle())
    await waitFor(() => expect(actions.getPlaylists).toHaveBeenCalled())
    expect(hook.result.current.playlists).toEqual([])
    expect(hook.result.current.open).toBe(true)
  })

  it('exposes no write in its action bundle', () => {
    const { actions } = setup()
    expect(Object.keys(actions).sort()).toEqual(['getCandidates', 'getPlaylists'])
  })
})
