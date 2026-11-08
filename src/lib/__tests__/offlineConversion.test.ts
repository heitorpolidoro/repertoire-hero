/**
 * RH-192 — pre-RH-192 offline copies convert to song records and ordered
 * setlist lists with **no network access**.
 *
 * Every store here runs over a `fetch` that throws if anything calls it, so a
 * conversion that reached for the network would fail the test outright. The
 * legacy records are written straight into the fake ports, exactly as RH-79
 * (playlist) and RH-116 (`song:`) left them on disk, bytes included.
 */
import { describe, it, expect } from 'vitest'
import { applyOfflineConversion, planOfflineConversion } from '@/lib/offlineConversion'
import { offlineFirst } from '@/lib/offlineFirst'
import { createOfflineStore } from '@/lib/offlineStore'
import { buildOfflineSnapshot, type OfflineSnapshot } from '@/lib/offlineSnapshot'
import { isSetlistRecord, isSongRecord, type OfflineSnapshotRecord } from '@/lib/offlineRecords'
import { songRecordId } from '@/lib/offlineSongRecord'
import { createFakePorts, throwingFetch, type FakeOfflinePorts } from './offlineStoreFakes'
import type { ResolvedSongEntry, SongFile } from '@/types/database'

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
    lyrics: `lyrics of ${versionId}`,
  }
}

function tab(id: string, versionId: string): SongFile {
  return {
    id,
    user_id: 'user-1',
    song_id: `song-${versionId}`,
    title: `Chart ${id}`,
    file_url: `https://blob.example/${id}.pdf`,
    created_at: '2026-05-01T00:00:00Z',
  }
}

interface LegacySong {
  versionId: string
  tabIds?: string[]
}

/** A pre-RH-192 snapshot as RH-79 / RH-116 built it. */
function legacySnapshot(recordId: string, bandId: string | null, savedAt: string, songs: LegacySong[]): OfflineSnapshot {
  return buildOfflineSnapshot({
    playlistId: recordId,
    playlistName: `Name ${recordId}`,
    bandId,
    savedAt,
    songs: songs.map(({ versionId, tabIds = [] }) => ({
      entry: { repertoireId: `row-${versionId}`, versionId, songId: `song-${versionId}`, title: `Song ${versionId}`, artist: 'Artist' },
      repertoire: resolved(versionId),
      personalRepertoire: null,
      tabs: tabIds.map((id) => ({ tab: tab(id, versionId), bytes: 3 })),
      customFields: [],
    })),
  })
}

/** Writes the legacy record and its cached bytes into the fake ports. */
async function seedLegacy(ports: FakeOfflinePorts, snapshot: OfflineSnapshot): Promise<void> {
  const record: OfflineSnapshotRecord = {
    playlistId: snapshot.playlistId,
    playlistName: snapshot.playlistName,
    savedAt: snapshot.savedAt,
    bytes: 100,
    schemaVersion: snapshot.schemaVersion,
    snapshot,
  }
  ports.records.rows.set(record.playlistId, record)
  for (const song of snapshot.songs) {
    for (const file of song.tabs) await ports.blobs.put(file.cacheKey, new Response(`pdf ${file.id}`))
  }
}

/** Fake ports whose `fetch` throws: nothing below may reach the network. */
function offlineOnlyPorts(): FakeOfflinePorts {
  return { ...createFakePorts(), fetch: throwingFetch }
}

const SONG_ID = songRecordId('v-solo', null)

describe('converting stored v6 records without the network', () => {
  it('converts a stored v6 setlist and song: record with a throwing fetch, leaving one record per song whose files still answer offline', async () => {
    const ports = offlineOnlyPorts()
    await seedLegacy(ports, legacySnapshot('pl-1', null, '2026-09-01T00:00:00.000Z', [
      { versionId: 'v-1', tabIds: ['tab-1'] },
      { versionId: 'v-2' },
    ]))
    await seedLegacy(ports, legacySnapshot(SONG_ID, null, '2026-09-02T00:00:00.000Z', [
      { versionId: 'v-solo', tabIds: ['tab-solo'] },
    ]))
    const store = createOfflineStore(ports)

    const listed = await store.listOfflinePlaylists()

    expect(listed.map((row) => row.playlistId)).toEqual(['pl-1', SONG_ID])
    const rows = [...ports.records.rows.values()]
    // One record per song, and the setlist reduced to its ordered list.
    expect(rows.filter(isSongRecord).map((row) => row.playlistId).sort()).toEqual(
      [songRecordId('v-1', null), songRecordId('v-2', null), SONG_ID].sort(),
    )
    const setlist = rows.find(isSetlistRecord)
    expect(setlist?.entries.map((entry) => entry.versionId)).toEqual(['v-1', 'v-2'])
    expect(rows.some((row) => 'snapshot' in row)).toBe(false)
    // A `song:` record was downloaded individually; a setlist song was not.
    const solo = ports.records.rows.get(SONG_ID)
    expect(solo && isSongRecord(solo) ? solo.individualDownload : null).toBe(true)
    const fromSetlist = ports.records.rows.get(songRecordId('v-1', null))
    expect(fromSetlist && isSongRecord(fromSetlist) ? fromSetlist.individualDownload : null).toBe(false)

    // The files still answer offline, from the bytes already on the device.
    const wrapped = offlineFirst(
      { getTabs: () => Promise.reject(new Error('unreachable')) },
      { store, isOffline: () => true },
    )
    const files = await wrapped.getTabs('song-v-1')
    expect(files.map((file) => file.file_url)).toEqual(['/__offline-tab/pl-1/tab-1'])
    expect(await (await ports.blobs.match(files[0].file_url))?.text()).toBe('pdf tab-1')
    const soloFiles = await wrapped.getTabs('song-v-solo')
    expect(await (await ports.blobs.match(soloFiles[0].file_url))?.text()).toBe('pdf tab-solo')
    expect(ports.fetched).toEqual([])
  })

  it('upgrades a v5 record before converting it', async () => {
    const ports = offlineOnlyPorts()
    const v6 = legacySnapshot('pl-v5', 'band-1', '2026-09-01T00:00:00.000Z', [{ versionId: 'v-1', tabIds: ['tab-1'] }])
    const v5 = {
      ...v6,
      schemaVersion: 5,
      songs: v6.songs.map((song) => ({
        repertoireId: song.repertoire.ownerRowId,
        entry: song.entry,
        repertoire: { ...song.repertoire, id: song.repertoire.ownerRowId, user_id: null, band_id: 'band-1' },
        personalRepertoire: null,
        tabs: song.tabs,
      })),
    } as unknown as OfflineSnapshot
    await seedLegacy(ports, v5)
    const store = createOfflineStore(ports)

    const songs = await store.listOfflineSongs()

    expect(songs.map((song) => song.playlistId)).toEqual([songRecordId('v-1', 'band-1')])
    expect(songs[0].repertoire.ownerRowId).toBe('row-v-1')
    expect(songs[0].tabs[0].cacheKey).toBe('/__offline-tab/pl-v5/tab-1')
  })

  it('purges a record no upgrade can read, with its bytes', async () => {
    const ports = offlineOnlyPorts()
    const stale = legacySnapshot('pl-v3', null, '2026-09-01T00:00:00.000Z', [{ versionId: 'v-1', tabIds: ['tab-1'] }])
    await seedLegacy(ports, { ...stale, schemaVersion: 3 })
    const store = createOfflineStore(ports)

    expect(await store.listOfflinePlaylists()).toEqual([])
    expect(ports.records.rows.size).toBe(0)
    expect(ports.blobs.entries.size).toBe(0)
  })
})

describe('the same song in several legacy records', () => {
  it('keeps the newest copy, keeps individualDownload if any copy had it, and deletes bytes only losing copies used', async () => {
    const ports = offlineOnlyPorts()
    await seedLegacy(ports, legacySnapshot('pl-old', null, '2026-09-01T00:00:00.000Z', [{ versionId: 'v-1', tabIds: ['tab-1'] }]))
    await seedLegacy(ports, legacySnapshot('pl-new', null, '2026-09-10T00:00:00.000Z', [{ versionId: 'v-1', tabIds: ['tab-1'] }]))
    await seedLegacy(ports, legacySnapshot(songRecordId('v-1', null), null, '2026-09-05T00:00:00.000Z', [{ versionId: 'v-1', tabIds: ['tab-1'] }]))
    const store = createOfflineStore(ports)

    const songs = await store.listOfflineSongs()

    expect(songs).toHaveLength(1)
    expect(songs[0].savedAt).toBe('2026-09-10T00:00:00.000Z')
    expect(songs[0].individualDownload).toBe(true)
    expect(songs[0].tabs[0].cacheKey).toBe('/__offline-tab/pl-new/tab-1')
    expect([...ports.blobs.entries.keys()]).toEqual(['/__offline-tab/pl-new/tab-1'])
    // Both lists survive, each holding the one shared song.
    expect((await store.listOfflineSetlists()).map((setlist) => setlist.playlistId).sort()).toEqual(['pl-new', 'pl-old'])
  })

  it('keeps an already converted song on a tie', () => {
    const snapshot = legacySnapshot('pl-1', null, '2026-09-01T00:00:00.000Z', [{ versionId: 'v-1', tabIds: ['tab-1'] }])
    const first = planOfflineConversion([
      { playlistId: 'pl-1', playlistName: 'x', savedAt: snapshot.savedAt, bytes: 1, schemaVersion: 6, snapshot },
    ])
    const converted = first.writes.filter(isSongRecord)

    const again = planOfflineConversion([
      ...converted,
      { playlistId: 'pl-1', playlistName: 'x', savedAt: snapshot.savedAt, bytes: 1, schemaVersion: 6, snapshot },
    ])

    expect(again.songs).toHaveLength(1)
    expect(again.staleKeys).toEqual([])
  })
})

describe('a conversion that fails', () => {
  it('leaves the legacy record readable, and converts it on the next listing', async () => {
    const ports = offlineOnlyPorts()
    await seedLegacy(ports, legacySnapshot('pl-1', null, '2026-09-01T00:00:00.000Z', [{ versionId: 'v-1', tabIds: ['tab-1'] }]))
    const put = ports.records.put
    ports.records.put = () => Promise.reject(new DOMException('quota', 'QuotaExceededError'))
    const store = createOfflineStore(ports)

    const songs = await store.listOfflineSongs()

    // Still readable, straight from the legacy record.
    expect(songs.map((song) => song.versionId)).toEqual(['v-1'])
    expect(ports.records.rows.get('pl-1')).toHaveProperty('snapshot')
    expect(ports.blobs.entries.has('/__offline-tab/pl-1/tab-1')).toBe(true)

    ports.records.put = put
    await store.listOfflinePlaylists()

    expect(ports.records.rows.get('pl-1')).not.toHaveProperty('snapshot')
    expect(ports.records.rows.has(songRecordId('v-1', null))).toBe(true)
  })

  it('converges on the same records when re-run after an interruption', async () => {
    const ports = offlineOnlyPorts()
    await seedLegacy(ports, legacySnapshot('pl-1', null, '2026-09-01T00:00:00.000Z', [
      { versionId: 'v-1', tabIds: ['tab-1'] },
      { versionId: 'v-2', tabIds: ['tab-2'] },
    ]))
    const plan = planOfflineConversion([...ports.records.rows.values()])
    // Interrupted after the first song record was written.
    await ports.records.put(plan.writes[0])

    await applyOfflineConversion(ports, planOfflineConversion([...ports.records.rows.values()]))

    const rows = [...ports.records.rows.values()]
    expect(rows.filter(isSongRecord)).toHaveLength(2)
    expect(rows.filter(isSetlistRecord)).toHaveLength(1)
    expect(ports.blobs.entries.size).toBe(2)
  })
})
