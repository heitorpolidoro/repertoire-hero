/**
 * RH-80 — the offline-first decorator, over the real store and in-memory ports.
 *
 * No `vi.mock`, no `vi.fn`, no `vi.spyOn`: every double here is a plain object
 * or a plain function, and the store under the decorator is the *real*
 * `createOfflineStore` over `createFakePorts()` (RH-79's fakes). That is what
 * makes "answers from the snapshot" mean the snapshot the download actually
 * wrote, rather than a hand-shaped stand-in.
 *
 * The rule to check first is the one in the third describe block: a rejection
 * that is not a network failure, and any failed write, is rethrown unchanged.
 * Stale snapshot data is never served in place of a real error.
 */
import { describe, it, expect } from 'vitest'
import {
  isNetworkFailure,
  offlineFirst,
  orderSnapshotCandidates,
  OFFLINE_WRITE_MESSAGE,
  OfflineUnavailableError,
  type OfflineFirstPorts,
} from '@/lib/offlineFirst'
import { createOfflineStore, type OfflineStore } from '@/lib/offlineStore'
import { offlineTabCacheKey } from '@/lib/offlineSnapshot'
import { createFakePorts } from './offlineStoreFakes'
import type { PlaylistEntry } from '@/lib/playlistNav'
import type { Repertoire, RepertoireTab } from '@/types/database'

function repertoire(id: string, overrides: Partial<Repertoire> = {}): Repertoire {
  return {
    id,
    user_id: 'user-1',
    band_id: null,
    song_id: `song-${id}`,
    personal_key: null,
    status: 'learning',
    tags: [],
    last_practiced: null,
    lyrics: 'la la la',
    ...overrides,
  }
}

function entry(repertoireId: string, title: string): PlaylistEntry {
  return { repertoireId, songId: `song-${repertoireId}`, title, artist: 'Artist' }
}

function tab(id: string, repertoireId: string, createdAt: string): RepertoireTab {
  return {
    id,
    repertoire_id: repertoireId,
    title: `Tab ${id}`,
    file_url: `https://blob.example/${id}.pdf`,
    created_at: createdAt,
  }
}

interface SeededPlaylist {
  playlistId: string
  playlistName: string
  savedAt: string
  songs: { repertoireId: string; tabs?: RepertoireTab[] }[]
}

/** The real store over in-memory ports, with the given playlists downloaded. */
async function seededStore(playlists: SeededPlaylist[]): Promise<OfflineStore> {
  const store = createOfflineStore(createFakePorts())
  for (const playlist of playlists) {
    await store.saveOfflinePlaylist({
      playlistId: playlist.playlistId,
      playlistName: playlist.playlistName,
      bandId: null,
      savedAt: playlist.savedAt,
      songs: playlist.songs.map((song) => ({
        entry: entry(song.repertoireId, `Song ${song.repertoireId}`),
        repertoire: repertoire(song.repertoireId),
        tabs: song.tabs ?? [],
      })),
    })
  }
  return store
}

/** `ports` for a browser that has no network. */
async function offlinePorts(playlists: SeededPlaylist[]): Promise<OfflineFirstPorts> {
  return { store: await seededStore(playlists), isOffline: () => true }
}

/** `ports` for a browser that believes it is online. */
async function onlinePorts(playlists: SeededPlaylist[] = []): Promise<OfflineFirstPorts> {
  return { store: await seededStore(playlists), isOffline: () => false }
}

function networkError(): TypeError {
  return new TypeError('Failed to fetch')
}

const ONE_PLAYLIST: SeededPlaylist[] = [
  {
    playlistId: 'pl-1',
    playlistName: 'Friday Set',
    savedAt: '2026-09-20T10:00:00.000Z',
    songs: [
      { repertoireId: 'rep-1', tabs: [tab('tab-1', 'rep-1', '2026-01-02T00:00:00.000Z')] },
      { repertoireId: 'rep-2' },
    ],
  },
]

describe('isNetworkFailure', () => {
  it('is true for a TypeError whose message reads as a failed fetch', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkFailure(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true)
    expect(isNetworkFailure(new TypeError('Network request failed'))).toBe(true)
    expect(isNetworkFailure(new TypeError('Load failed'))).toBe(true)
  })

  it('is true for a structurally-typed TypeError from another realm', () => {
    expect(isNetworkFailure({ name: 'TypeError', message: 'Failed to fetch' })).toBe(true)
  })

  it('is false for an aborted request, a plain Error and a non-error value', () => {
    expect(isNetworkFailure(new DOMException('aborted', 'AbortError'))).toBe(false)
    expect(isNetworkFailure(new Error('Failed to fetch'))).toBe(false)
    expect(isNetworkFailure(new TypeError('x is not a function'))).toBe(false)
    expect(isNetworkFailure('Failed to fetch')).toBe(false)
    expect(isNetworkFailure(null)).toBe(false)
  })
})

describe('orderSnapshotCandidates', () => {
  it('orders by savedAt descending, ties broken by playlistId ascending', () => {
    const ordered = orderSnapshotCandidates([
      { playlistId: 'b', playlistName: 'B', savedAt: '2026-01-01T00:00:00.000Z', bytes: 1, schemaVersion: 1 },
      { playlistId: 'a', playlistName: 'A', savedAt: '2026-01-01T00:00:00.000Z', bytes: 1, schemaVersion: 1 },
      { playlistId: 'c', playlistName: 'C', savedAt: '2026-02-01T00:00:00.000Z', bytes: 1, schemaVersion: 1 },
    ])

    expect(ordered.map((summary) => summary.playlistId)).toEqual(['c', 'a', 'b'])
  })

  it('does not mutate its argument', () => {
    const input = [
      { playlistId: 'a', playlistName: 'A', savedAt: '2026-01-01T00:00:00.000Z', bytes: 1, schemaVersion: 1 },
      { playlistId: 'b', playlistName: 'B', savedAt: '2026-02-01T00:00:00.000Z', bytes: 1, schemaVersion: 1 },
    ]

    orderSnapshotCandidates(input)

    expect(input.map((summary) => summary.playlistId)).toEqual(['a', 'b'])
  })
})

describe('offlineFirst — the wrapper itself', () => {
  it('carries exactly the same own method names as the bundle', async () => {
    const bundle = {
      getTabs: () => Promise.resolve([] as RepertoireTab[]),
      uploadTab: () => Promise.resolve({}),
      updateStatus: () => Promise.resolve(),
    }

    const wrapped = offlineFirst(bundle, await onlinePorts())

    expect(Object.keys(wrapped).sort()).toEqual(Object.keys(bundle).sort())
    expect(wrapped).not.toBe(bundle)
  })

  it('falls back to the real store and navigator when no ports are given', async () => {
    // The production call shape: `offlineFirst(bundle)`. Nothing here says the
    // platform is offline — Node ≥ 21 defines `navigator` but no `onLine` — so
    // the default reads as online and the real action runs. That also proves
    // building the wrapper touches no browser global: `OFFLINE_STORE` is inert
    // until one of its methods is called, and none is.
    const wrapped = offlineFirst({ getTabs: () => Promise.resolve([] as RepertoireTab[]) })

    await expect(wrapped.getTabs()).resolves.toEqual([])
  })

  it('calls the real action untouched while online', async () => {
    const calls: unknown[][] = []
    const wrapped = offlineFirst(
      {
        getSongEntry: (...args: unknown[]) => {
          calls.push(args)
          return Promise.resolve(repertoire('rep-online'))
        },
      },
      await onlinePorts(ONE_PLAYLIST),
    )

    await expect(wrapped.getSongEntry('rep-1', null)).resolves.toEqual(repertoire('rep-online'))
    expect(calls).toEqual([['rep-1', null]])
  })

  it('never calls the real action while offline', async () => {
    let called = 0
    const wrapped = offlineFirst(
      {
        getSongEntry: () => {
          called += 1
          return Promise.resolve(null)
        },
      },
      await offlinePorts(ONE_PLAYLIST),
    )

    await wrapped.getSongEntry('rep-1', null)

    expect(called).toBe(0)
  })
})

describe('offlineFirst — the error policy', () => {
  it('falls back to the snapshot when a reader fails with a network error', async () => {
    const wrapped = offlineFirst(
      { getSongEntry: () => Promise.reject(networkError()) },
      await onlinePorts(ONE_PLAYLIST),
    )

    await expect(wrapped.getSongEntry('rep-1', null)).resolves.toEqual(repertoire('rep-1'))
  })

  it('rethrows a non-network rejection rather than serving the snapshot', async () => {
    const boom = new Error('permission denied')
    const wrapped = offlineFirst(
      { getSongEntry: () => Promise.reject(boom) },
      await onlinePorts(ONE_PLAYLIST),
    )

    await expect(wrapped.getSongEntry('rep-1', null)).rejects.toBe(boom)
  })

  it('rethrows a network rejection from a write', async () => {
    const failure = networkError()
    const wrapped = offlineFirst(
      { updateStatus: () => Promise.reject(failure) },
      await onlinePorts(ONE_PLAYLIST),
    )

    await expect(wrapped.updateStatus('rep-1', 'mastered', null)).rejects.toBe(failure)
  })

  it('rethrows the original error when the offline reader itself throws', async () => {
    const failure = networkError()
    const wrapped = offlineFirst(
      { getPlaylistDetailsWithEntries: () => Promise.reject(failure) },
      // Nothing downloaded, so the offline reader throws OfflineUnavailableError.
      await onlinePorts(),
    )

    await expect(wrapped.getPlaylistDetailsWithEntries('pl-1', null)).rejects.toBe(failure)
  })
})

describe('offlineFirst — the offline readers', () => {
  it('answers getPlaylistDetailsWithEntries from the matching snapshot', async () => {
    const wrapped = offlineFirst(
      { getPlaylistDetailsWithEntries: () => Promise.reject(new Error('unreachable')) },
      await offlinePorts(ONE_PLAYLIST),
    )

    await expect(wrapped.getPlaylistDetailsWithEntries('pl-1', null)).resolves.toEqual({
      name: 'Friday Set',
      entries: [entry('rep-1', 'Song rep-1'), entry('rep-2', 'Song rep-2')],
    })
  })

  it('throws OfflineUnavailableError for a playlist that was never downloaded', async () => {
    const wrapped = offlineFirst(
      { getPlaylistDetailsWithEntries: () => Promise.reject(new Error('unreachable')) },
      await offlinePorts(ONE_PLAYLIST),
    )

    await expect(wrapped.getPlaylistDetailsWithEntries('pl-missing', null)).rejects.toBeInstanceOf(
      OfflineUnavailableError,
    )
  })

  it('answers getSongEntry with the captured repertoire row, and null for a song in no snapshot', async () => {
    const ports = await offlinePorts(ONE_PLAYLIST)
    const wrapped = offlineFirst(
      { getSongEntry: () => Promise.reject(new Error('unreachable')) },
      ports,
    )

    await expect(wrapped.getSongEntry('rep-2', null)).resolves.toEqual(repertoire('rep-2'))
    await expect(wrapped.getSongEntry('rep-nope', null)).resolves.toBeNull()
  })

  it('prefers the most recently downloaded playlist when a song is in two', async () => {
    const wrapped = offlineFirst(
      { getTabs: () => Promise.reject(new Error('unreachable')) },
      await offlinePorts([
        {
          playlistId: 'pl-old',
          playlistName: 'Old',
          savedAt: '2026-09-01T10:00:00.000Z',
          songs: [{ repertoireId: 'rep-1', tabs: [tab('tab-old', 'rep-1', '2026-01-01T00:00:00.000Z')] }],
        },
        {
          playlistId: 'pl-new',
          playlistName: 'New',
          savedAt: '2026-09-20T10:00:00.000Z',
          songs: [{ repertoireId: 'rep-1', tabs: [tab('tab-new', 'rep-1', '2026-01-01T00:00:00.000Z')] }],
        },
      ]),
    )

    const tabs = await wrapped.getTabs('rep-1')

    expect(tabs.map((row) => row.id)).toEqual(['tab-new'])
    expect(tabs[0].file_url).toBe(offlineTabCacheKey('pl-new', 'tab-new'))
  })

  it('answers getTabs with the cache key as file_url, and [] for a song in no snapshot', async () => {
    const wrapped = offlineFirst(
      { getTabs: () => Promise.reject(new Error('unreachable')) },
      await offlinePorts(ONE_PLAYLIST),
    )

    await expect(wrapped.getTabs('rep-1')).resolves.toEqual([
      {
        id: 'tab-1',
        repertoire_id: 'rep-1',
        title: 'Tab tab-1',
        file_url: offlineTabCacheKey('pl-1', 'tab-1'),
        created_at: '2026-01-02T00:00:00.000Z',
      },
    ])
    await expect(wrapped.getTabs('rep-2')).resolves.toEqual([])
    await expect(wrapped.getTabs('rep-nope')).resolves.toEqual([])
  })

  it('always answers getPersonalEntryForSong with null', async () => {
    const wrapped = offlineFirst(
      { getPersonalEntryForSong: () => Promise.reject(new Error('unreachable')) },
      await offlinePorts(ONE_PLAYLIST),
    )

    await expect(wrapped.getPersonalEntryForSong('song-rep-1')).resolves.toBeNull()
  })

  it('answers getAnnotations with an empty annotation set, never an error envelope', async () => {
    const wrapped = offlineFirst(
      { getAnnotations: () => Promise.reject(new Error('unreachable')) },
      await offlinePorts(ONE_PLAYLIST),
    )

    await expect(wrapped.getAnnotations('tab-1', 'rep-1')).resolves.toEqual({ data: {} })
  })
})

describe('offlineFirst — the offline writes', () => {
  it('resolves an envelope carrying the offline message for an envelope write', async () => {
    const ports = await offlinePorts(ONE_PLAYLIST)
    const wrapped = offlineFirst(
      {
        uploadTab: () => Promise.reject(new Error('unreachable')),
        deleteTab: () => Promise.reject(new Error('unreachable')),
        saveAnnotations: () => Promise.reject(new Error('unreachable')),
        updateLinks: () => Promise.reject(new Error('unreachable')),
      },
      ports,
    )

    for (const call of [
      wrapped.uploadTab(),
      wrapped.deleteTab(),
      wrapped.saveAnnotations(),
      wrapped.updateLinks(),
    ]) {
      await expect(call).resolves.toEqual({ success: false, error: OFFLINE_WRITE_MESSAGE })
    }
  })

  it('rejects with the offline message for a write declared to resolve a value', async () => {
    const ports = await offlinePorts(ONE_PLAYLIST)
    const wrapped = offlineFirst(
      {
        updateStatus: () => Promise.reject(new Error('unreachable')),
        updateLyrics: () => Promise.reject(new Error('unreachable')),
        fetchLyrics: () => Promise.reject(new Error('unreachable')),
        fetchUrlTitle: () => Promise.reject(new Error('unreachable')),
        addSong: () => Promise.reject(new Error('unreachable')),
      },
      ports,
    )

    for (const call of [
      wrapped.updateStatus(),
      wrapped.updateLyrics(),
      wrapped.fetchLyrics(),
      wrapped.fetchUrlTitle(),
      wrapped.addSong(),
    ]) {
      await expect(call).rejects.toThrow(OFFLINE_WRITE_MESSAGE)
    }
  })

  it('refuses an unknown method offline rather than serving or fetching anything', async () => {
    const wrapped = offlineFirst(
      { someFutureAction: () => Promise.resolve('should never run') },
      await offlinePorts(ONE_PLAYLIST),
    )

    await expect(wrapped.someFutureAction()).rejects.toThrow(OFFLINE_WRITE_MESSAGE)
  })

  it('does not fall back for an unknown method that fails with a network error online', async () => {
    const failure = networkError()
    const wrapped = offlineFirst(
      { someFutureAction: () => Promise.reject(failure) },
      await onlinePorts(ONE_PLAYLIST),
    )

    await expect(wrapped.someFutureAction()).rejects.toBe(failure)
  })
})
