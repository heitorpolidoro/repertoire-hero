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
  type OfflineFirstPorts,
} from '@/lib/offlineFirst'
import { createOfflineStore, type OfflineStore } from '@/lib/offlineStore'
import { offlineTabCacheKey } from '@/lib/offlineSnapshot'
import { createFakePorts } from './offlineStoreFakes'
import type { PlaylistEntry } from '@/lib/playlistNav'
import type { Repertoire, ResolvedSongEntry, SongFile } from '@/types/database'

/** The captured `(owner, version)` pair — a `ResolvedSongEntry` since RH-132. */
function repertoire(id: string, overrides: Partial<ResolvedSongEntry> = {}): ResolvedSongEntry {
  return {
    ownerRowId: id,
    song_id: `song-${id}`,
    version_id: `v-${id}`,
    key: null,
    tuning: null,
    map: null,
    status: 'learning',
    tags: [],
    last_practiced: null,
    lyrics: 'la la la',
    ...overrides,
  }
}

/** The member's own row, still a `Repertoire` (RH-132 ER14). */
function personalRow(id: string, lyrics: string): Repertoire {
  return {
    id: `personal-${id}`,
    user_id: 'user-1',
    band_id: null,
    song_id: `song-${id}`,
    version_id: `v-${id}`,
    key: null,
    tuning: null,
    map: null,
    status: 'learning',
    tags: [],
    last_practiced: null,
    lyrics,
  }
}

function entry(repertoireId: string, title: string): PlaylistEntry {
  return {
    repertoireId,
    versionId: `v-${repertoireId}`,
    songId: `song-${repertoireId}`,
    title,
    artist: 'Artist',
  }
}

function tab(id: string, songId: string, createdAt: string): SongFile {
  return {
    id,
    user_id: 'user-1',
    song_id: songId,
    title: `Tab ${id}`,
    file_url: `https://blob.example/${id}.pdf`,
    created_at: createdAt,
  }
}

interface SeededPlaylist {
  playlistId: string
  playlistName: string
  savedAt: string
  songs: {
    repertoireId: string
    tabs?: SongFile[]
    personalLyrics?: string
    /** RH-132: the owner holds no row at this version. */
    noOwnerRow?: boolean
  }[]
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
        repertoire: song.noOwnerRow
          ? repertoire(song.repertoireId, { ownerRowId: null, status: null, tags: [] })
          : repertoire(song.repertoireId),
        personalRepertoire: song.personalLyrics
          ? personalRow(song.repertoireId, song.personalLyrics)
          : null,
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
      { repertoireId: 'rep-1', tabs: [tab('tab-1', 'song-rep-1', '2026-01-02T00:00:00.000Z')], personalLyrics: 'my cues' },
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
      getTabs: () => Promise.resolve([] as SongFile[]),
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
    const wrapped = offlineFirst({ getTabs: () => Promise.resolve([] as SongFile[]) })

    await expect(wrapped.getTabs()).resolves.toEqual([])
  })

  it('calls the real action untouched while online', async () => {
    const calls: unknown[][] = []
    const wrapped = offlineFirst(
      {
        getResolvedEntryForVersion: (...args: unknown[]) => {
          calls.push(args)
          return Promise.resolve(repertoire('rep-online'))
        },
      },
      await onlinePorts(ONE_PLAYLIST),
    )

    await expect(wrapped.getResolvedEntryForVersion('v-rep-1', null)).resolves.toEqual(
      repertoire('rep-online'),
    )
    expect(calls).toEqual([['v-rep-1', null]])
  })

  it('never calls the real action while offline', async () => {
    let called = 0
    const wrapped = offlineFirst(
      {
        getResolvedEntryForVersion: () => {
          called += 1
          return Promise.resolve(null)
        },
      },
      await offlinePorts(ONE_PLAYLIST),
    )

    await wrapped.getResolvedEntryForVersion('v-rep-1', null)

    expect(called).toBe(0)
  })
})

describe('offlineFirst — the error policy', () => {
  it('falls back to the snapshot when a reader fails with a network error', async () => {
    const wrapped = offlineFirst(
      { getResolvedEntryForVersion: () => Promise.reject(networkError()) },
      await onlinePorts(ONE_PLAYLIST),
    )

    await expect(wrapped.getResolvedEntryForVersion('v-rep-1', null)).resolves.toEqual(
      repertoire('rep-1'),
    )
  })

  it('rethrows a non-network rejection rather than serving the snapshot', async () => {
    const boom = new Error('permission denied')
    const wrapped = offlineFirst(
      { getResolvedEntryForVersion: () => Promise.reject(boom) },
      await onlinePorts(ONE_PLAYLIST),
    )

    await expect(wrapped.getResolvedEntryForVersion('v-rep-1', null)).rejects.toBe(boom)
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
    const store = await seededStore(ONE_PLAYLIST)
    const wrapped = offlineFirst(
      { getResolvedEntryForVersion: () => Promise.reject(failure) },
      {
        // The snapshot store itself is broken, so the offline reader throws
        // rather than answering. The caller must then get the truth it would
        // have got without this decorator: the network failure, not the
        // storage one.
        store: {
          ...store,
          listOfflinePlaylists: () => Promise.reject(new Error('IndexedDB is gone')),
        },
        isOffline: () => false,
      },
    )

    await expect(wrapped.getResolvedEntryForVersion('v-rep-1', null)).rejects.toBe(failure)
  })
})

/**
 * RH-133 removed `getPlaylistDetailsWithEntries` from `OFFLINE_READERS`: the
 * setlist is the tab's own `sessionStorage` queue now, so there is no setlist
 * read to answer from a snapshot, online or off. The two cases that pinned that
 * reader went with it; everything below is the entry and file reads, unchanged.
 */
describe('offlineFirst — the offline readers', () => {
  /**
   * RH-132 ER5b — the offline entry reader finds a v6 song by its `versionId`.
   *
   * The owner row id is no longer an address, so it finds nothing: that is the
   * assertion that catches a reader left keyed on the old field, which would
   * render `OfflineUnavailable` for every downloaded song.
   */
  it('answers the entry read by versionId, and null for a version in no snapshot', async () => {
    const ports = await offlinePorts(ONE_PLAYLIST)
    const wrapped = offlineFirst(
      { getResolvedEntryForVersion: () => Promise.reject(new Error('unreachable')) },
      ports,
    )

    await expect(wrapped.getResolvedEntryForVersion('v-rep-2', null)).resolves.toEqual(
      repertoire('rep-2'),
    )
    await expect(wrapped.getResolvedEntryForVersion('v-rep-nope', null)).resolves.toBeNull()
    // The owner row id is not an address: looking one up finds nothing.
    await expect(wrapped.getResolvedEntryForVersion('rep-2', null)).resolves.toBeNull()
  })

  /** RH-132 ER5b — including a captured song whose owner holds no row. */
  it('finds a captured version whose ownerRowId is null', async () => {
    const wrapped = offlineFirst(
      { getResolvedEntryForVersion: () => Promise.reject(new Error('unreachable')) },
      await offlinePorts([
        {
          playlistId: 'pl-1',
          playlistName: 'Friday Set',
          savedAt: '2026-09-20T10:00:00.000Z',
          songs: [{ repertoireId: 'rep-9', noOwnerRow: true }],
        },
      ]),
    )

    const found = await wrapped.getResolvedEntryForVersion('v-rep-9', null)

    expect(found).not.toBeNull()
    expect((found as ResolvedSongEntry).ownerRowId).toBeNull()
    expect((found as ResolvedSongEntry).status).toBeNull()
    expect((found as ResolvedSongEntry).version_id).toBe('v-rep-9')
  })

  it('prefers the most recently downloaded playlist when a song is in two', async () => {
    const wrapped = offlineFirst(
      { getTabs: () => Promise.reject(new Error('unreachable')) },
      await offlinePorts([
        {
          playlistId: 'pl-old',
          playlistName: 'Old',
          savedAt: '2026-09-01T10:00:00.000Z',
          songs: [{ repertoireId: 'rep-1', tabs: [tab('tab-old', 'song-rep-1', '2026-01-01T00:00:00.000Z')] }],
        },
        {
          playlistId: 'pl-new',
          playlistName: 'New',
          savedAt: '2026-09-20T10:00:00.000Z',
          songs: [{ repertoireId: 'rep-1', tabs: [tab('tab-new', 'song-rep-1', '2026-01-01T00:00:00.000Z')] }],
        },
      ]),
    )

    const tabs = await wrapped.getTabs('song-rep-1')

    expect(tabs.map((row) => row.id)).toEqual(['tab-new'])
    expect(tabs[0].file_url).toBe(offlineTabCacheKey('pl-new', 'tab-new'))
  })

  // ER9: the reader resolves through `findSongBySongId`, so the argument is a
  // song id. A repertoire row id — which is what the route carries and what
  // this reader was called with before RH-123 — now finds nothing, and the two
  // assertions at the end are what pin that.
  it('answers getTabs by song id, with the cache key as file_url', async () => {
    const wrapped = offlineFirst(
      { getTabs: () => Promise.reject(new Error('unreachable')) },
      await offlinePorts(ONE_PLAYLIST),
    )

    await expect(wrapped.getTabs('song-rep-1')).resolves.toEqual([
      {
        id: 'tab-1',
        user_id: 'user-1',
        song_id: 'song-rep-1',
        title: 'Tab tab-1',
        file_url: offlineTabCacheKey('pl-1', 'tab-1'),
        created_at: '2026-01-02T00:00:00.000Z',
        // RH-128: the snapshot carries no content type here, which reads as a
        // PDF — every snapshot written before that task is one.
        content_type: 'application/pdf',
      },
    ])
    // A captured song with no files, and a song in no snapshot at all.
    await expect(wrapped.getTabs('song-rep-2')).resolves.toEqual([])
    await expect(wrapped.getTabs('song-nope')).resolves.toEqual([])
    // The repertoire row id is no longer a key this reader understands.
    await expect(wrapped.getTabs('rep-1')).resolves.toEqual([])
    // RH-132 ER5c: nor is the *version* id. A file hangs off `(user_id,
    // song_id)`, so re-addressing Fast View by version changes nothing here.
    await expect(wrapped.getTabs('v-rep-1')).resolves.toEqual([])
  })

  // RH-83 ER10: the snapshot now carries the member's own row, so the badge and
  // the resolved version are the same offline as online, through the same code.
  it('answers getPersonalEntryForSong from the snapshot, by song id', async () => {
    const wrapped = offlineFirst(
      { getPersonalEntryForSong: () => Promise.reject(new Error('unreachable')) },
      await offlinePorts(ONE_PLAYLIST),
    )

    const found = await wrapped.getPersonalEntryForSong('song-rep-1')
    expect((found as { lyrics: string }).lyrics).toBe('my cues')

    // The captured row itself, unchanged — still the member's `Repertoire`.
    expect((found as { id: string }).id).toBe('personal-rep-1')

    // A captured song with no personal row, and a song in no snapshot at all.
    await expect(wrapped.getPersonalEntryForSong('song-rep-2')).resolves.toBeNull()
    await expect(wrapped.getPersonalEntryForSong('song-nope')).resolves.toBeNull()
    // RH-132 ER5d: resolved through `repertoire.song_id`, never the version.
    await expect(wrapped.getPersonalEntryForSong('v-rep-1')).resolves.toBeNull()
    await expect(wrapped.getPersonalEntryForSong('rep-1')).resolves.toBeNull()
  })

  it('answers getAnnotations with an empty annotation set, never an error envelope', async () => {
    const wrapped = offlineFirst(
      { getAnnotations: () => Promise.reject(new Error('unreachable')) },
      await offlinePorts(ONE_PLAYLIST),
    )

    await expect(wrapped.getAnnotations('tab-1')).resolves.toEqual({ data: {} })
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
