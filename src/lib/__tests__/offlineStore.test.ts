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
import { OFFLINE_SCHEMA_VERSION } from '@/lib/offlineSnapshot'
import { createFakePorts, tabResponse, unusableResponse } from './offlineStoreFakes'
import type { Repertoire, RepertoireTab } from '@/types/database'

function repertoire(id: string): Repertoire {
  return {
    id,
    user_id: null,
    band_id: 'band-1',
    song_id: `song-${id}`,
    personal_key: null,
    status: 'learning',
    tags: [],
    last_practiced: null,
    lyrics: null,
  }
}

function tabRow(id: string, repertoireId: string): RepertoireTab {
  return {
    id,
    repertoire_id: repertoireId,
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
        entry: { repertoireId: 'rep-1', songId: 'song-rep-1', title: 'Tempo Perdido', artist: 'Legião Urbana' },
        repertoire: repertoire('rep-1'),
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
    expect(snapshot?.songs[0].repertoireId).toBe('rep-1')
    expect(snapshot?.songs[0].tabs[0].createdAt).toBe('2026-05-01T00:00:00Z')
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
