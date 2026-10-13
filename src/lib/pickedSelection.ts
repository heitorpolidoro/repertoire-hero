/**
 * Hand-picked practice selection (RH-170): the pure half. The ordered list of
 * picked version ids, and the `SongQueue` built from it. Client safe.
 */
import type { SongQueue, SongQueueEntry, SongQueueOwner } from '@/lib/songQueue'

/** The three fields a queue entry needs, read off the row on screen. */
export type PickRow = SongQueueEntry

export const PICKED_QUEUE_LABEL = 'Hand-picked selection'

/**
 * Appends an unpicked id; removes a picked one (later picks shift down by one).
 * Never mutates and never holds a duplicate.
 */
export function togglePick(picks: readonly string[], id: string): string[] {
  return picks.includes(id) ? picks.filter((pick) => pick !== id) : [...picks, id]
}

/**
 * The queue for `picks`, in pick order. A pick whose row is no longer on screen
 * (deleted meanwhile) is skipped, so the queue never holds an unresolvable entry.
 */
export function buildPickedQueue(
  picks: readonly string[],
  rowsById: ReadonlyMap<string, PickRow>,
  owner: SongQueueOwner,
  originHref: string,
): SongQueue {
  const entries: SongQueueEntry[] = []
  for (const id of picks) {
    const row = rowsById.get(id)
    if (row) entries.push({ versionId: row.versionId, title: row.title, artist: row.artist })
  }
  return { entries, owner, originHref, label: PICKED_QUEUE_LABEL }
}

/** Fast View on the queue's first entry, carrying `?bandId=` in band context. */
export function pickedFastViewHref(queue: SongQueue): string | null {
  const first = queue.entries[0]
  if (!first) return null
  const suffix = queue.owner.type === 'band' ? `?bandId=${queue.owner.bandId}` : ''
  return `/songs/${first.versionId}/fast-view${suffix}`
}
