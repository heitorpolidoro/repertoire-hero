/**
 * RH-151 — the dashboard's repertoire-aware filter over merged search rows.
 *
 * `withoutHeldVersions` drops the recordings the owner already holds. The
 * dashboard adds one rule on top: a row whose *song* is held and whose
 * remaining candidates are all Spotify-only is hidden too, because a Spotify
 * track cannot be told apart from the recording already held, and offering it
 * would only produce an `already in your repertoire` error. An unheld catalog
 * sibling version of a held song is still offered.
 *
 * Pure and client-safe: no React, no fetch, no `pg`.
 */

import { songIdentityKey } from '@/lib/songTitle'
import { withoutHeldVersions, type SongSearchRow } from '@/lib/songSearchMerge'
import type { Repertoire } from '@/types/database'

/** The held `version_id`s and the identity keys of the held songs. */
export interface HeldRepertoire {
  versionIds: ReadonlySet<string>
  songKeys: ReadonlySet<string>
}

/** What the owner's repertoire entries hold, in the two forms the filter needs. */
export function heldRepertoire(entries: readonly Repertoire[]): HeldRepertoire {
  const versionIds = new Set<string>()
  const songKeys = new Set<string>()
  for (const entry of entries) {
    if (entry.version_id) versionIds.add(entry.version_id)
    if (entry.song) songKeys.add(songIdentityKey(entry.song.title, entry.song.artist))
  }
  return { versionIds, songKeys }
}

/** True for a row that has candidates, none of which is a catalog version. */
function isSpotifyOnly(row: SongSearchRow): boolean {
  return row.versions.length > 0 && row.versions.every((candidate) => candidate.versionId === null)
}

/** The rows the owner may still add something from. */
export function withoutHeldRows(rows: readonly SongSearchRow[], held: HeldRepertoire): SongSearchRow[] {
  return withoutHeldVersions(rows, held.versionIds).filter(
    (row) => !(isSpotifyOnly(row) && held.songKeys.has(row.id)),
  )
}
