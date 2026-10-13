import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  awaitSongWindow,
  cachedSong,
  fetchSongWindow,
  invalidateSongWindow,
  resetSongWindow,
  uncachedVersionIds,
  windowVersionIds,
  type SongWindowRecord,
} from '@/lib/songWindow'
import type { ResolvedSongEntry } from '@/types/database'

beforeEach(() => resetSongWindow())

const queue = ['v1', 'v2', 'v3', 'v4', 'v5'].map((versionId) => ({ versionId }))

function record(versionId: string, lyrics = 'old'): SongWindowRecord {
  return { versionId, entry: { lyrics } as unknown as ResolvedSongEntry, files: [] }
}

describe('windowVersionIds', () => {
  it('is n-1, n, n+1 in the middle of the queue', () => {
    expect(windowVersionIds(queue, 'v3')).toEqual(['v2', 'v3', 'v4'])
  })
  it('is two ids at the first entry', () => {
    expect(windowVersionIds(queue, 'v1')).toEqual(['v1', 'v2'])
  })
  it('is two ids at the last entry', () => {
    expect(windowVersionIds(queue, 'v5')).toEqual(['v4', 'v5'])
  })
  it('is one id for a queue of one', () => {
    expect(windowVersionIds([{ versionId: 'v1' }], 'v1')).toEqual(['v1'])
  })
  it('is just the current song with no queue or a song outside it', () => {
    expect(windowVersionIds([], 'v9')).toEqual(['v9'])
    expect(windowVersionIds(queue, 'v9')).toEqual(['v9'])
  })
})

describe('the window cache', () => {
  it('issues one fetcher call for the uncached ids', async () => {
    const fetcher = vi.fn(async (ids: string[]) => ids.map((id) => record(id)))
    await fetchSongWindow(null, ['v2', 'v3', 'v4'], fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(['v2', 'v3', 'v4'])

    await fetchSongWindow(null, ['v3', 'v4', 'v5'], fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenLastCalledWith(['v5'])
  })

  it('a cache hit issues no call', async () => {
    const fetcher = vi.fn(async (ids: string[]) => ids.map((id) => record(id)))
    await fetchSongWindow('b1', ['v1'], fetcher)
    await fetchSongWindow('b1', ['v1'], fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(cachedSong('b1', 'v1')?.versionId).toBe('v1')
  })

  it('keys the cache by band, so another owner misses', async () => {
    await fetchSongWindow('b1', ['v1'], async (ids) => ids.map((id) => record(id)))
    expect(cachedSong('b2', 'v1')).toBeUndefined()
    expect(cachedSong(null, 'v1')).toBeUndefined()
  })

  it('does not keep a version that does not exist', async () => {
    await fetchSongWindow(null, ['gone'], async () => [{ versionId: 'gone', entry: null, files: [] }])
    expect(cachedSong(null, 'gone')).toBeUndefined()
  })

  it('invalidate-then-refetch asks again for that song only', async () => {
    const fetcher = vi.fn(async (ids: string[]) => ids.map((id) => record(id)))
    await fetchSongWindow(null, ['v3', 'v4'], fetcher)
    invalidateSongWindow('v4')
    expect(cachedSong(null, 'v4')).toBeUndefined()
    expect(cachedSong(null, 'v3')).toBeDefined()

    await fetchSongWindow(null, ['v3', 'v4'], fetcher)
    expect(fetcher).toHaveBeenLastCalledWith(['v4'])
  })

  it('in-flight fetch discarded after an invalidate', async () => {
    let resolve!: (records: SongWindowRecord[]) => void
    const pending = new Promise<SongWindowRecord[]>((r) => (resolve = r))
    const inFlight = fetchSongWindow(null, ['v4'], () => pending)

    invalidateSongWindow('v4')
    resolve([record('v4', 'OLD COPY')])
    await inFlight

    expect(cachedSong(null, 'v4')).toBeUndefined()
    // and the next window asks again rather than trusting the dead request
    const fetcher = vi.fn(async (ids: string[]) => ids.map((id) => record(id, 'new')))
    await fetchSongWindow(null, ['v4'], fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('lets a reader wait for the fetch filling its song, and never rejects', async () => {
    let reject!: (e: Error) => void
    const pending = new Promise<SongWindowRecord[]>((_, r) => (reject = r))
    const inFlight = fetchSongWindow(null, ['v1'], () => pending)
    expect(uncachedVersionIds(null, ['v1'])).toEqual([])
    const waiting = awaitSongWindow(null, 'v1')
    reject(new Error('boom'))
    await expect(inFlight).rejects.toThrow('boom')
    await expect(waiting).resolves.toBeUndefined()
    expect(cachedSong(null, 'v1')).toBeUndefined()
    expect(uncachedVersionIds(null, ['v1'])).toEqual(['v1'])
  })

  it('does not fetch or serve while the browser is offline', async () => {
    await fetchSongWindow(null, ['v1'], async (ids) => ids.map((id) => record(id)))
    vi.stubGlobal('navigator', { onLine: false })
    try {
      const fetcher = vi.fn(async () => [])
      await fetchSongWindow(null, ['v2'], fetcher)
      expect(fetcher).not.toHaveBeenCalled()
      expect(cachedSong(null, 'v1')).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('the window code guard', () => {
  it('window code contains no content-type literal and no isImageTab bypass', () => {
    const files = [
      'src/lib/songWindow.ts',
      'src/lib/songWindowData.ts',
      'src/hooks/useSongWindow.ts',
    ]
    for (const file of files) {
      const source = fs
        .readFileSync(path.resolve(__dirname, '..', '..', '..', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      expect(source, file).not.toMatch(/content_type|contentType|image\/|application\/|isImageTab/)
    }
  })
})
