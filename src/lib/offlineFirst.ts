/**
 * The offline-first decorator: one wrapper over an injected Server Action
 * bundle that answers from an RH-79 snapshot when the network is gone (RH-80).
 *
 * The Fast View already injects every action bundle rather than importing it
 * (F21), so the whole offline read path is *one* module applied at *one*
 * composition root (`src/app/fastViewOfflineActions.ts`) — no controller and no
 * component gains an offline branch.
 *
 * ## Pure by injection
 *
 * `ports` carries the two things the decorator cannot compute: the store to
 * read snapshots from and the answer to "is the browser offline right now?".
 * It is a `Partial<OfflineFirstPorts>` merged over the defaults
 * (`OFFLINE_STORE` and `navigator.onLine`), so production passes nothing and a
 * test passes `{ store }` alone. That is what keeps this module free of any
 * browser global at import time and its suite free of any mocking library.
 *
 * It deliberately does **not** use `useOfflineStatus`: that hook is React-only
 * and this is not a React context. Both read the same `navigator.onLine`
 * signal; the hook stays the UI's reader.
 *
 * ## The three behaviours, and the one rule that matters
 *
 * Every known method name maps to `reader`, `envelopeWrite` or `rejectWrite`.
 * An **unknown** name defaults to `rejectWrite`: offline it never reaches the
 * network and never serves data, which is the safe direction for a method
 * nobody has classified yet.
 *
 * The split follows each method's declared return type in its `*Actions`
 * interface. A method declared to resolve a result envelope must resolve one —
 * its hook does not `catch`; a method declared `Promise<void>` / `Promise<T>`
 * rejects, and its hook already catches and raises a Toast.
 *
 * Fallback happens in exactly two situations, in this order:
 *
 *   1. `ports.isOffline()` is true — the real action is never called.
 *   2. The real action rejected, `isNetworkFailure(error)` is true, **and** the
 *      method is a reader. If the offline reader then throws, the *original*
 *      error is rethrown.
 *
 * Anything else — a non-network failure while online, any failure of a write —
 * is rethrown unchanged. **Stale snapshot data is never served in place of a
 * real error.** That is the rule to check first when reading this file.
 *
 * ## Known gap, deliberately out of scope
 *
 * `updateLinks` is an envelope write, so offline it resolves `success: false`
 * rather than rejecting. `useSongLinks.submit` ignores the envelope and reports
 * its optimistic success toast; disabling the link controls offline is named in
 * the spec's Out of Scope list (docs/tasks/RH-81-spec.md). ER4 disables the two
 * controls that are in scope, in the page.
 */

import {
  offlineTabToRepertoireTab,
  type OfflineSnapshot,
  type OfflineSongSnapshot,
} from '@/lib/offlineSnapshot'
import { OFFLINE_STORE, type OfflinePlaylistSummary, type OfflineStore } from '@/lib/offlineStore'

/** The single message every refused offline write carries. */
export const OFFLINE_WRITE_MESSAGE = 'You are offline. This change cannot be saved until you reconnect.'

/**
 * "There is no offline copy of this playlist."
 *
 * Thrown only by the offline `getPlaylistDetailsWithEntries` reader, where
 * `null` is not an option: `usePlaylistNav`'s existing `.catch` absorbs it into
 * `nav === null`, which is exactly "no setlist to show".
 */
export class OfflineUnavailableError extends Error {
  constructor(message = 'This playlist is not available offline.') {
    super(message)
    this.name = 'OfflineUnavailableError'
  }
}

/** The two things the decorator cannot compute for itself. */
export interface OfflineFirstPorts {
  /** Only the two RH-79 reads are needed; no new store method exists for this. */
  store: Pick<OfflineStore, 'listOfflinePlaylists' | 'readOfflineSnapshot'>
  /** `true` while the browser reports no network. */
  isOffline: () => boolean
}

/**
 * The default signal: offline only when the platform says so *explicitly*.
 *
 * `navigator.onLine === false` rather than `!navigator.onLine`, deliberately.
 * Node ≥ 21 defines a `navigator` global with no `onLine` property, so the
 * shorter spelling reads as "offline" on the server and would make any
 * server-side call of a wrapped action answer from an empty snapshot store
 * instead of from the database. Only a browser that actually reports no network
 * gets the offline path.
 */
function defaultIsOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

const NETWORK_FAILURE_MESSAGE = /failed to fetch|networkerror|network request failed|load failed/i

/**
 * "Did this rejection mean the network is gone?"
 *
 * Every browser answers a failed `fetch` with a `TypeError`, and the four
 * message shapes above are Chromium's, Firefox's, React Native's and WebKit's.
 * The check is structural rather than `instanceof` so a value crossing a realm
 * boundary (a Server Action response is deserialized) still reads correctly.
 * An `AbortError` is deliberately false: the caller cancelled, the network did
 * not fail.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { name, message } = error as { name?: unknown; message?: unknown }
  if (name !== 'TypeError') return false
  return typeof message === 'string' && NETWORK_FAILURE_MESSAGE.test(message)
}

/**
 * The order snapshots are searched in when only a `repertoireId` is known:
 * most recently downloaded first, ties broken by `playlistId` ascending.
 *
 * Total and deterministic on purpose — a song in two downloaded playlists must
 * resolve the same way on every call. The two copies hold the same repertoire
 * row for the same owner context, so the choice is about freshness only.
 * Returns a new array; the argument is not mutated.
 */
export function orderSnapshotCandidates(
  summaries: OfflinePlaylistSummary[],
): OfflinePlaylistSummary[] {
  return [...summaries].sort((left, right) => {
    if (left.savedAt !== right.savedAt) return left.savedAt < right.savedAt ? 1 : -1
    return left.playlistId < right.playlistId ? -1 : 1
  })
}

/** The first downloaded snapshot that captured this song, newest first. */
async function findSong(
  ports: OfflineFirstPorts,
  repertoireId: string,
): Promise<OfflineSongSnapshot | null> {
  for (const summary of orderSnapshotCandidates(await ports.store.listOfflinePlaylists())) {
    const snapshot = await ports.store.readOfflineSnapshot(summary.playlistId)
    const song = snapshot?.songs.find((candidate) => candidate.repertoireId === repertoireId)
    if (song) return song
  }
  return null
}

function detailsFromSnapshot(snapshot: OfflineSnapshot) {
  return {
    name: snapshot.playlistName,
    entries: snapshot.songs.map((song) => song.entry),
  }
}

type OfflineReader = (ports: OfflineFirstPorts, args: unknown[]) => Promise<unknown>

/**
 * The five reads Fast View makes, answered from the snapshot.
 *
 * The snapshot is resolved from the action's own arguments and never from page
 * state — that is what lets the wrapping happen once, at module scope, with the
 * stable object identities the seven controllers depend on.
 */
const OFFLINE_READERS: Record<string, OfflineReader> = {
  getPlaylistDetailsWithEntries: async (ports, [playlistId]) => {
    const snapshot = await ports.store.readOfflineSnapshot(String(playlistId))
    if (!snapshot) throw new OfflineUnavailableError()
    return detailsFromSnapshot(snapshot)
  },

  getSongEntry: async (ports, [repertoireId]) => {
    return (await findSong(ports, String(repertoireId)))?.repertoire ?? null
  },

  // `file_url` is overridden with the Cache Storage key the download wrote the
  // PDF under: the remote Blob URL is unreachable offline, and `src/app/sw.ts`
  // answers the key from `OFFLINE_TAB_CACHE`. `offlineSnapshot.ts` is untouched.
  getTabs: async (ports, [repertoireId]) => {
    const song = await findSong(ports, String(repertoireId))
    return (song?.tabs ?? []).map((tab) => ({
      ...offlineTabToRepertoireTab(tab),
      file_url: tab.cacheKey,
    }))
  },

  // The member's own repertoire row is not captured (RH-79). `null` is what
  // leaves `shouldLoadPersonalEntry` false and the second `getTabs` unfired.
  getPersonalEntryForSong: () => Promise.resolve(null),

  // An empty annotation set, not an error envelope: Stage Mode then renders the
  // PDF with no strokes and no failure panel.
  getAnnotations: () => Promise.resolve({ data: {} }),
}

/** Writes whose declared return type is a result envelope their hook inspects. */
const ENVELOPE_WRITES = new Set(['uploadTab', 'deleteTab', 'saveAnnotations', 'updateLinks'])

function offlineWrite(method: string): Promise<unknown> {
  if (ENVELOPE_WRITES.has(method)) {
    return Promise.resolve({ success: false, error: OFFLINE_WRITE_MESSAGE })
  }
  return Promise.reject(new Error(OFFLINE_WRITE_MESSAGE))
}

async function callWithFallback(
  method: string,
  action: (...args: unknown[]) => unknown,
  ports: OfflineFirstPorts,
  args: unknown[],
): Promise<unknown> {
  const reader = OFFLINE_READERS[method]

  if (ports.isOffline()) {
    return reader ? reader(ports, args) : offlineWrite(method)
  }

  try {
    return await action(...args)
  } catch (error) {
    if (!reader || !isNetworkFailure(error)) throw error
    try {
      return await reader(ports, args)
    } catch {
      // The offline copy could not answer either, so the caller gets the truth
      // it would have got without this decorator.
      throw error
    }
  }
}

/**
 * The same bundle, offline-aware.
 *
 * Returns a new object carrying exactly the same own method names as `bundle`,
 * each replaced by a wrapper. Non-function own properties are copied through
 * unchanged.
 */
export function offlineFirst<T extends object>(bundle: T, ports?: Partial<OfflineFirstPorts>): T {
  const resolved: OfflineFirstPorts = {
    store: ports?.store ?? OFFLINE_STORE,
    isOffline: ports?.isOffline ?? defaultIsOffline,
  }

  const wrapped: Record<string, unknown> = {}
  for (const [method, value] of Object.entries(bundle)) {
    wrapped[method] =
      typeof value === 'function'
        ? (...args: unknown[]) =>
            callWithFallback(method, value as (...args: unknown[]) => unknown, resolved, args)
        : value
  }
  return wrapped as T
}
