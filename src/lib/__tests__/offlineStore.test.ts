/**
 * RH-79 — the storage boundary, exercised over in-memory ports.
 *
 * `createOfflineStore(ports)` is the real store; only `indexedDB`, Cache
 * Storage and `fetch` are replaced, by `./offlineStoreFakes`. No mocking
 * library appears here and none is needed: what is asserted after a failed
 * download is the *fakes' own contents*, so the rollback under test is the
 * store's real rollback.
 *
 * The write order is the mechanism, so it is what the failure tests probe: the
 * PDFs go in first and the IndexedDB record goes in last, which makes the
 * record the only thing that marks a playlist as downloaded.
 */
import { describe, it, expect } from 'vitest'
import { createOfflineStore, type SaveOfflinePlaylistInput } from '@/lib/offlineStore'
import { OFFLINE_SCHEMA_VERSION, type OfflineSnapshot } from '@/lib/offlineSnapshot'
import { createFakePorts, tabResponse, unusableResponse } from './offlineStoreFakes'
import type { Repertoire, ResolvedSongEntry, SongFile } from '@/types/database'

/** The captured `(owner, version)` pair — a `ResolvedSongEntry` since RH-132. */
function repertoire(id: string): ResolvedSongEntry {
  return {
    ownerRowId: id,
    song_id: `song-${id}`,
    version_id: 'version-1',
    key: null,
    tuning: null,
    map: null,
    status: 'learning',
    tags: [],
    last_practiced: null,
    lyrics: null,
  }
}

/** The member's own row, still a `Repertoire` (RH-132 ER14). */
function personalRow(id: string): Repertoire {
  return {
    id,
    user_id: 'user-1',
    band_id: null,
    song_id: `song-${id}`,
    version_id: 'version-1',
    key: null,
    tuning: null,
    map: null,
    status: 'learning',
    tags: [],
    last_practiced: null,
    lyrics: 'my cues',
  }
}

function tabRow(id: string, repertoireId: string): SongFile {
  return {
    id,
    user_id: 'user-1',
    song_id: `song-${repertoireId}`,
    title: `Chart ${id}`,
    file_url: `https://store.public.blob.vercel-storage.com/tabs/${id}.pdf`,
    created_at: '2026-05-01T00:00:00Z',
  }
}

function saveInput(playlistId: string, tabIds: string[]): SaveOfflinePlaylistInput {
  return {
    playlistId,
    playlistName: `Playlist ${playlistId}`,
    bandId: 'band-1',
    savedAt: '2026-09-20T18:04:00.000Z',
    songs: [
      {
        entry: { repertoireId: 'rep-1', versionId: 'v-rep-1', songId: 'song-rep-1', title: 'Tempo Perdido', artist: 'Legião Urbana' },
        repertoire: repertoire('rep-1'),
        personalRepertoire: personalRow('personal-1'),
        tabs: tabIds.map((tabId) => tabRow(tabId, 'rep-1')),
      },
    ],
  }
}

describe('saveOfflinePlaylist / readOfflineSnapshot / removeOfflinePlaylist', () => {
  it('writes a record keyed by playlistId carrying savedAt, bytes and schemaVersion', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)

    const record = await store.saveOfflinePlaylist(saveInput('pl-1', ['tab-a', 'tab-b']))

    expect(record.playlistId).toBe('pl-1')
    expect(record.playlistName).toBe('Playlist pl-1')
    expect(record.savedAt).toBe('2026-09-20T18:04:00.000Z')
    expect(record.schemaVersion).toBe(OFFLINE_SCHEMA_VERSION)
    // Two 1 KB PDFs plus the serialized snapshot.
    expect(record.bytes).toBeGreaterThan(2048)
    expect([...ports.records.rows.keys()]).toEqual(['pl-1'])
    expect(ports.records.rows.get('pl-1')?.schemaVersion).toBe(OFFLINE_SCHEMA_VERSION)
  })

  it('caches each PDF under its own synthetic, playlist-scoped key', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)

    await store.saveOfflinePlaylist(saveInput('pl-1', ['tab-a', 'tab-b']))

    expect(ports.blobs.keysFor('pl-1').sort()).toEqual([
      '/__offline-tab/pl-1/tab-a',
      '/__offline-tab/pl-1/tab-b',
    ])
    expect(await store.matchOfflineTab('pl-1', 'tab-a')).toBeDefined()
    expect(await store.matchOfflineTab('pl-1', 'missing')).toBeUndefined()
  })

  it('reads the snapshot back with its tabs, and lists what is stored', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await store.saveOfflinePlaylist(saveInput('pl-1', ['tab-a']))

    const snapshot = await store.readOfflineSnapshot('pl-1')
    const listed = await store.listOfflinePlaylists()

    expect(snapshot?.playlistName).toBe('Playlist pl-1')
    expect(snapshot?.songs[0].versionId).toBe('v-rep-1')
    expect(snapshot?.songs[0].repertoire.ownerRowId).toBe('rep-1')
    expect(snapshot?.songs[0].tabs[0].createdAt).toBe('2026-05-01T00:00:00Z')
    // RH-83 ER10: the member's own row travels with the song.
    expect(snapshot?.songs[0].personalRepertoire?.lyrics).toBe('my cues')
    expect(listed.map((row) => row.playlistId)).toEqual(['pl-1'])
    expect(listed[0].bytes).toBe(ports.records.rows.get('pl-1')?.bytes)
  })

  it('reads back as absent when nothing is stored, or when the schema moved on', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await store.saveOfflinePlaylist(saveInput('pl-1', []))

    expect(await store.readOfflineSnapshot('pl-unknown')).toBeNull()

    const stored = ports.records.rows.get('pl-1')
    if (stored) {
      stored.snapshot = { ...stored.snapshot, schemaVersion: OFFLINE_SCHEMA_VERSION + 1 }
    }
    expect(await store.readOfflineSnapshot('pl-1')).toBeNull()
  })

  // RH-83 ER11: a record that cannot be read is discarded rather than listed as
  // "Downloaded" while Fast View reports the playlist unavailable. A photograph
  // is cheap to retake; an indicator that might be wrong is not.
  //
  // RH-132 narrowed this to "cannot be read": a v5 record *can* be, so it is
  // upgraded instead (see the ER6c suite below). The stale record here is
  // tagged v3 — the last version whose reshape genuinely lost information —
  // on both the record and the snapshot, so no upgrade path applies.
  it('drops and purges a record whose schema version has no upgrade path', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await store.saveOfflinePlaylist(saveInput('pl-stale', ['tab-a']))
    await store.saveOfflinePlaylist(saveInput('pl-current', ['tab-b']))
    const stale = ports.records.rows.get('pl-stale')
    if (stale) {
      stale.schemaVersion = 3
      stale.snapshot = { ...stale.snapshot, schemaVersion: 3 }
    }

    const listed = await store.listOfflinePlaylists()

    expect(listed.map((row) => row.playlistId)).toEqual(['pl-current'])
    // Purged, not merely hidden: the record and its cached bytes are both gone.
    expect(ports.records.rows.has('pl-stale')).toBe(false)
    expect(ports.blobs.keysFor('pl-stale')).toEqual([])
    expect(ports.blobs.keysFor('pl-current')).toEqual(['/__offline-tab/pl-current/tab-b'])
  })

  it('removes one playlist without disturbing another', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await store.saveOfflinePlaylist(saveInput('pl-1', ['tab-a']))
    await store.saveOfflinePlaylist(saveInput('pl-2', ['tab-b']))

    await store.removeOfflinePlaylist('pl-1')

    expect(await store.readOfflineSnapshot('pl-1')).toBeNull()
    expect(ports.blobs.keysFor('pl-1')).toEqual([])
    expect((await store.listOfflinePlaylists()).map((row) => row.playlistId)).toEqual(['pl-2'])
    expect(ports.blobs.keysFor('pl-2')).toEqual(['/__offline-tab/pl-2/tab-b'])
  })
})

describe('the download refuses a response it cannot trust', () => {
  it('aborts on an opaque response and keeps nothing', async () => {
    const ports = createFakePorts({ respond: () => unusableResponse('opaque') })
    const store = createOfflineStore(ports)

    await expect(store.saveOfflinePlaylist(saveInput('pl-1', ['tab-a']))).rejects.toThrow(/opaque/i)

    expect(ports.records.rows.size).toBe(0)
    expect(ports.blobs.keysFor('pl-1')).toEqual([])
  })

  it('aborts on a non-ok response and keeps nothing', async () => {
    const ports = createFakePorts({ respond: () => unusableResponse('not-ok') })
    const store = createOfflineStore(ports)

    await expect(store.saveOfflinePlaylist(saveInput('pl-1', ['tab-a']))).rejects.toThrow(/404/)

    expect(ports.records.rows.size).toBe(0)
    expect(ports.blobs.keysFor('pl-1')).toEqual([])
  })
})

describe('all-or-nothing rollback', () => {
  it('leaves both stores empty when the blob port runs out of quota mid-download', async () => {
    const ports = createFakePorts({ failBlobPutOnCall: 2 })
    const store = createOfflineStore(ports)

    await expect(
      store.saveOfflinePlaylist(saveInput('pl-1', ['tab-a', 'tab-b', 'tab-c'])),
    ).rejects.toThrow(/quota/i)

    expect(await store.listOfflinePlaylists()).toEqual([])
    expect(ports.blobs.keysFor('pl-1')).toEqual([])
    expect(ports.blobs.putCalls).toBe(2)
  })

  it('discards the previous good copy when a refresh fails — "not downloaded" is then true', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await store.saveOfflinePlaylist(saveInput('pl-1', ['tab-a']))
    expect(ports.records.rows.size).toBe(1)

    ports.blobs.put = () => Promise.reject(new DOMException('quota', 'QuotaExceededError'))
    await expect(store.saveOfflinePlaylist(saveInput('pl-1', ['tab-a']))).rejects.toThrow(/quota/i)

    expect(await store.listOfflinePlaylists()).toEqual([])
    expect(ports.blobs.keysFor('pl-1')).toEqual([])
  })

  it('rolls back when the record port itself is the thing that fails', async () => {
    const ports = createFakePorts({ failRecordPutOnCall: 1 })
    const store = createOfflineStore(ports)

    await expect(store.saveOfflinePlaylist(saveInput('pl-1', ['tab-a']))).rejects.toThrow(/quota/i)

    expect(ports.records.rows.size).toBe(0)
    expect(ports.blobs.keysFor('pl-1')).toEqual([])
  })
})

describe('clearAllOfflineData', () => {
  it('empties both stores', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await store.saveOfflinePlaylist(saveInput('pl-1', ['tab-a']))
    await store.saveOfflinePlaylist(saveInput('pl-2', ['tab-b']))

    await store.clearAllOfflineData()

    expect(await store.listOfflinePlaylists()).toEqual([])
    expect(ports.blobs.entries.size).toBe(0)
  })

  it('resolves rather than throwing when a port fails, so a sign-out can always await it', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await store.saveOfflinePlaylist(saveInput('pl-1', ['tab-a']))
    ports.blobs.clear = () => Promise.reject(new Error('cache unavailable'))

    await expect(store.clearAllOfflineData()).resolves.toBeUndefined()
  })
})

describe('progress reporting', () => {
  it('reports one step per song, in order, against the song total', async () => {
    const ports = createFakePorts({ respond: () => tabResponse(512) })
    const store = createOfflineStore(ports)
    const steps: Array<[number, number]> = []
    const input = saveInput('pl-1', ['tab-a'])

    await store.saveOfflinePlaylist({
      ...input,
      songs: [...input.songs, { ...input.songs[0], entry: { ...input.songs[0].entry, repertoireId: 'rep-2' }, tabs: [] }],
      onProgress: (done, total) => steps.push([done, total]),
    })

    expect(steps).toEqual([
      [1, 2],
      [2, 2],
    ])
  })
})

/**
 * RH-132 ER6c — a v5 record is rewritten, not purged.
 *
 * The purge at `listOfflinePlaylists` existed because a superseded record was
 * always unreadable. A v5 record is not: it reshapes losslessly, and its cached
 * PDF bytes stay addressable because no `cacheKey` changes. Destroying it would
 * cost a musician a downloaded setlist recoverable only online.
 */
describe('a v5 record is upgraded in place (RH-132 ER6c)', () => {
  /** Rewrites a stored record into the v5 shape, in place, the way one is on disk. */
  function degradeToV5(record: { schemaVersion: number; snapshot: OfflineSnapshot }) {
    record.schemaVersion = 5
    record.snapshot = {
      ...record.snapshot,
      schemaVersion: 5,
      songs: record.snapshot.songs.map((row) => {
        const resolved = row.repertoire
        return {
          repertoireId: resolved.ownerRowId as string,
          entry: row.entry,
          repertoire: {
            id: resolved.ownerRowId as string,
            user_id: null,
            band_id: 'band-1',
            song_id: resolved.song_id,
            version_id: resolved.version_id,
            key: resolved.key,
            tuning: resolved.tuning,
            map: resolved.map,
            status: resolved.status ?? 'learning',
            tags: resolved.tags,
            last_practiced: resolved.last_practiced,
            lyrics: resolved.lyrics,
          },
          personalRepertoire: row.personalRepertoire,
          tabs: row.tabs,
        }
      }),
    } as unknown as OfflineSnapshot
  }

  it('still lists it as downloaded, keeping its record and its cached PDFs', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await store.saveOfflinePlaylist(saveInput('pl-v5', ['tab-a']))
    const stored = ports.records.rows.get('pl-v5')
    if (!stored) throw new Error('fixture record was not written')
    degradeToV5(stored)

    const listed = await store.listOfflinePlaylists()

    expect(listed.map((row) => row.playlistId)).toEqual(['pl-v5'])
    // Not purged: the record is still there and so are the cached bytes.
    expect(ports.records.rows.has('pl-v5')).toBe(true)
    expect(ports.blobs.keysFor('pl-v5')).toEqual(['/__offline-tab/pl-v5/tab-a'])
  })

  it('rewrites the record at the new schema version, so the walk happens once', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await store.saveOfflinePlaylist(saveInput('pl-v5', ['tab-a']))
    const stored = ports.records.rows.get('pl-v5')
    if (!stored) throw new Error('fixture record was not written')
    degradeToV5(stored)

    const listed = await store.listOfflinePlaylists()

    expect(listed[0].schemaVersion).toBe(OFFLINE_SCHEMA_VERSION)
    expect(ports.records.rows.get('pl-v5')?.schemaVersion).toBe(OFFLINE_SCHEMA_VERSION)
    expect(ports.records.rows.get('pl-v5')?.snapshot.schemaVersion).toBe(OFFLINE_SCHEMA_VERSION)
    expect(ports.records.rows.get('pl-v5')?.snapshot.songs[0].versionId).toBe('v-rep-1')
    expect(ports.records.rows.get('pl-v5')?.snapshot.songs[0].repertoire.ownerRowId).toBe('rep-1')
  })

  it('reads the snapshot back through readOfflineSnapshot before any rewrite', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await store.saveOfflinePlaylist(saveInput('pl-v5', ['tab-a']))
    const stored = ports.records.rows.get('pl-v5')
    if (!stored) throw new Error('fixture record was not written')
    degradeToV5(stored)

    const snapshot = await store.readOfflineSnapshot('pl-v5')

    expect(snapshot).not.toBeNull()
    expect(snapshot!.schemaVersion).toBe(OFFLINE_SCHEMA_VERSION)
    expect(snapshot!.songs[0].tabs[0].cacheKey).toBe('/__offline-tab/pl-v5/tab-a')
  })

  it('still purges a record whose snapshot cannot be made valid', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await store.saveOfflinePlaylist(saveInput('pl-broken', ['tab-a']))
    await store.saveOfflinePlaylist(saveInput('pl-current', ['tab-b']))
    const broken = ports.records.rows.get('pl-broken')
    if (broken) {
      broken.schemaVersion = 2
      broken.snapshot = { ...broken.snapshot, schemaVersion: 2 }
    }

    const listed = await store.listOfflinePlaylists()

    expect(listed.map((row) => row.playlistId)).toEqual(['pl-current'])
    expect(ports.records.rows.has('pl-broken')).toBe(false)
    expect(ports.blobs.keysFor('pl-broken')).toEqual([])
  })
})
