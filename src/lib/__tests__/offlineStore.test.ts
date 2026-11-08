/**
 * RH-79 / RH-192 — the storage boundary, exercised over in-memory ports.
 *
 * `createOfflineStore(ports)` is the real store; only `indexedDB`, Cache
 * Storage and `fetch` are replaced, by `./offlineStoreFakes`. What is asserted
 * is the *fakes' own contents*, so every rollback and every deletion under test
 * is the store's real one.
 *
 * Since RH-192 a song is stored once per `(versionId, owner context)` and a
 * setlist as its ordered list only.
 */
import { describe, it, expect } from 'vitest'
import { createOfflineStore, type OfflineSongInput } from '@/lib/offlineStore'
import { OFFLINE_SCHEMA_VERSION, type OfflineSetlistList } from '@/lib/offlineSnapshot'
import { isSetlistRecord, isSongRecord } from '@/lib/offlineRecords'
import { songRecordId } from '@/lib/offlineSongRecord'
import { createFakePorts, unusableResponse, type FakeOfflinePorts } from './offlineStoreFakes'
import type { Repertoire, ResolvedSongEntry, SongFile } from '@/types/database'

const SAVED_AT = '2026-09-20T18:04:00.000Z'

function resolved(versionId: string): ResolvedSongEntry {
  return {
    ownerRowId: `row-${versionId}`,
    song_id: `song-${versionId}`,
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

function personalRow(versionId: string): Repertoire {
  return {
    id: `personal-${versionId}`,
    user_id: 'user-1',
    band_id: null,
    song_id: `song-${versionId}`,
    version_id: versionId,
    key: null,
    tuning: null,
    map: null,
    status: 'learning',
    tags: [],
    last_practiced: null,
    lyrics: 'my cues',
  }
}

function tabRow(id: string, versionId: string): SongFile {
  return {
    id,
    user_id: 'user-1',
    song_id: `song-${versionId}`,
    title: `Chart ${id}`,
    file_url: `https://store.public.blob.vercel-storage.com/tabs/${id}.pdf`,
    created_at: '2026-05-01T00:00:00Z',
  }
}

/** One song's capture, with one chart per tab id. */
function songInput(versionId: string, tabIds: string[] = [`tab-${versionId}`]): OfflineSongInput {
  return {
    entry: { repertoireId: `row-${versionId}`, versionId, songId: `song-${versionId}`, title: `Song ${versionId}`, artist: 'Artist' },
    repertoire: resolved(versionId),
    personalRepertoire: personalRow(versionId),
    tabs: tabIds.map((id) => tabRow(id, versionId)),
    customFields: [],
  }
}

function list(playlistId: string, versionIds: string[], bandId: string | null = null): OfflineSetlistList {
  return {
    playlistId,
    playlistName: `Playlist ${playlistId}`,
    bandId,
    savedAt: SAVED_AT,
    entries: versionIds.map((versionId) => ({ versionId, title: `Song ${versionId}`, artist: 'Artist' })),
  }
}

function songIds(ports: FakeOfflinePorts): string[] {
  return [...ports.records.rows.values()].filter(isSongRecord).map((row) => row.playlistId).sort()
}

function setlistIds(ports: FakeOfflinePorts): string[] {
  return [...ports.records.rows.values()].filter(isSetlistRecord).map((row) => row.playlistId).sort()
}

/** Downloads a setlist the way the hook does: each song, then the list. */
async function downloadSetlist(
  store: ReturnType<typeof createOfflineStore>,
  playlistId: string,
  versionIds: string[],
  bandId: string | null = null,
) {
  for (const versionId of versionIds) {
    await store.saveOfflineSong({ song: songInput(versionId), bandId, savedAt: SAVED_AT })
  }
  await store.saveOfflineSetlist(list(playlistId, versionIds, bandId))
}

describe('saveOfflineSong — one record per version and owner context (RH-192)', () => {
  it('two setlists sharing a song store exactly one song record with one set of cached bytes', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)

    await downloadSetlist(store, 'pl-1', ['v-shared', 'v-a'])
    await downloadSetlist(store, 'pl-2', ['v-shared', 'v-b'])

    expect(songIds(ports)).toEqual([songRecordId('v-a', null), songRecordId('v-b', null), songRecordId('v-shared', null)])
    expect(setlistIds(ports)).toEqual(['pl-1', 'pl-2'])
    // One set of bytes for the shared song, under its own record id.
    expect(ports.blobs.keysFor(songRecordId('v-shared', null))).toEqual([
      `/__offline-tab/${songRecordId('v-shared', null)}/tab-v-shared`,
    ])
    expect(ports.blobs.entries.size).toBe(3)
    // A setlist record carries its list only — no song body, no file.
    const stored = ports.records.rows.get('pl-1')
    expect(stored && isSetlistRecord(stored) ? stored.entries.map((entry) => entry.versionId) : null).toEqual(['v-shared', 'v-a'])
    expect(stored).not.toHaveProperty('snapshot')
    expect(stored).not.toHaveProperty('songs')
  })

  it('a version downloaded in personal and band context stores one song record with one set of cached bytes per context', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)

    await store.saveOfflineSong({ song: songInput('v-1'), bandId: null, savedAt: SAVED_AT })
    await store.saveOfflineSong({ song: songInput('v-1'), bandId: 'band-1', savedAt: SAVED_AT })
    // Downloading the same pair again replaces it rather than adding a third.
    await store.saveOfflineSong({ song: songInput('v-1'), bandId: 'band-1', savedAt: SAVED_AT })

    expect(songIds(ports)).toEqual([songRecordId('v-1', null), songRecordId('v-1', 'band-1')].sort())
    expect(ports.blobs.keysFor(songRecordId('v-1', null))).toHaveLength(1)
    expect(ports.blobs.keysFor(songRecordId('v-1', 'band-1'))).toHaveLength(1)
    expect(ports.blobs.entries.size).toBe(2)
  })

  it('stores everything readable about the song, at the current schema', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)

    const record = await store.saveOfflineSong({ song: songInput('v-1', ['tab-a', 'tab-b']), bandId: 'band-1', savedAt: SAVED_AT })

    expect(record.playlistId).toBe(songRecordId('v-1', 'band-1'))
    expect(record.schemaVersion).toBe(OFFLINE_SCHEMA_VERSION)
    expect(record.versionId).toBe('v-1')
    expect(record.bandId).toBe('band-1')
    expect(record.personalRepertoire?.lyrics).toBe('my cues')
    expect(record.tabs.map((tab) => tab.cacheKey)).toEqual([
      `/__offline-tab/${songRecordId('v-1', 'band-1')}/tab-a`,
      `/__offline-tab/${songRecordId('v-1', 'band-1')}/tab-b`,
    ])
    // Two 1 KB charts plus the serialized song.
    expect(record.bytes).toBeGreaterThan(2048)
    expect(record.individualDownload).toBe(false)
  })

  it('keeps individualDownload true across a later setlist download of the same song', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)

    await store.saveOfflineSong({ song: songInput('v-1'), bandId: null, savedAt: SAVED_AT, individualDownload: true })
    const again = await store.saveOfflineSong({ song: songInput('v-1'), bandId: null, savedAt: SAVED_AT })

    expect(again.individualDownload).toBe(true)
  })

  it('deletes a refreshed song’s files that are gone from its latest version', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    const id = songRecordId('v-1', null)

    await store.saveOfflineSong({ song: songInput('v-1', ['tab-a', 'tab-b']), bandId: null, savedAt: SAVED_AT })
    await store.saveOfflineSong({ song: songInput('v-1', ['tab-b']), bandId: null, savedAt: SAVED_AT })

    expect(ports.blobs.keysFor(id)).toEqual([`/__offline-tab/${id}/tab-b`])
  })
})

describe('saveOfflineSong — a failure unwinds only that attempt', () => {
  it('refuses an opaque response and keeps nothing of that song', async () => {
    const ports = createFakePorts({ respond: () => unusableResponse('opaque') })
    const store = createOfflineStore(ports)

    await expect(store.saveOfflineSong({ song: songInput('v-1'), bandId: null, savedAt: SAVED_AT })).rejects.toThrow(/opaque/i)

    expect(ports.records.rows.size).toBe(0)
    expect(ports.blobs.entries.size).toBe(0)
  })

  it('refuses a non-ok response and keeps nothing of that song', async () => {
    const ports = createFakePorts({ respond: () => unusableResponse('not-ok') })
    const store = createOfflineStore(ports)

    await expect(store.saveOfflineSong({ song: songInput('v-1'), bandId: null, savedAt: SAVED_AT })).rejects.toThrow(/404/)

    expect(ports.records.rows.size).toBe(0)
  })

  it('removes the bytes it cached when the quota runs out mid-song', async () => {
    const ports = createFakePorts({ failBlobPutOnCall: 2 })
    const store = createOfflineStore(ports)

    await expect(
      store.saveOfflineSong({ song: songInput('v-1', ['tab-a', 'tab-b', 'tab-c']), bandId: null, savedAt: SAVED_AT }),
    ).rejects.toThrow(/quota/i)

    expect(ports.records.rows.size).toBe(0)
    expect(ports.blobs.entries.size).toBe(0)
  })

  it('keeps every other stored song when one fails', async () => {
    const ports = createFakePorts({ failRecordPutOnCall: 2 })
    const store = createOfflineStore(ports)

    await store.saveOfflineSong({ song: songInput('v-1'), bandId: null, savedAt: SAVED_AT })
    await expect(store.saveOfflineSong({ song: songInput('v-2'), bandId: null, savedAt: SAVED_AT })).rejects.toThrow(/quota/i)

    expect(songIds(ports)).toEqual([songRecordId('v-1', null)])
    expect(ports.blobs.keysFor(songRecordId('v-1', null))).toHaveLength(1)
    expect(ports.blobs.keysFor(songRecordId('v-2', null))).toEqual([])
  })

  it('keeps a stored copy and its bytes when its refresh fails', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    const id = songRecordId('v-1', null)
    await store.saveOfflineSong({ song: songInput('v-1', ['tab-a']), bandId: null, savedAt: SAVED_AT })

    ports.records.put = () => Promise.reject(new DOMException('quota', 'QuotaExceededError'))
    await expect(
      store.saveOfflineSong({ song: songInput('v-1', ['tab-a', 'tab-new']), bandId: null, savedAt: SAVED_AT }),
    ).rejects.toThrow(/quota/i)

    expect(songIds(ports)).toEqual([id])
    expect(ports.blobs.keysFor(id)).toEqual([`/__offline-tab/${id}/tab-a`])
  })
})

describe('removeOfflineSong (RH-192)', () => {
  it('removing one stored song leaves every other song and every setlist list stored', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await downloadSetlist(store, 'pl-1', ['v-1', 'v-2'])
    await downloadSetlist(store, 'pl-2', ['v-1', 'v-3'])

    await store.removeOfflineSong('v-1', null)

    expect(songIds(ports)).toEqual([songRecordId('v-2', null), songRecordId('v-3', null)])
    expect(ports.blobs.keysFor(songRecordId('v-1', null))).toEqual([])
    expect(ports.blobs.keysFor(songRecordId('v-2', null))).toHaveLength(1)
    expect(ports.blobs.keysFor(songRecordId('v-3', null))).toHaveLength(1)
    // Both lists stay whole: the removed song now counts as missing in each.
    expect(setlistIds(ports)).toEqual(['pl-1', 'pl-2'])
    const first = ports.records.rows.get('pl-1')
    expect(first && isSetlistRecord(first) ? first.entries.map((entry) => entry.versionId) : null).toEqual(['v-1', 'v-2'])
  })

  it('removes only the copy in the given owner context', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await store.saveOfflineSong({ song: songInput('v-1'), bandId: null, savedAt: SAVED_AT })
    await store.saveOfflineSong({ song: songInput('v-1'), bandId: 'band-1', savedAt: SAVED_AT })

    await store.removeOfflineSong('v-1', 'band-1')

    expect(songIds(ports)).toEqual([songRecordId('v-1', null)])
  })

  it('is also reachable through removeOfflinePlaylist with the song record id', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await store.saveOfflineSong({ song: songInput('v-1'), bandId: null, savedAt: SAVED_AT, individualDownload: true })

    await store.removeOfflinePlaylist(songRecordId('v-1', null))

    expect(ports.records.rows.size).toBe(0)
    expect(ports.blobs.entries.size).toBe(0)
  })
})

describe('removeOfflinePlaylist — the protection rule (RH-192)', () => {
  it('removing a downloaded setlist deletes only the songs not held by another downloaded setlist and not downloaded individually', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await downloadSetlist(store, 'pl-1', ['v-only', 'v-shared', 'v-mine'])
    await downloadSetlist(store, 'pl-2', ['v-shared'])
    await store.saveOfflineSong({ song: songInput('v-mine'), bandId: null, savedAt: SAVED_AT, individualDownload: true })

    await store.removeOfflinePlaylist('pl-1')

    expect(setlistIds(ports)).toEqual(['pl-2'])
    expect(songIds(ports)).toEqual([songRecordId('v-mine', null), songRecordId('v-shared', null)])
    expect(ports.blobs.keysFor(songRecordId('v-only', null))).toEqual([])
    expect(ports.blobs.keysFor(songRecordId('v-shared', null))).toHaveLength(1)
    expect(ports.blobs.keysFor(songRecordId('v-mine', null))).toHaveLength(1)
  })

  it('does not count a setlist of another owner context as holding the song', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await downloadSetlist(store, 'pl-personal', ['v-1'], null)
    await downloadSetlist(store, 'pl-band', ['v-1'], 'band-1')

    await store.removeOfflinePlaylist('pl-personal')

    expect(songIds(ports)).toEqual([songRecordId('v-1', 'band-1')])
  })

  it('a refresh that drops a song deletes it unless it is protected', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await downloadSetlist(store, 'pl-1', ['v-1', 'v-2', 'v-3'])
    await downloadSetlist(store, 'pl-2', ['v-2'])
    await store.saveOfflineSong({ song: songInput('v-3'), bandId: null, savedAt: SAVED_AT, individualDownload: true })

    await store.saveOfflineSetlist(list('pl-1', []))

    expect(songIds(ports)).toEqual([songRecordId('v-2', null), songRecordId('v-3', null)])
  })

  it('removes nothing for a playlist that is not stored', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await downloadSetlist(store, 'pl-1', ['v-1'])

    await store.removeOfflinePlaylist('pl-unknown')

    expect(songIds(ports)).toEqual([songRecordId('v-1', null)])
  })

  it('never deletes bytes another stored song still points at', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    // Two versions of one composition sharing a chart, under two stored songs.
    const shared = '/__offline-tab/legacy/tab-shared'
    await downloadSetlist(store, 'pl-1', ['v-1', 'v-2'])
    for (const id of [songRecordId('v-1', null), songRecordId('v-2', null)]) {
      const row = ports.records.rows.get(id)
      if (row && isSongRecord(row)) row.tabs = [{ ...row.tabs[0], cacheKey: shared }]
    }
    await ports.blobs.put(shared, new Response('pdf'))

    await store.removeOfflineSong('v-1', null)

    expect(ports.blobs.entries.has(shared)).toBe(true)
  })
})

describe('listing', () => {
  it('lists setlists and individually downloaded songs, with each setlist counting its stored songs', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await downloadSetlist(store, 'pl-1', ['v-1', 'v-2'])
    await store.saveOfflineSong({ song: songInput('v-9'), bandId: null, savedAt: SAVED_AT, individualDownload: true })

    const rows = await store.listOfflinePlaylists()

    expect(rows.map((row) => row.playlistId)).toEqual(['pl-1', songRecordId('v-9', null)])
    expect(rows[0].playlistName).toBe('Playlist pl-1')
    expect(rows[0].bytes).toBeGreaterThan(2048)
    expect(rows[1].playlistName).toBe('Song v-9')
    expect((await store.listOfflineSongs()).map((song) => song.versionId).sort()).toEqual(['v-1', 'v-2', 'v-9'])
    expect((await store.listOfflineSetlists()).map((setlist) => setlist.playlistId)).toEqual(['pl-1'])
  })
})

describe('clearAllOfflineData', () => {
  it('empties both stores', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await downloadSetlist(store, 'pl-1', ['v-1'])
    await store.saveOfflineSong({ song: songInput('v-2'), bandId: null, savedAt: SAVED_AT, individualDownload: true })

    await store.clearAllOfflineData()

    expect(await store.listOfflinePlaylists()).toEqual([])
    expect(ports.records.rows.size).toBe(0)
    expect(ports.blobs.entries.size).toBe(0)
  })

  it('resolves rather than throwing when a port fails, so a sign-out can always await it', async () => {
    const ports = createFakePorts()
    const store = createOfflineStore(ports)
    await downloadSetlist(store, 'pl-1', ['v-1'])
    ports.blobs.clear = () => Promise.reject(new Error('cache unavailable'))

    await expect(store.clearAllOfflineData()).resolves.toBeUndefined()
  })
})
