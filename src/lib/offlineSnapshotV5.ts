/**
 * The retained v5 offline snapshot shape, and the lossless upgrade to v6
 * (RH-132).
 *
 * This is the first `OFFLINE_SCHEMA_VERSION` bump that is a **pure reshape of
 * data already in the record** rather than a genuine loss of information, so it
 * does not follow the v1 -> v2 precedent of discarding. A v5 song already
 * carries everything a v6 one needs:
 *
 *   - `entry.versionId` — required since RH-125, and the Fast View address v6
 *     keys a song by;
 *   - `repertoire.id` — the owner row's id, which becomes `ownerRowId`;
 *   - the ten resolved fields (`version_id`, `song_id`, `status`, `key`,
 *     `tuning`, `lyrics`, `map`, `tags`, `last_practiced`, `song`), verbatim.
 *
 * The mapping below is therefore total; the only widening is `status`, from
 * `SongStatus` to `SongStatus | null`. Every `OfflineTabSnapshot.cacheKey` and
 * `personalRepertoire` pass through untouched, which is what keeps the cached
 * PDF bytes valid: discarding instead would destroy every downloaded playlist
 * on first launch, recoverable only with a network connection.
 *
 * ## Why this lives beside `offlineSnapshot.ts` rather than inside it
 *
 * `src/lib/offlineSnapshot.ts` is at 340 lines against the base `max-lines: 400`
 * and the `eslint.config.mjs` override list is a ratchet that may not gain an
 * entry (F20), so the retained v5 material would not fit. This sibling is the
 * fallback RH-132's spec decided in advance, and it keeps the same purity
 * contract: no Cache Storage, no IndexedDB, no `window`, no `navigator`, no
 * clock. It is a deterministic function of its input.
 *
 * `offlineSnapshot.ts` imports this module, so nothing here imports a *value*
 * back from it — see {@link UPGRADE_TARGET_VERSION}.
 */

import type { PlaylistEntry } from '@/lib/playlistNav'
import type { OfflineSnapshot, OfflineSongSnapshot, OfflineTabSnapshot } from '@/lib/offlineSnapshot'
import type { Repertoire } from '@/types/database'

/** The `schemaVersion` a v5 record carries. */
export const OFFLINE_SCHEMA_VERSION_V5 = 5

/**
 * The version this upgrade produces.
 *
 * Declared here rather than imported from `offlineSnapshot.ts`, which imports
 * *this* module: a value import back would close a module cycle for one
 * integer. `offlineSnapshot.test.ts` asserts that an upgraded record's
 * `schemaVersion` equals `OFFLINE_SCHEMA_VERSION`, so the two cannot drift
 * apart silently.
 */
const UPGRADE_TARGET_VERSION = 6

/**
 * One song of a v5 snapshot.
 *
 * `repertoireId` was the owner row's id and the Fast View address; `repertoire`
 * was the owner's `Repertoire` row rather than a resolved `(owner, version)`
 * pair.
 */
export interface OfflineSongSnapshotV5 {
  repertoireId: string
  entry: PlaylistEntry
  repertoire: Repertoire
  personalRepertoire: Repertoire | null
  tabs: OfflineTabSnapshot[]
}

/** One v5 playlist record, as stored. */
export interface OfflineSnapshotV5 {
  schemaVersion: number
  playlistId: string
  playlistName: string
  bandId: string | null
  savedAt: string
  songs: OfflineSongSnapshotV5[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Validates only what the upgrade *reads*.
 *
 * Everything else — `playlistId`, `playlistName`, `savedAt`, `bandId` and every
 * tab — is validated by the v6 pass `readValidSnapshot` runs over the upgraded
 * value, so a malformed v5 record still ends at `null` without this function
 * duplicating those checks. What it must guarantee is that `entry.versionId`
 * and `repertoire.id` are present and are strings: a v5 record written before
 * RH-125 carries no `versionId` at all, and upgrading it would produce a v6
 * song keyed by `undefined`.
 */
function isSongSnapshotV5(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (typeof value.repertoireId !== 'string') return false
  if (!isRecord(value.entry) || typeof value.entry.versionId !== 'string') return false
  if (!isRecord(value.repertoire) || typeof value.repertoire.id !== 'string') return false
  // Absent is not null, on the v6 validator's own reasoning: a v1 song carried
  // no such field, and reading it as "no personal version" is the wrong answer.
  if (!('personalRepertoire' in value)) return false
  if (value.personalRepertoire !== null && !isRecord(value.personalRepertoire)) return false
  return Array.isArray(value.tabs)
}

/** True for a stored value tagged v5 whose songs carry what the upgrade reads. */
export function isSnapshotV5(value: unknown): value is OfflineSnapshotV5 {
  if (!isRecord(value)) return false
  if (value.schemaVersion !== OFFLINE_SCHEMA_VERSION_V5) return false
  return Array.isArray(value.songs) && value.songs.every(isSongSnapshotV5)
}

/**
 * The ten resolved fields plus `song`, mapped field by field rather than by
 * spread-and-delete: an explicit list is what makes the totality of the mapping
 * readable, and it leaves `id`, `user_id` and `band_id` behind — the only three
 * fields `Repertoire` has that `ResolvedSongEntry` does not.
 */
function upgradeSongV5(song: OfflineSongSnapshotV5): OfflineSongSnapshot {
  const row = song.repertoire
  return {
    // `PlaylistEntry.versionId`, non-null since RH-125.
    versionId: song.entry.versionId,
    entry: song.entry,
    repertoire: {
      // The owner row the v5 record was keyed by. Non-null by construction:
      // v5's `gatherSongs` skipped every entry without one.
      ownerRowId: row.id,
      version_id: row.version_id,
      song_id: row.song_id,
      status: row.status,
      key: row.key,
      tuning: row.tuning,
      lyrics: row.lyrics,
      map: row.map,
      tags: row.tags,
      last_practiced: row.last_practiced,
      song: row.song,
    },
    // Shape unchanged — still the member's own `Repertoire`, song-keyed.
    personalRepertoire: song.personalRepertoire,
    // `cacheKey`s unchanged, so the downloaded PDF bytes stay addressable.
    tabs: song.tabs,
  }
}

/**
 * A v5 snapshot as a v6 one. Pure: no database, no network, no `window`, no
 * clock — `savedAt` is carried through, never re-read.
 */
export function upgradeSnapshotV5ToV6(snapshot: OfflineSnapshotV5): OfflineSnapshot {
  return {
    playlistId: snapshot.playlistId,
    playlistName: snapshot.playlistName,
    bandId: snapshot.bandId,
    savedAt: snapshot.savedAt,
    schemaVersion: UPGRADE_TARGET_VERSION,
    songs: snapshot.songs.map(upgradeSongV5),
  }
}
