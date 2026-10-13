/**
 * The Fast View song window (RH-134): the content of the previous, the current
 * and the next queue entry, fetched in one request and kept in memory so a swipe
 * finds its content in hand.
 *
 * `docs/use-cases.md` § *Walk a queue of songs* decides the design. This module
 * holds the pure decisions - which ids make up the window, which are not cached
 * yet - and the cache itself, keyed by `(bandId or personal, versionId)`.
 *
 * - **A latency optimisation, never a dependency.** Every reader works with the
 *   window absent or failed: a miss simply goes to the network as before.
 * - **One invalidation rule.** `invalidateSongWindow(versionId)` drops the cached
 *   copy and bumps the version's generation, so a fetch that started before the
 *   write is discarded on arrival and cannot put the old copy back.
 * - **Per tab, in memory.** The cache dies with a reload, which is correct.
 * - **A file's kind is not decided here.** The records carry each file row as the
 *   database holds it; `isImageTab` (`tabRenderer.ts`) is the only reader of it.
 *
 * Client safe: it imports types only, so nothing here pulls in `pg`.
 */

import type { ResolvedSongEntry, SongFile } from '@/types/database'

/** The previous, the current and the next entry. */
export const WINDOW_SIZE = 3

/** One song of a window, as the server answers it. */
export interface SongWindowRecord {
  versionId: string
  /** `null` for a version that does not exist; never fails the other records. */
  entry: ResolvedSongEntry | null
  /** The caller's own files for the song; `[]` for a song with none. */
  files: SongFile[]
}

export type SongWindowFetcher = (versionIds: string[]) => Promise<SongWindowRecord[]>

/** owner key -> version id -> record */
const cache = new Map<string, Map<string, SongWindowRecord>>()
/** version id -> how many writes have invalidated it */
const generations = new Map<string, number>()
/** owner key -> version id -> the fetch that will fill it */
const inflight = new Map<string, Map<string, Promise<void>>>()

function ownerKey(bandId: string | null): string {
  return bandId ?? 'personal'
}

function generationOf(versionId: string): number {
  return generations.get(versionId) ?? 0
}

/** A browser that knows it has no network; anywhere else, assume there is one. */
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * The ids of the window around `currentVersionId`: one entry either side, two at
 * the ends of the queue, and just the current one when there is no queue or the
 * song is not in it.
 */
export function windowVersionIds(
  entries: ReadonlyArray<{ versionId: string }>,
  currentVersionId: string,
): string[] {
  const index = entries.findIndex((entry) => entry.versionId === currentVersionId)
  if (index === -1) return [currentVersionId]
  return entries.slice(Math.max(0, index - 1), index + 2).map((entry) => entry.versionId)
}

/**
 * The cached record, or `undefined`. Never answers while the browser is
 * offline: the offline-first wrapper owns that case and its snapshot is the
 * only copy whose file addresses resolve there.
 */
export function cachedSong(bandId: string | null, versionId: string): SongWindowRecord | undefined {
  if (isOffline()) return undefined
  return cache.get(ownerKey(bandId))?.get(versionId)
}

/** The ids of `versionIds` that are neither cached nor already being fetched. */
export function uncachedVersionIds(bandId: string | null, versionIds: string[]): string[] {
  const key = ownerKey(bandId)
  return versionIds.filter(
    (id) => !cache.get(key)?.has(id) && !inflight.get(key)?.has(id),
  )
}

/**
 * Settles when the window fetch that is filling `versionId` has settled, or at
 * once when there is none. It never rejects: a failed fetch just leaves a miss.
 */
export function awaitSongWindow(bandId: string | null, versionId: string): Promise<void> {
  return inflight.get(ownerKey(bandId))?.get(versionId) ?? Promise.resolve()
}

function store(bandId: string | null, record: SongWindowRecord, startedAt: number): void {
  // A write landed while the request was in the air: this copy is the old one.
  if (generationOf(record.versionId) !== startedAt) return
  // A version that does not exist has nothing worth keeping.
  if (!record.entry) return
  const key = ownerKey(bandId)
  const owner = cache.get(key) ?? new Map<string, SongWindowRecord>()
  owner.set(record.versionId, record)
  cache.set(key, owner)
}

/**
 * One request for the window's ids that are not cached yet, none at all when
 * they all are. Resolves once the answers are stored; rejects when the fetcher
 * does, and the caller decides what that means (the hook swallows it).
 */
export async function fetchSongWindow(
  bandId: string | null,
  versionIds: string[],
  fetcher: SongWindowFetcher,
): Promise<void> {
  if (isOffline()) return
  const missing = uncachedVersionIds(bandId, versionIds)
  if (missing.length === 0) return

  const startedAt = new Map(missing.map((id) => [id, generationOf(id)]))
  const request = fetcher(missing).then((records) => {
    for (const record of records) store(bandId, record, startedAt.get(record.versionId) ?? -1)
  })

  const key = ownerKey(bandId)
  const owner = inflight.get(key) ?? new Map<string, Promise<void>>()
  inflight.set(key, owner)
  const settled = request.then(
    () => undefined,
    () => undefined,
  )
  for (const id of missing) owner.set(id, settled)
  void settled.then(() => {
    for (const id of missing) if (owner.get(id) === settled) owner.delete(id)
  })

  await request
}

/**
 * The one invalidation rule: a successful write to `versionId` drops every
 * cached copy of it and makes any fetch already in flight for it stale.
 */
export function invalidateSongWindow(versionId: string): void {
  generations.set(versionId, generationOf(versionId) + 1)
  for (const owner of cache.values()) owner.delete(versionId)
  // The request in the air will be discarded on arrival, so it must not stop the
  // next window from asking again.
  for (const owner of inflight.values()) owner.delete(versionId)
}

/** Empties the cache and every counter. Test isolation only. */
export function resetSongWindow(): void {
  cache.clear()
  generations.clear()
  inflight.clear()
}
