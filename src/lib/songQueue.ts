/**
 * The song queue: the ordered list of songs Fast View walks, and who owns them
 * (RH-133).
 *
 * `docs/use-cases.md` § *Walk a queue of songs* decides the design; this module
 * is only its implementation. The parts that matter to a reader here:
 *
 * - **One `sessionStorage` entry.** It survives a reload and dies with the tab.
 *   Nothing is stored server-side: a playlist is already a row and needs no
 *   copy, and a computed or hand-picked queue is not worth a table while
 *   nothing reads it later.
 * - **No position is stored.** The current place is derived at read time by
 *   matching the route's `versionId` against the stored entries, which is what
 *   "No progress is kept" requires.
 * - **An entry is a version id, a title and an artist, and nothing else.** Not
 *   for size: for staleness. A queue carrying lyrics goes stale from the
 *   musician's *own* edit, which is the common case. Neither a title nor an
 *   artist is overridable, so neither can go stale that way — and the chrome
 *   (the position indicator, the list, prev/next) then needs no network at all,
 *   which is what makes a queue navigable offline.
 * - **A malformed or absent value reads as "no queue"**, never as a throw. The
 *   queue is optional chrome: a song that cannot resolve one still reads
 *   perfectly well on its own.
 *
 * Client safe, like `playlistNav.ts`: it imports nothing at all — not `react`,
 * not `pg`, nothing from the App Router tree (F21), and in particular not the
 * zustand band-context store. See `resolveQueueOwner` for why that last one is
 * a rule rather than an accident.
 *
 * Every browser-API access is guarded, so importing this module and calling its
 * readers under the `node` test environment — which has no `sessionStorage` at
 * all — neither throws on import nor on call
 * (`src/lib/__tests__/songQueueNodeEnv.test.ts`).
 */

/** One song of the queue: an address and the two labels the chrome draws. */
export interface SongQueueEntry {
  /** The `song_versions.id` that addresses Fast View (RH-132). */
  versionId: string
  title: string
  artist: string | null
}

/**
 * Whose rows the queue was built against. **Context, not authority**: see
 * `resolveQueueOwner`.
 */
export type SongQueueOwner = { type: 'personal' } | { type: 'band'; bandId: string }

/** The whole stored document. No position, by design — see the module docblock. */
export interface SongQueue {
  entries: SongQueueEntry[]
  owner: SongQueueOwner
  /** Where the queue was built, which is where Back goes. */
  originHref: string
  /** What the setlist chrome calls this queue: a playlist's name, a session's. */
  label: string
}

/** The two plain neighbours of a position; `null` at either end. */
export interface QueueNeighbours {
  prev: SongQueueEntry | null
  next: SongQueueEntry | null
}

/** The one `sessionStorage` key the whole queue lives under. */
export const SONG_QUEUE_KEY = 'song-queue'

/**
 * `sessionStorage`, or `null` where there is none.
 *
 * Two distinct absences, both of which must read as "no queue" rather than
 * throw: the `node` test environment has no such global at all, and a browser
 * may refuse the property outright under a privacy setting.
 */
function sessionStore(): Storage | null {
  try {
    const store = (globalThis as { sessionStorage?: Storage }).sessionStorage
    return store ?? null
  } catch {
    // A storage-denied browser is a browser with no queue, not a broken page.
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The three navigation fields, or null for anything else. */
function readEntry(value: unknown): SongQueueEntry | null {
  if (!isRecord(value)) return null
  if (typeof value.versionId !== 'string' || value.versionId === '') return null
  if (typeof value.title !== 'string') return null
  if (value.artist !== null && typeof value.artist !== 'string') return null
  return { versionId: value.versionId, title: value.title, artist: value.artist }
}

function readOwner(value: unknown): SongQueueOwner | null {
  if (!isRecord(value)) return null
  if (value.type === 'personal') return { type: 'personal' }
  if (value.type === 'band' && typeof value.bandId === 'string' && value.bandId !== '') {
    return { type: 'band', bandId: value.bandId }
  }
  return null
}

/** The whole document, or null: one malformed part discards the queue. */
function readQueue(value: unknown): SongQueue | null {
  if (!isRecord(value) || !Array.isArray(value.entries)) return null
  if (typeof value.originHref !== 'string' || typeof value.label !== 'string') return null

  const owner = readOwner(value.owner)
  if (!owner) return null

  const entries: SongQueueEntry[] = []
  for (const candidate of value.entries) {
    const entry = readEntry(candidate)
    if (!entry) return null
    entries.push(entry)
  }

  return { entries, owner, originHref: value.originHref, label: value.label }
}

/** The stored string this module last parsed, and what it parsed to. */
let cachedRaw: string | null = null
let cachedQueue: SongQueue | null = null

function rawSongQueue(): string | null {
  const store = sessionStore()
  if (!store) return null

  try {
    return store.getItem(SONG_QUEUE_KEY)
  } catch {
    // Same reasoning as `sessionStore`: unreadable storage is no queue.
    return null
  }
}

/**
 * The queue this tab is walking, or `null` when there is none.
 *
 * `null` covers every "no queue" there is — a fresh tab, a song opened alone, a
 * value another version of the app wrote, a hand-edited one, a browser that
 * refuses storage — because the caller treats all of them identically: no
 * setlist chrome.
 *
 * **The result is referentially stable while the stored string is unchanged**,
 * which is what lets a React caller read it as an external store snapshot: a
 * fresh object per call would re-render forever. The cache is keyed on the raw
 * string, so a write, a clear or an edit from anywhere is picked up on the next
 * call.
 */
export function readSongQueue(): SongQueue | null {
  const raw = rawSongQueue()
  if (raw === cachedRaw) return cachedQueue

  cachedRaw = raw
  cachedQueue = raw ? parseSongQueue(raw) : null
  return cachedQueue
}

function parseSongQueue(raw: string): SongQueue | null {
  try {
    return readQueue(JSON.parse(raw))
  } catch {
    // Not JSON at all. Optional chrome, so there is nothing to report.
    return null
  }
}

/**
 * Replaces the tab's queue.
 *
 * The entries are rebuilt field by field rather than spread, so a caller
 * handing in a richer row — a playlist entry, an owner row — cannot put lyrics,
 * a status or a position into the queue by accident.
 */
export function writeSongQueue(queue: SongQueue): void {
  const store = sessionStore()
  if (!store) return

  const document: SongQueue = {
    entries: queue.entries.map((entry) => ({
      versionId: entry.versionId,
      title: entry.title,
      artist: entry.artist,
    })),
    owner: queue.owner,
    originHref: queue.originHref,
    label: queue.label,
  }

  try {
    store.setItem(SONG_QUEUE_KEY, JSON.stringify(document))
  } catch {
    // A full or denied store costs the setlist chrome and nothing else.
  }
}

/** Forgets the tab's queue. A song opened alone then has no chrome. */
export function clearSongQueue(): void {
  const store = sessionStore()
  if (!store) return

  try {
    store.removeItem(SONG_QUEUE_KEY)
  } catch {
    // Nothing to do: the queue is already unreachable either way.
  }
}

/**
 * The entries either side of `currentVersionId`, matched by version id.
 *
 * **The ends are absent, never wrapped**: at index 0 there is no previous
 * entry, at the last index no next one, and neither end sees the other. A
 * version absent from the queue has neither neighbour, which is what leaves a
 * song opened alone with no chrome.
 *
 * This is the surface RH-134's content window will fetch against; it already
 * answers the question that window asks ("which songs do I need in hand?").
 */
export function queueNeighbours(
  entries: SongQueueEntry[],
  currentVersionId: string,
): QueueNeighbours {
  const index = entries.findIndex((entry) => entry.versionId === currentVersionId)
  if (index === -1) return { prev: null, next: null }

  return {
    prev: entries[index - 1] ?? null,
    next: entries[index + 1] ?? null,
  }
}

/**
 * Which band, if any, owns what Fast View is showing — `null` for personal.
 *
 * **`?bandId=` wins whenever it is present. The queue's recorded `owner`
 * applies only when the URL carries no `bandId`. Fast View never reads the
 * stored band context itself** — which is why this function takes
 * exactly two inputs and why it imports the zustand band-context store
 * nowhere.
 *
 * The reason is about the *channel*, not about absence. The store does reach
 * Fast View, laundered through the URL: `RepertoireDashboard.tsx` reads the
 * stored context and serialises it into the Fast View href at the moment the
 * link is rendered, while the playlist path puts the playlist's own `band_id`
 * there. So the URL is the single channel through which any owner choice
 * reaches this screen, and the page reads it once. Reading the store *again*
 * here would read the same source twice and would let a drifting preference
 * override a URL the musician explicitly opened — a shared or bookmarked link,
 * or a playlist link whose band came from the row.
 *
 * **Why a client-writable value is still safe.** `sessionStorage` is writable
 * by the client, so a forged owner has to be answered for rather than assumed
 * away. The result of this function reaches exactly one place: the `bandId` of
 * the prev/next/select hrefs the setlist chrome pushes
 * (`src/hooks/usePlaylistNav.ts`, its only production caller). A forged owner
 * can therefore only become a URL parameter on a later navigation — no more
 * than the musician can already do by typing `?bandId=` into the address bar —
 * and every band-scoped read and write re-checks membership server-side through
 * `assertBandMember` (`src/lib/bands.ts`), which fails closed. **The queue
 * carries context, not authority**, and this value never becomes a write
 * argument: Fast View's page keeps taking the `bandId` it threads into
 * `updateStatus` and `updateLyrics` from `searchParams` alone.
 */
export function resolveQueueOwner(
  urlBandId: string | null,
  owner: SongQueueOwner | null | undefined,
): string | null {
  if (urlBandId) return urlBandId
  return owner?.type === 'band' ? owner.bandId : null
}
