/**
 * The conversion of pre-RH-192 offline copies into song records and ordered
 * setlist lists — with **no network access** (RH-192).
 *
 * A device may still hold RH-79 playlist snapshots and RH-116 single-song
 * snapshots, each a whole photograph carrying its songs' bodies and pointing at
 * its own cached PDF bytes. Converting one is a pure reshape of what is already
 * on the device: the song bodies become song records, a playlist becomes its
 * ordered list, and **no byte is copied or refetched** — every converted song
 * keeps the `cacheKey`s its legacy record wrote, so its files still answer
 * offline. `applyOfflineConversion` takes the record and blob ports only, never
 * `fetch`, so it cannot reach the network even by mistake.
 *
 * `planOfflineConversion` is total and deterministic over the stored records:
 *
 *   - a v5 record is upgraded first (`readValidSnapshot` runs
 *     `upgradeSnapshotV5ToV6`); a record no upgrade can read is purged, as
 *     `listOfflinePlaylists` did before (RH-83 ER11);
 *   - a `song:` record converts with `individualDownload: true`, a song that
 *     only a setlist held with `false`;
 *   - the same song in several records keeps the newest `savedAt` (ties keep the
 *     copy met first, already-converted records first), `individualDownload` is
 *     true if any copy had it, and bytes only the losing copies pointed at are
 *     deleted.
 *
 * It is also the **read view**: the store answers from the plan's `songs` and
 * `setlists` whether or not applying it succeeded, so a record whose conversion
 * failed stays readable in its legacy form and is simply converted again on the
 * next listing. Every write overwrites by record id, so a retry after an
 * interruption converges on the same records instead of duplicating them.
 */

import {
  OFFLINE_SCHEMA_VERSION,
  readValidSnapshot,
  type OfflineSnapshot,
  type OfflineSongSnapshot,
} from '@/lib/offlineSnapshot'
import {
  isSetlistRecord,
  isSongRecord,
  legacyTabKeyPrefix,
  setlistListBytes,
  songCacheKeys,
  storedSongBytes,
  type OfflineSetlistRecord,
  type OfflineSnapshotRecord,
  type OfflineSongRecord,
  type OfflineStoredRecord,
  type OfflineStorePorts,
} from '@/lib/offlineRecords'
import { isSongRecordId, songRecordId } from '@/lib/offlineSongRecord'

/** What the store reads from: one record per song, and every setlist list. */
export interface OfflineLibraryView {
  songs: OfflineSongRecord[]
  setlists: OfflineSetlistRecord[]
}

export interface OfflineConversionPlan extends OfflineLibraryView {
  /** Song and setlist records to write, each replacing legacy data by id. */
  writes: Array<OfflineSongRecord | OfflineSetlistRecord>
  /** Legacy record ids no write overwrites, deleted once the writes landed. */
  retired: string[]
  /** Cache keys only a losing copy pointed at. */
  staleKeys: string[]
  /** Legacy records no upgrade can read: dropped with their bytes. */
  purged: string[]
}

interface Candidate {
  record: OfflineSongRecord
  fromLegacy: boolean
}

function toSongRecord(
  song: OfflineSongSnapshot,
  snapshot: OfflineSnapshot,
  individualDownload: boolean,
): OfflineSongRecord {
  return {
    ...song,
    kind: 'song',
    playlistId: songRecordId(song.versionId, snapshot.bandId),
    schemaVersion: OFFLINE_SCHEMA_VERSION,
    bandId: snapshot.bandId,
    savedAt: snapshot.savedAt,
    bytes: storedSongBytes(song),
    individualDownload,
  }
}

function toSetlistRecord(snapshot: OfflineSnapshot): OfflineSetlistRecord {
  const list = {
    playlistId: snapshot.playlistId,
    playlistName: snapshot.playlistName,
    bandId: snapshot.bandId,
    savedAt: snapshot.savedAt,
    entries: snapshot.songs.map((song) => ({
      versionId: song.versionId,
      title: song.entry.title,
      artist: song.entry.artist,
    })),
  }
  return { ...list, kind: 'setlist', schemaVersion: OFFLINE_SCHEMA_VERSION, bytes: setlistListBytes(list) }
}

/** Folds one more copy of a song into the merge, returning the losing copy's keys. */
function offer(songs: Map<string, Candidate>, next: Candidate): string[] {
  const id = next.record.playlistId
  const current = songs.get(id)
  if (!current) {
    songs.set(id, next)
    return []
  }
  const nextWins = next.record.savedAt > current.record.savedAt
  const [winner, loser] = nextWins ? [next, current] : [current, next]
  songs.set(id, {
    record: {
      ...winner.record,
      individualDownload: winner.record.individualDownload || loser.record.individualDownload,
    },
    fromLegacy: winner.fromLegacy || loser.fromLegacy,
  })
  return songCacheKeys(loser.record)
}

/** The conversion of `records`, and the view the store reads, in one pure pass. */
export function planOfflineConversion(records: OfflineStoredRecord[]): OfflineConversionPlan {
  const songs = new Map<string, Candidate>()
  const setlists: OfflineSetlistRecord[] = []
  const setlistWrites: OfflineSetlistRecord[] = []
  const legacyIds: string[] = []
  const purged: string[] = []
  const losingKeys: string[] = []

  // Already-converted songs first, so a tie keeps the record already written.
  for (const record of records) {
    if (isSongRecord(record)) losingKeys.push(...offer(songs, { record, fromLegacy: false }))
    else if (isSetlistRecord(record)) setlists.push(record)
  }
  for (const record of records) {
    if (isSongRecord(record) || isSetlistRecord(record)) continue
    const legacy = record as OfflineSnapshotRecord
    const snapshot = readValidSnapshot(legacy.snapshot)
    if (!snapshot) {
      purged.push(legacy.playlistId)
      continue
    }
    legacyIds.push(legacy.playlistId)
    const individual = isSongRecordId(legacy.playlistId)
    for (const song of snapshot.songs) {
      losingKeys.push(...offer(songs, { record: toSongRecord(song, snapshot, individual), fromLegacy: true }))
    }
    if (!individual) setlistWrites.push(toSetlistRecord(snapshot))
  }

  const merged = [...songs.values()]
  const finalSongs = merged.map((candidate) => candidate.record)
  const kept = new Set(finalSongs.flatMap(songCacheKeys))
  const writes = [...merged.filter((c) => c.fromLegacy).map((c) => c.record), ...setlistWrites]
  const written = new Set(writes.map((record) => record.playlistId))
  return {
    songs: finalSongs,
    setlists: [...setlists, ...setlistWrites],
    writes,
    retired: legacyIds.filter((id) => !written.has(id)),
    staleKeys: [...new Set(losingKeys)].filter((key) => !kept.has(key)),
    purged,
  }
}

/** True when the plan has anything to persist. */
export function conversionPending(plan: OfflineConversionPlan): boolean {
  return plan.writes.length + plan.retired.length + plan.staleKeys.length + plan.purged.length > 0
}

/**
 * Persists a plan through the record and blob ports — never `fetch`.
 *
 * Records first, bytes last: a copy is only deleted once nothing written still
 * needs it, so an interruption at any step leaves every song readable, either
 * as its converted record or inside its legacy one.
 */
export async function applyOfflineConversion(
  ports: Pick<OfflineStorePorts, 'records' | 'blobs'>,
  plan: OfflineConversionPlan,
): Promise<void> {
  for (const record of plan.writes) await ports.records.put(record)
  for (const id of plan.retired) await ports.records.delete(id)
  for (const key of plan.staleKeys) await ports.blobs.delete(key)
  for (const id of plan.purged) {
    await ports.blobs.deleteByPrefix(legacyTabKeyPrefix(id))
    await ports.records.delete(id)
  }
}
