// @vitest-environment jsdom
/**
 * RH-79 — the download controller, over the real store and fake ports.
 *
 * Every test here injects `createOfflineStore(createFakePorts())`: the real
 * store, with only `indexedDB`, Cache Storage and `fetch` replaced. That is the
 * whole point of the rollback test below — a hand-written store double performs
 * no rollback, so asserting "nothing survived" against one would be vacuous.
 * What is asserted is the fake ports' own contents after the hook has settled.
 *
 * The first test carries ER6: this file imports `@/lib/offlineStore` under
 * `jsdom`, which implements neither `indexedDB` nor `caches`, and the import
 * must be inert.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import {
  useOfflinePlaylist,
  type OfflineDownloadActions,
  type UseOfflinePlaylistOptions,
} from '@/hooks/useOfflinePlaylist'
import { OFFLINE_STORE, createOfflineStore } from '@/lib/offlineStore'
import { createFakePorts, type FakeOfflinePorts } from '@/lib/__tests__/offlineStoreFakes'
import type { Repertoire, ResolvedSongEntry, SongFile } from '@/types/database'

afterEach(cleanup)

/**
 * The captured `(owner, version)` pair, keyed by the version the entry names.
 *
 * `versionId` is `v-rep-N` in this fixture, and `song_id` is `song-rep-N` —
 * the pairing the entries below carry, so the song-keyed reads stay
 * distinguishable from the version-keyed one.
 */
function resolvedEntry(versionId: string): ResolvedSongEntry {
  const ownerRowId = versionId.replace(/^v-/, '')
  return {
    ownerRowId,
    song_id: `song-${ownerRowId}`,
    version_id: versionId,
    key: null,
    tuning: null,
    map: null,
    status: 'learning',
    tags: [],
    last_practiced: null,
    lyrics: null,
  }
}

/** The member's own row, still a `Repertoire` read by song id (RH-132 ER14). */
function personalRow(songId: string): Repertoire {
  return {
    id: `personal-${songId}`,
    user_id: 'user-1',
    band_id: null,
    song_id: songId,
    version_id: `v-${songId}`,
    key: null,
    tuning: null,
    map: null,
    status: 'learning',
    tags: [],
    last_practiced: null,
    lyrics: null,
  }
}

function tabRow(id: string, songId: string): SongFile {
  return {
    id,
    user_id: 'user-1',
    song_id: songId,
    title: `Chart ${id}`,
    file_url: `https://store.public.blob.vercel-storage.com/tabs/${id}.pdf`,
    created_at: '2026-05-01T00:00:00Z',
  }
}

const ENTRIES = [
  { repertoireId: 'rep-1', versionId: 'v-rep-1', songId: 'song-rep-1', title: 'Tempo Perdido', artist: 'Legião Urbana' },
  { repertoireId: 'rep-2', versionId: 'v-rep-2', songId: 'song-rep-2', title: 'Faroeste Caboclo', artist: null },
]

function makeActions(): OfflineDownloadActions {
  return {
    getPlaylistDetailsWithEntries: vi.fn().mockResolvedValue({ name: 'Gig', entries: ENTRIES }),
    getResolvedEntryForVersion: vi.fn((versionId: string) =>
      Promise.resolve(resolvedEntry(versionId)),
    ),
    getTabs: vi.fn((songId: string) => Promise.resolve([tabRow(`tab-${songId}`, songId)])),
    getPersonalEntryForSong: vi.fn((songId: string) => Promise.resolve(personalRow(songId))),
  }
}

function setup(overrides: Partial<UseOfflinePlaylistOptions> = {}, ports?: FakeOfflinePorts) {
  const fakePorts = ports ?? createFakePorts()
  const options: UseOfflinePlaylistOptions = {
    playlistId: 'pl-1',
    playlistName: 'Gig',
    bandId: 'band-1',
    actions: makeActions(),
    store: createOfflineStore(fakePorts),
    ...overrides,
  }
  const statuses: string[] = []
  const view = renderHook(() => {
    const controller = useOfflinePlaylist(options)
    statuses.push(controller.status)
    return controller
  })
  return { ...view, ports: fakePorts, options, statuses }
}

describe('importing the store under jsdom (ER6)', () => {
  it('constructs OFFLINE_STORE without touching indexedDB or caches', () => {
    expect(OFFLINE_STORE).toBeDefined()
    expect(typeof OFFLINE_STORE.saveOfflinePlaylist).toBe('function')
    // jsdom implements neither, and this repository carries no `fake-indexeddb`.
    // A default port constructed at import time would already have thrown above.
    expect('indexedDB' in globalThis).toBe(false)
    expect('caches' in globalThis).toBe(false)
  })
})

describe('useOfflinePlaylist — the happy path', () => {
  it('starts idle when nothing is stored for this playlist', async () => {
    const { result } = setup()

    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(result.current.summary).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('goes idle -> downloading -> downloaded, counting songs as it goes', async () => {
    const { result, ports } = setup()
    await waitFor(() => expect(result.current.status).toBe('idle'))

    let finished: Promise<void> = Promise.resolve()
    act(() => {
      finished = result.current.download()
    })
    expect(result.current.status).toBe('downloading')

    await act(async () => {
      await finished
    })

    expect(result.current.status).toBe('downloaded')
    expect(result.current.progress).toEqual({ done: 2, total: 2 })
    expect(result.current.summary?.playlistId).toBe('pl-1')
    expect(result.current.summary?.bytes).toBeGreaterThan(0)
    expect(ports.blobs.keysFor('pl-1').sort()).toEqual([
      '/__offline-tab/pl-1/tab-song-rep-1',
      '/__offline-tab/pl-1/tab-song-rep-2',
    ])
    expect(ports.records.rows.get('pl-1')?.snapshot.songs.map((song) => song.versionId)).toEqual([
      'v-rep-1',
      'v-rep-2',
    ])
  })

  /**
   * RH-123 ER10 — the capture passes a **song id**.
   *
   * This is where the plan's recorded defect lived: `entry.repertoireId` is the
   * *band* row in band context, so the snapshot took the band's files and
   * skipped the member's own. `bandId` is non-null in this fixture, so the
   * assertions below are taken in exactly that context.
   */
  it('calls getTabs with the song id, never with a repertoire id', async () => {
    const actions = makeActions()
    const { result } = setup({ actions, bandId: 'band-1' })
    await waitFor(() => expect(result.current.status).toBe('idle'))

    await act(async () => {
      await result.current.download()
    })

    const args = vi.mocked(actions.getTabs).mock.calls.map(([id]) => id)
    expect(args).toEqual(['song-rep-1', 'song-rep-2'])
    for (const entry of ENTRIES) {
      expect(args).not.toContain(entry.repertoireId)
    }
  })

  // RH-83 ER10 — the personal row is captured in band context and only there.
  it('captures the member own repertoire row once per song, in band context', async () => {
    const actions = makeActions()
    const { result, ports } = setup({ actions })
    await waitFor(() => expect(result.current.status).toBe('idle'))

    await act(async () => {
      await result.current.download()
    })

    expect(vi.mocked(actions.getPersonalEntryForSong).mock.calls).toEqual([
      ['song-rep-1'],
      ['song-rep-2'],
    ])
    const songs = ports.records.rows.get('pl-1')?.snapshot.songs ?? []
    expect(songs.map((song) => song.personalRepertoire?.id)).toEqual([
      'personal-song-rep-1',
      'personal-song-rep-2',
    ])
  })

  it('never reads the personal row outside a band context', async () => {
    const actions = makeActions()
    const { result, ports } = setup({ actions, bandId: null })
    await waitFor(() => expect(result.current.status).toBe('idle'))

    await act(async () => {
      await result.current.download()
    })

    expect(actions.getPersonalEntryForSong).not.toHaveBeenCalled()
    const songs = ports.records.rows.get('pl-1')?.snapshot.songs ?? []
    expect(songs.map((song) => song.personalRepertoire)).toEqual([null, null])
  })

  it('reports downloaded on mount when the playlist is already stored', async () => {
    const ports = createFakePorts()
    const { result } = setup({}, ports)
    await act(async () => {
      await result.current.download()
    })
    cleanup()

    const second = renderHook(() =>
      useOfflinePlaylist({
        playlistId: 'pl-1',
        playlistName: 'Gig',
        bandId: 'band-1',
        actions: makeActions(),
        store: createOfflineStore(ports),
      }),
    )

    await waitFor(() => expect(second.result.current.status).toBe('downloaded'))
    expect(second.result.current.summary?.playlistName).toBe('Gig')
  })

  it('removes the offline copy and returns to idle', async () => {
    const { result, ports } = setup()
    await act(async () => {
      await result.current.download()
    })

    await act(async () => {
      await result.current.remove()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.summary).toBeNull()
    expect(ports.records.rows.size).toBe(0)
    expect(ports.blobs.keysFor('pl-1')).toEqual([])
  })

  it('skips an entry whose resolved read answers null rather than failing the download', async () => {
    const actions = makeActions()
    actions.getResolvedEntryForVersion = vi.fn((versionId: string) =>
      Promise.resolve(versionId === 'v-rep-2' ? null : resolvedEntry(versionId)),
    )
    const { result, ports } = setup({ actions })

    await act(async () => {
      await result.current.download()
    })

    expect(result.current.status).toBe('downloaded')
    expect(
      ports.records.rows.get('pl-1')?.snapshot.songs.map((song) => song.versionId),
    ).toEqual(['v-rep-1'])
  })
})

describe('useOfflinePlaylist — all-or-nothing (ER10)', () => {
  it('lands idle with an error, never downloaded, and leaves nothing behind in either port', async () => {
    // The real store over fake ports; the blob port runs out of quota on the
    // second `put`, i.e. halfway through a two-song playlist.
    const ports = createFakePorts({ failBlobPutOnCall: 2 })
    const { result, statuses } = setup({}, ports)
    await waitFor(() => expect(result.current.status).toBe('idle'))

    let finished: Promise<void> = Promise.resolve()
    act(() => {
      finished = result.current.download()
    })
    expect(result.current.status).toBe('downloading')
    await act(async () => {
      await finished
    })

    // Every status this hook ever published, across every render.
    expect(statuses).toContain('downloading')
    expect(statuses).not.toContain('downloaded')
    expect(result.current.status).toBe('idle')
    expect(result.current.summary).toBeNull()
    expect(result.current.error).toMatch(/not enough storage/i)

    // The rollback itself, observed through the hook: the REAL store unwound
    // the one PDF that did land, and no record was ever written.
    expect(ports.records.rows.size).toBe(0)
    expect(ports.blobs.keysFor('pl-1')).toEqual([])
  })

  it('never reports downloaded when the read actions themselves fail', async () => {
    const actions = makeActions()
    actions.getTabs = vi.fn().mockRejectedValue(new Error('network down'))
    const { result, ports } = setup({ actions })

    await act(async () => {
      await result.current.download()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.error).toBe('network down')
    expect(ports.records.rows.size).toBe(0)
  })

  it('reports a failed removal as an error rather than claiming the copy is gone', async () => {
    const ports = createFakePorts()
    const { result } = setup({}, ports)
    await act(async () => {
      await result.current.download()
    })
    ports.blobs.deleteByPrefix = () => Promise.reject('cache vanished')

    await act(async () => {
      await result.current.remove()
    })

    // A non-Error rejection still reads as a sentence, never as "[object Object]".
    expect(result.current.error).toBe('Failed to make this playlist available offline')
    expect(result.current.status).toBe('downloaded')
  })

  it('dismisses the error banner without touching what is stored', async () => {
    const actions = makeActions()
    actions.getTabs = vi.fn().mockRejectedValue(new Error('network down'))
    const { result } = setup({ actions })
    await act(async () => {
      await result.current.download()
    })

    act(() => result.current.dismissError())

    expect(result.current.error).toBeNull()
    expect(result.current.status).toBe('idle')
  })
})

/**
 * RH-132 ER7 — every entry of the playlist is captured.
 *
 * The download used to `continue` past an entry carrying no `repertoireId`,
 * which is what kept `OfflineSongSnapshot`'s key non-null. Fast View is
 * version-addressed now, so such an entry has an address and a readable page:
 * skipping it would leave the musician a downloaded setlist with holes in it.
 */
describe('the download captures every entry (RH-132 ER7)', () => {
  const GAPPED = [
    { repertoireId: 'rep-1', versionId: 'v-rep-1', songId: 'song-rep-1', title: 'Tempo Perdido', artist: 'Legião Urbana' },
    { repertoireId: null, versionId: 'v-rep-9', songId: 'song-rep-9', title: 'Spoonman', artist: 'Soundgarden' },
    { repertoireId: 'rep-2', versionId: 'v-rep-2', songId: 'song-rep-2', title: 'Faroeste Caboclo', artist: null },
  ]

  it('saves all three songs, one of them keyed by the entry with no owner row', async () => {
    const actions = makeActions()
    vi.mocked(actions.getPlaylistDetailsWithEntries).mockResolvedValue({ name: 'Gig', entries: GAPPED })
    // The middle entry resolves at version defaults: no owner row at all.
    vi.mocked(actions.getResolvedEntryForVersion).mockImplementation((versionId: string) =>
      Promise.resolve(
        versionId === 'v-rep-9'
          ? { ...resolvedEntry(versionId), ownerRowId: null, status: null, tags: [] }
          : resolvedEntry(versionId),
      ),
    )
    const { result, ports } = setup({ actions })
    await waitFor(() => expect(result.current.status).toBe('idle'))

    await act(async () => {
      await result.current.download()
    })

    const saved = ports.records.rows.get('pl-1')?.snapshot.songs
    expect(saved).toHaveLength(3)
    expect(saved?.map((song) => song.versionId)).toEqual(['v-rep-1', 'v-rep-9', 'v-rep-2'])
    const captured = saved?.find((song) => song.versionId === 'v-rep-9')
    expect(captured?.repertoire.ownerRowId).toBeNull()
    expect(captured?.entry.repertoireId).toBeNull()
    // Read by version, never by the owner row id the entry does not have.
    expect(vi.mocked(actions.getResolvedEntryForVersion).mock.calls.map(([id]) => id)).toEqual([
      'v-rep-1',
      'v-rep-9',
      'v-rep-2',
    ])
  })

  /**
   * The per-entry `try` / `continue` the two old `continue`s used to provide.
   *
   * The replacement read **throws** for a version that no longer exists
   * (`ownerSongs.ts`, "Song version not found"), so a version deleted between
   * the playlist read and the capture would abort the whole download instead of
   * dropping one song.
   */
  it('drops one unreadable entry rather than failing the whole download', async () => {
    const actions = makeActions()
    vi.mocked(actions.getPlaylistDetailsWithEntries).mockResolvedValue({ name: 'Gig', entries: GAPPED })
    vi.mocked(actions.getResolvedEntryForVersion).mockImplementation((versionId: string) =>
      versionId === 'v-rep-9'
        ? Promise.reject(new Error('Failed to resolve song version: Song version not found'))
        : Promise.resolve(resolvedEntry(versionId)),
    )
    const { result, ports } = setup({ actions })
    await waitFor(() => expect(result.current.status).toBe('idle'))

    await act(async () => {
      await result.current.download()
    })

    expect(result.current.status).toBe('downloaded')
    expect(result.current.error).toBeNull()
    const saved = ports.records.rows.get('pl-1')?.snapshot.songs
    expect(saved?.map((song) => song.versionId)).toEqual(['v-rep-1', 'v-rep-2'])
  })

  it('still skips an entry whose read answers null', async () => {
    const actions = makeActions()
    vi.mocked(actions.getPlaylistDetailsWithEntries).mockResolvedValue({ name: 'Gig', entries: GAPPED })
    vi.mocked(actions.getResolvedEntryForVersion).mockImplementation((versionId: string) =>
      Promise.resolve(versionId === 'v-rep-9' ? null : resolvedEntry(versionId)),
    )
    const { result, ports } = setup({ actions })
    await waitFor(() => expect(result.current.status).toBe('idle'))

    await act(async () => {
      await result.current.download()
    })

    expect(ports.records.rows.get('pl-1')?.snapshot.songs.map((song) => song.versionId)).toEqual([
      'v-rep-1',
      'v-rep-2',
    ])
  })
})
