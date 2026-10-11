// @vitest-environment jsdom
/**
 * RH-133 — the song queue: what it stores, what it refuses, and who owns a song.
 *
 * The pragma on line 1 is load-bearing: `src/lib` tests default to
 * `environment: 'node'`, which has no `sessionStorage` at all, so without it
 * every case here would throw instead of testing. `songQueueNodeEnv.test.ts` is
 * the deliberate opposite — no pragma — and proves the module's guard.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearSongQueue,
  queueNeighbours,
  readSongQueue,
  resolveQueueOwner,
  writeSongQueue,
  SONG_QUEUE_KEY,
  type SongQueue,
} from '../songQueue'

/** Three entries, so both ends and a middle exist. */
const ENTRIES = [
  { versionId: 'v-1', title: 'Black Dog', artist: 'Led Zeppelin' },
  { versionId: 'v-2', title: 'Rosanna', artist: 'Toto' },
  { versionId: 'v-3', title: 'Untitled', artist: null },
]

const BAND_QUEUE: SongQueue = {
  entries: ENTRIES,
  owner: { type: 'band', bandId: 'band-queue' },
  originHref: '/playlists/pl-1',
  label: 'Saturday gig',
}

/**
 * The `localStorage` band context, seeded exactly as `bandContextStore`'s
 * `persist` middleware writes it. Every resolver case below seeds it, as a
 * negative control: the resolver must never return `band-stored`.
 */
function seedStoredBandContext(bandId: string): void {
  localStorage.setItem(
    'band-context',
    JSON.stringify({ state: { context: { type: 'band', id: bandId, name: 'Stored' } }, version: 0 }),
  )
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})

describe('readSongQueue / writeSongQueue', () => {
  it('round-trips a queue through sessionStorage', () => {
    writeSongQueue(BAND_QUEUE)

    expect(readSongQueue()).toEqual(BAND_QUEUE)
  })

  it('round-trips a personal queue built from a non-playlist origin', () => {
    const personal: SongQueue = {
      entries: [ENTRIES[0]],
      owner: { type: 'personal' },
      originHref: '/bands/band-7',
      label: 'Tonight',
    }
    writeSongQueue(personal)

    expect(readSongQueue()).toEqual(personal)
  })

  it('reads no queue in a fresh tab, where sessionStorage is empty', () => {
    expect(readSongQueue()).toBeNull()
  })

  it('reads no queue, and does not throw, for a malformed value', () => {
    for (const malformed of ['{', '', 'null', '[]', '7', '"a string"']) {
      sessionStorage.setItem(SONG_QUEUE_KEY, malformed)
      expect(() => readSongQueue()).not.toThrow()
      expect(readSongQueue()).toBeNull()
    }
  })

  it('reads no queue for a document whose parts are the wrong shape', () => {
    const broken: unknown[] = [
      { ...BAND_QUEUE, entries: 'not an array' },
      { ...BAND_QUEUE, entries: [{ versionId: 'v-1' }] },
      { ...BAND_QUEUE, entries: [{ versionId: 7, title: 'x', artist: null }] },
      { ...BAND_QUEUE, owner: { type: 'band' } },
      { ...BAND_QUEUE, owner: { type: 'nonsense' } },
      { ...BAND_QUEUE, originHref: 42 },
      { ...BAND_QUEUE, label: null },
    ]
    for (const value of broken) {
      sessionStorage.setItem(SONG_QUEUE_KEY, JSON.stringify(value))
      expect(readSongQueue()).toBeNull()
    }
  })

  it('clearSongQueue removes the queue and leaves the rest of sessionStorage alone', () => {
    sessionStorage.setItem('something-else', 'kept')
    writeSongQueue(BAND_QUEUE)

    clearSongQueue()

    expect(readSongQueue()).toBeNull()
    expect(sessionStorage.getItem('something-else')).toBe('kept')
  })
})

/**
 * A browser that refuses storage. Reading the `sessionStorage` property can
 * throw outright under some privacy settings, and `setItem` can throw when the
 * quota is full — two distinct failures that both have to read as "no queue"
 * rather than as a broken page, because the queue is optional chrome.
 */
describe('a browser that refuses storage', () => {
  /** Replaces the global with a throwing accessor, and restores it after. */
  function withDeniedStorage(run: () => void): void {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('The operation is insecure.')
      },
    })
    try {
      run()
    } finally {
      if (original) Object.defineProperty(globalThis, 'sessionStorage', original)
      else delete (globalThis as { sessionStorage?: Storage }).sessionStorage
    }
  }

  it('reads, writes and clears without throwing when the property itself throws', () => {
    withDeniedStorage(() => {
      expect(readSongQueue()).toBeNull()
      expect(() => writeSongQueue(BAND_QUEUE)).not.toThrow()
      expect(() => clearSongQueue()).not.toThrow()
    })
  })

  it('reads no queue when getItem throws, and swallows a failing setItem and removeItem', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
    const hostile = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: hostile })
    try {
      expect(readSongQueue()).toBeNull()
      expect(() => writeSongQueue(BAND_QUEUE)).not.toThrow()
      expect(() => clearSongQueue()).not.toThrow()
    } finally {
      if (original) Object.defineProperty(globalThis, 'sessionStorage', original)
    }
  })
})

/**
 * ER7 — the stored shape is inspected directly, not through the reader, so
 * field creep is caught. No lyrics, key, tuning, map, status, tags, and no
 * stored position: that is what keeps the chrome usable with no network.
 */
describe('the stored document', () => {
  it('stores exactly version id, title and artist per entry', () => {
    writeSongQueue(BAND_QUEUE)

    const raw = sessionStorage.getItem(SONG_QUEUE_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string)
    expect(parsed.entries).toHaveLength(ENTRIES.length)
    for (const entry of parsed.entries) {
      expect(Object.keys(entry).sort()).toEqual(['artist', 'title', 'versionId'])
    }
  })

  it('drops any extra field a caller hands in, rather than storing it', () => {
    writeSongQueue({
      ...BAND_QUEUE,
      entries: [
        // A caller passing a richer row — a playlist entry, say — must not be
        // able to put lyrics or a status into the queue by accident.
        { ...ENTRIES[0], lyrics: 'hey hey mama', status: 'mastered', repertoireId: 'rep-1' },
      ],
    } as SongQueue)

    const parsed = JSON.parse(sessionStorage.getItem(SONG_QUEUE_KEY) as string)
    expect(Object.keys(parsed.entries[0]).sort()).toEqual(['artist', 'title', 'versionId'])
  })

  it('stores no position of its own', () => {
    writeSongQueue(BAND_QUEUE)

    const parsed = JSON.parse(sessionStorage.getItem(SONG_QUEUE_KEY) as string)
    expect(Object.keys(parsed).sort()).toEqual(['entries', 'label', 'originHref', 'owner'])
  })
})

/** ER5 — the ends are absent, never wrapped. */
describe('queueNeighbours', () => {
  it('has no previous at index 0 and no next at the last index, and never wraps', () => {
    const first = queueNeighbours(ENTRIES, 'v-1')
    const last = queueNeighbours(ENTRIES, 'v-3')

    expect(first.prev).toBeNull()
    expect(first.next).toEqual(ENTRIES[1])
    expect(last.next).toBeNull()
    expect(last.prev).toEqual(ENTRIES[1])

    // No wraparound in either direction: the ends do not see each other.
    expect(first.prev).not.toEqual(ENTRIES[2])
    expect(last.next).not.toEqual(ENTRIES[0])
  })

  it('names both plain neighbours of a middle entry', () => {
    expect(queueNeighbours(ENTRIES, 'v-2')).toEqual({ prev: ENTRIES[0], next: ENTRIES[2] })
  })

  it('has neither neighbour for a version absent from the queue, or an empty queue', () => {
    expect(queueNeighbours(ENTRIES, 'v-99')).toEqual({ prev: null, next: null })
    expect(queueNeighbours(ENTRIES, '')).toEqual({ prev: null, next: null })
    expect(queueNeighbours([], 'v-1')).toEqual({ prev: null, next: null })
  })

  it('has neither neighbour in a one-song queue', () => {
    expect(queueNeighbours([ENTRIES[0]], 'v-1')).toEqual({ prev: null, next: null })
  })
})

/**
 * ER6 — owner-context precedence, with all three sources disagreeing.
 *
 * The URL is the single channel: a stored preference reaches Fast View only
 * because the link that was clicked serialised it into `?bandId=`, so reading
 * the store again here would read the same source twice and would let a
 * drifting preference override a URL the musician explicitly opened.
 */
describe('resolveQueueOwner', () => {
  it('lets the URL bandId win over a disagreeing queue owner and a stored context', () => {
    seedStoredBandContext('band-stored')

    const resolved = resolveQueueOwner('band-url', { type: 'band', bandId: 'band-queue' })

    expect(resolved).toBe('band-url')
    expect(resolved).not.toBe('band-queue')
    expect(resolved).not.toBe('band-stored')
  })

  it('applies the queue owner only when the URL carries no bandId at all', () => {
    seedStoredBandContext('band-stored')

    const resolved = resolveQueueOwner(null, { type: 'band', bandId: 'band-queue' })

    expect(resolved).toBe('band-queue')
    expect(resolved).not.toBe('band-stored')
  })

  it('lets the URL bandId win over a personal queue owner', () => {
    seedStoredBandContext('band-stored')

    expect(resolveQueueOwner('band-url', { type: 'personal' })).toBe('band-url')
  })

  it('resolves personal when the URL is empty and the queue says personal', () => {
    seedStoredBandContext('band-stored')

    expect(resolveQueueOwner(null, { type: 'personal' })).toBeNull()
    expect(resolveQueueOwner('', { type: 'personal' })).toBeNull()
  })

  it('resolves personal with no URL bandId and no queue at all', () => {
    seedStoredBandContext('band-stored')

    expect(resolveQueueOwner(null, null)).toBeNull()
    expect(resolveQueueOwner(null, undefined)).toBeNull()
  })

  it('treats an empty URL bandId as absent, so the queue owner still applies', () => {
    expect(resolveQueueOwner('', { type: 'band', bandId: 'band-queue' })).toBe('band-queue')
  })
})
