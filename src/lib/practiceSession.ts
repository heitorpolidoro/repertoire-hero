/**
 * RH-168 - turns an ordered candidate list into the `SongQueue` a practice
 * session stores and the Fast View href that opens its first song.
 *
 * Pure and client safe. Entries carry the three queue fields only
 * (`versionId`, `title`, `artist`), never a status or a date.
 */

import type { SongQueue, SongQueueOwner } from '@/lib/songQueue'
import type { PracticeCandidate } from '@/lib/practiceOrder'

/** What to practise, as the read action takes it. */
export type PracticeSource = { kind: 'repertoire' } | { kind: 'playlist'; playlistId: string }

/** The source as the builder labels it: a playlist is named, not addressed. */
export type PracticeSourceLabel = { kind: 'repertoire' } | { kind: 'playlist'; name: string }

export interface PracticeSessionInput {
  ordered: readonly PracticeCandidate[]
  owner: SongQueueOwner
  source: PracticeSourceLabel
}

export interface PracticeSession {
  queue: SongQueue
  href: string
}

export const WHOLE_REPERTOIRE_LABEL = 'Whole repertoire'

/** `null` when there is nothing to practise. */
export function buildPracticeSession(input: PracticeSessionInput): PracticeSession | null {
  const { ordered, owner, source } = input
  if (ordered.length === 0) return null

  const queue: SongQueue = {
    entries: ordered.map((song) => ({ versionId: song.versionId, title: song.title, artist: song.artist })),
    owner,
    originHref: owner.type === 'band' ? `/bands/${owner.bandId}` : '/',
    label: source.kind === 'playlist' ? source.name : WHOLE_REPERTOIRE_LABEL,
  }
  const first = `/songs/${ordered[0].versionId}/fast-view`
  return { queue, href: owner.type === 'band' ? `${first}?bandId=${owner.bandId}` : first }
}
