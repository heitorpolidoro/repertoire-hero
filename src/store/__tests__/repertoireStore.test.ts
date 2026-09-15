import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Repertoire } from '@/types/database'
import type { useRepertoireStore as RepertoireStore } from '@/store/repertoireStore'
import type { useBandContextStore as BandContextStore } from '@/store/bandContextStore'

// Hoisted so the spies survive `vi.resetModules()` — each test re-imports the
// store to get a fresh copy of its module-scoped request bookkeeping.
const { getRepertoireAction, removeSongAction, updateSongStatusAction } = vi.hoisted(() => ({
  getRepertoireAction: vi.fn(),
  removeSongAction: vi.fn(),
  updateSongStatusAction: vi.fn(),
}))

vi.mock('@/app/actions/repertoire', () => ({
  getRepertoireAction,
  removeSongAction,
  updateSongStatusAction,
}))

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: Error) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function entry(id: string): Repertoire {
  return {
    id,
    user_id: 'user-1',
    band_id: null,
    song_id: `song-${id}`,
    personal_key: null,
    status: 'learning',
    tags: [],
    last_practiced: null,
    lyrics: null,
  }
}

function ids(songs: Repertoire[]): string[] {
  return songs.map((s) => s.id)
}

// Lets every pending microtask (the store's own `await` continuations) run.
async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

let useRepertoireStore: typeof RepertoireStore
let useBandContextStore: typeof BandContextStore

beforeEach(async () => {
  vi.clearAllMocks()
  removeSongAction.mockResolvedValue(undefined)
  updateSongStatusAction.mockResolvedValue(undefined)
  vi.resetModules()
  // Both modules come from the same fresh graph, so the store sees this very
  // band-context store instance.
  useRepertoireStore = (await import('@/store/repertoireStore')).useRepertoireStore
  useBandContextStore = (await import('@/store/bandContextStore')).useBandContextStore
  useBandContextStore.setState({ context: { type: 'user' } })
})

describe('repertoireStore.loadSongs ordering', () => {
  it('ignores an older response that arrives last', async () => {
    const bandA = deferred<Repertoire[]>()
    const bandB = deferred<Repertoire[]>()
    getRepertoireAction.mockReturnValueOnce(bandA.promise).mockReturnValueOnce(bandB.promise)

    const first = useRepertoireStore.getState().loadSongs()
    useBandContextStore.getState().setBandContext('band-b', 'Band B')
    const second = useRepertoireStore.getState().loadSongs()

    bandB.resolve([entry('b1')])
    await second
    bandA.resolve([entry('a1'), entry('a2')])
    await first

    expect(ids(useRepertoireStore.getState().songs)).toEqual(['b1'])
    expect(getRepertoireAction).toHaveBeenCalledTimes(2)
  })

  it('discards a response whose band context changed even without a second load', async () => {
    const pending = deferred<Repertoire[]>()
    getRepertoireAction.mockReturnValueOnce(pending.promise)
    useRepertoireStore.setState({ songs: [entry('kept')] })

    const load = useRepertoireStore.getState().loadSongs()
    useBandContextStore.getState().setBandContext('band-b', 'Band B')
    pending.resolve([entry('stale')])
    await load

    expect(ids(useRepertoireStore.getState().songs)).toEqual(['kept'])
    expect(useRepertoireStore.getState().isLoading).toBe(false)
  })

  it('keeps a delete applied when a racing read resolves with the pre-delete list', async () => {
    const pending = deferred<Repertoire[]>()
    getRepertoireAction.mockReturnValueOnce(pending.promise)
    useRepertoireStore.setState({ songs: [entry('keep'), entry('gone')] })

    const load = useRepertoireStore.getState().loadSongs()
    await useRepertoireStore.getState().removeSong('gone')

    pending.resolve([entry('keep'), entry('gone')])
    await load

    expect(ids(useRepertoireStore.getState().songs)).toEqual(['keep'])
    expect(useRepertoireStore.getState().isLoading).toBe(false)
  })

  it('keeps an optimistic status update when a racing read resolves with the old status', async () => {
    const pending = deferred<Repertoire[]>()
    getRepertoireAction.mockReturnValueOnce(pending.promise)
    useRepertoireStore.setState({ songs: [entry('s1')] })

    const load = useRepertoireStore.getState().loadSongs()
    await useRepertoireStore.getState().updateStatus('s1', 'mastered')

    pending.resolve([entry('s1')])
    await load

    expect(useRepertoireStore.getState().songs[0].status).toBe('mastered')
    expect(useRepertoireStore.getState().isLoading).toBe(false)
  })
})

describe('repertoireStore.loadSongs dedupe', () => {
  it('issues one request for two loadSongs calls in the same tick', async () => {
    const pending = deferred<Repertoire[]>()
    getRepertoireAction.mockReturnValue(pending.promise)

    const first = useRepertoireStore.getState().loadSongs()
    const second = useRepertoireStore.getState().loadSongs()
    pending.resolve([entry('s1')])
    await Promise.all([first, second])

    expect(getRepertoireAction).toHaveBeenCalledTimes(1)
    expect(ids(useRepertoireStore.getState().songs)).toEqual(['s1'])
    expect(useRepertoireStore.getState().isLoading).toBe(false)
  })

  it('does not adopt an in-flight request invalidated by a mutation', async () => {
    const stale = deferred<Repertoire[]>()
    const fresh = deferred<Repertoire[]>()
    getRepertoireAction.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise)
    useRepertoireStore.setState({ songs: [entry('keep'), entry('gone')] })

    const staleLoad = useRepertoireStore.getState().loadSongs()
    await useRepertoireStore.getState().removeSong('gone')
    const freshLoad = useRepertoireStore.getState().loadSongs()

    expect(getRepertoireAction).toHaveBeenCalledTimes(2)

    stale.resolve([entry('keep'), entry('gone')])
    await staleLoad
    fresh.resolve([entry('keep')])
    await freshLoad

    expect(ids(useRepertoireStore.getState().songs)).toEqual(['keep'])
  })

  it('issues a fresh request once the previous one settled', async () => {
    getRepertoireAction.mockResolvedValue([entry('s1')])

    await useRepertoireStore.getState().loadSongs()
    await useRepertoireStore.getState().loadSongs()

    expect(getRepertoireAction).toHaveBeenCalledTimes(2)
  })
})

describe('repertoireStore isLoading ownership', () => {
  it('leaves isLoading true when a stale response settles under a newer load', async () => {
    const older = deferred<Repertoire[]>()
    const newer = deferred<Repertoire[]>()
    getRepertoireAction.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)

    const first = useRepertoireStore.getState().loadSongs()
    useBandContextStore.getState().setBandContext('band-b', 'Band B')
    const second = useRepertoireStore.getState().loadSongs()

    older.resolve([entry('a1')])
    await first
    await flush()

    expect(useRepertoireStore.getState().isLoading).toBe(true)
    expect(useRepertoireStore.getState().songs).toEqual([])

    newer.resolve([entry('b1')])
    await second

    expect(useRepertoireStore.getState().isLoading).toBe(false)
    expect(ids(useRepertoireStore.getState().songs)).toEqual(['b1'])
  })

  it('clears isLoading when an invalidated read is the last one in flight', async () => {
    const pending = deferred<Repertoire[]>()
    getRepertoireAction.mockReturnValueOnce(pending.promise)
    useRepertoireStore.setState({ songs: [entry('keep'), entry('gone')] })

    const load = useRepertoireStore.getState().loadSongs()
    expect(useRepertoireStore.getState().isLoading).toBe(true)
    await useRepertoireStore.getState().removeSong('gone')

    pending.resolve([entry('keep'), entry('gone')])
    await load
    await flush()

    expect(useRepertoireStore.getState().isLoading).toBe(false)
    expect(ids(useRepertoireStore.getState().songs)).toEqual(['keep'])
  })

  it('clears isLoading when a rejected read is the last one in flight', async () => {
    getRepertoireAction.mockRejectedValueOnce(new Error('boom'))

    await expect(useRepertoireStore.getState().loadSongs()).rejects.toThrow('boom')

    expect(useRepertoireStore.getState().isLoading).toBe(false)
  })

  it('leaves isLoading true when a rejected read is superseded by a newer load', async () => {
    const failing = deferred<Repertoire[]>()
    const newer = deferred<Repertoire[]>()
    getRepertoireAction.mockReturnValueOnce(failing.promise).mockReturnValueOnce(newer.promise)

    const first = useRepertoireStore.getState().loadSongs()
    useBandContextStore.getState().setBandContext('band-b', 'Band B')
    const second = useRepertoireStore.getState().loadSongs()

    failing.reject(new Error('boom'))
    await expect(first).rejects.toThrow('boom')
    await flush()

    expect(useRepertoireStore.getState().isLoading).toBe(true)

    newer.resolve([entry('b1')])
    await second
    expect(useRepertoireStore.getState().isLoading).toBe(false)
  })
})

describe('repertoireStore mutations', () => {
  it('rolls a failed removeSong back to the previous list', async () => {
    removeSongAction.mockRejectedValueOnce(new Error('nope'))
    useRepertoireStore.setState({ songs: [entry('keep'), entry('gone')] })

    await expect(useRepertoireStore.getState().removeSong('gone')).rejects.toThrow('nope')

    expect(ids(useRepertoireStore.getState().songs)).toEqual(['keep', 'gone'])
  })

  it('reloads through a fresh request when updateStatus fails', async () => {
    updateSongStatusAction.mockRejectedValueOnce(new Error('nope'))
    getRepertoireAction.mockResolvedValueOnce([entry('s1')])
    useRepertoireStore.setState({ songs: [entry('s1')] })

    await expect(useRepertoireStore.getState().updateStatus('s1', 'mastered')).rejects.toThrow('nope')

    expect(getRepertoireAction).toHaveBeenCalledTimes(1)
    expect(useRepertoireStore.getState().songs[0].status).toBe('learning')
    expect(useRepertoireStore.getState().isLoading).toBe(false)
  })

  it('does not write in band context', async () => {
    useBandContextStore.getState().setBandContext('band-b', 'Band B')
    useRepertoireStore.setState({ songs: [entry('s1')] })

    await useRepertoireStore.getState().updateStatus('s1', 'mastered')

    expect(updateSongStatusAction).not.toHaveBeenCalled()
    expect(useRepertoireStore.getState().songs[0].status).toBe('learning')
  })
})
