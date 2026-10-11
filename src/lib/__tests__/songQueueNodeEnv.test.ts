/**
 * RH-133 ER12 — the queue module under the `node` environment.
 *
 * **This file deliberately carries no environment pragma**, so it runs under
 * the project default (`environment: 'node'` in `vitest.config.ts`), which has
 * no `sessionStorage` at all. A pragma is per-file, which is why this is a
 * second file rather than a case inside `songQueue.test.ts`: that one opts into
 * jsdom on its first line and could never prove this. The pragma's own spelling
 * is deliberately absent from this file — ER12 counts it.
 *
 * What it pins is the guard the module is required to carry. Importing it must
 * not throw, and neither must calling its readers: `src/lib` is full of modules
 * imported by `node`-environment suites, and a queue module that threw on
 * import would take every one of them down.
 */
import { describe, it, expect } from 'vitest'
import {
  clearSongQueue,
  queueNeighbours,
  readSongQueue,
  resolveQueueOwner,
  writeSongQueue,
} from '@/lib/songQueue'

describe('songQueue under the node environment', () => {
  it('has no sessionStorage to read, which is the premise of this file', () => {
    expect((globalThis as { sessionStorage?: Storage }).sessionStorage).toBeUndefined()
  })

  it('reads no queue, and does not throw, with no sessionStorage at all', () => {
    expect(() => readSongQueue()).not.toThrow()
    expect(readSongQueue()).toBeNull()
  })

  it('swallows a write and a clear rather than throwing', () => {
    expect(() =>
      writeSongQueue({
        entries: [{ versionId: 'v-1', title: 'Black Dog', artist: 'Led Zeppelin' }],
        owner: { type: 'personal' },
        originHref: '/playlists/pl-1',
        label: 'Gig',
      }),
    ).not.toThrow()
    expect(() => clearSongQueue()).not.toThrow()
    expect(readSongQueue()).toBeNull()
  })

  it('still answers the two pure functions, which touch no browser API', () => {
    const entries = [
      { versionId: 'v-1', title: 'Black Dog', artist: 'Led Zeppelin' },
      { versionId: 'v-2', title: 'Rosanna', artist: 'Toto' },
    ]

    expect(queueNeighbours(entries, 'v-1')).toEqual({ prev: null, next: entries[1] })
    expect(resolveQueueOwner('band-url', { type: 'band', bandId: 'band-queue' })).toBe('band-url')
    expect(resolveQueueOwner(null, { type: 'band', bandId: 'band-queue' })).toBe('band-queue')
  })
})
