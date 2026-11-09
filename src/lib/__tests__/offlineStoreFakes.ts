/**
 * In-memory fakes for the two storage ports `@/lib/offlineStore` talks to
 * (RH-79) — the design's "storage fake", and the reason this repository needs
 * no `fake-indexeddb` and no mocking library for the offline suites.
 *
 * These are *ports*, not a store double. Every suite that exercises the store,
 * the download hook or either control injects `createOfflineStore(fakePorts)` —
 * the real store over these fakes — so the rollback under test is the real
 * rollback, and "nothing survived" is asserted against the fakes' own contents.
 * A hand-written store double would perform no rollback and make that assertion
 * vacuous.
 *
 * Not a test file: it exports helpers and holds no `describe`.
 */
import type {
  OfflineBlobPort,
  OfflineRecordPort,
  OfflineStoredRecord,
  OfflineStorePorts,
} from '@/lib/offlineRecords'
import type { OfflineSongInput, OfflineStore } from '@/lib/offlineStore'

/** The record port plus the map behind it, so a test can read what survived. */
export interface FakeRecordPort extends OfflineRecordPort {
  rows: Map<string, OfflineStoredRecord>
  putCalls: number
}

/** The blob port plus the map behind it, keyed exactly as Cache Storage is. */
export interface FakeBlobPort extends OfflineBlobPort {
  entries: Map<string, Response>
  putCalls: number
  /** Every key currently held under `/__offline-tab/<recordId>/`. */
  keysFor(recordId: string): string[]
}

/** A `fetch` that fails the test if anything calls it (RH-192 conversion). */
export const throwingFetch = (() => {
  throw new Error('fetch must not be called')
}) as unknown as typeof fetch

export interface FakeOfflinePorts extends OfflineStorePorts {
  records: FakeRecordPort
  blobs: FakeBlobPort
  fetched: string[]
}

export interface FakePortsOptions {
  /** Throw `QuotaExceededError` from the blob port's Nth `put` (1-based). */
  failBlobPutOnCall?: number
  /** Throw `QuotaExceededError` from the record port's Nth `put` (1-based). */
  failRecordPutOnCall?: number
  /** What `fetch` answers for a tab URL; defaults to a 1 KB usable response. */
  respond?: (url: string) => Response
}

function quotaExceeded(): DOMException {
  return new DOMException('quota', 'QuotaExceededError')
}

/** A normal, non-opaque, `ok` response carrying `size` bytes. */
export function tabResponse(size: number): Response {
  return new Response(new Uint8Array(size))
}

/** A response the download must refuse: opaque, or not `ok`. */
export function unusableResponse(kind: 'opaque' | 'not-ok'): Response {
  if (kind === 'not-ok') return new Response('nope', { status: 404 })
  const opaque = {
    ok: true,
    type: 'opaque',
    clone: () => opaque,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  }
  return opaque as unknown as Response
}

function createFakeRecordPort(failOnCall?: number): FakeRecordPort {
  const rows = new Map<string, OfflineSnapshotRecord>()
  const port: FakeRecordPort = {
    rows,
    putCalls: 0,
    get: (playlistId) => Promise.resolve(rows.get(playlistId) ?? null),
    put: (record) => {
      port.putCalls += 1
      if (port.putCalls === failOnCall) return Promise.reject(quotaExceeded())
      rows.set(record.playlistId, record)
      return Promise.resolve()
    },
    delete: (playlistId) => {
      rows.delete(playlistId)
      return Promise.resolve()
    },
    list: () => Promise.resolve([...rows.values()]),
  }
  return port
}

function createFakeBlobPort(failOnCall?: number): FakeBlobPort {
  const entries = new Map<string, Response>()
  const port: FakeBlobPort = {
    entries,
    putCalls: 0,
    keysFor: (playlistId) =>
      [...entries.keys()].filter((key) => key.startsWith(`/__offline-tab/${playlistId}/`)),
    put: (key, response) => {
      port.putCalls += 1
      if (port.putCalls === failOnCall) return Promise.reject(quotaExceeded())
      entries.set(key, response)
      return Promise.resolve()
    },
    match: (key) => Promise.resolve(entries.get(key)),
    delete: (key) => {
      entries.delete(key)
      return Promise.resolve()
    },
    deleteByPrefix: (prefix) => {
      for (const key of [...entries.keys()]) if (key.startsWith(prefix)) entries.delete(key)
      return Promise.resolve()
    },
    clear: () => {
      entries.clear()
      return Promise.resolve()
    },
  }
  return port
}

/** One captured song of version `versionId` with one chart `tabId`, for seeding a store. */
export function seedSongInput(versionId: string, tabId: string, title = 'Song'): OfflineSongInput {
  return {
    entry: { repertoireId: `row-${versionId}`, versionId, songId: `song-${versionId}`, title, artist: null },
    repertoire: {
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
    },
    personalRepertoire: null,
    tabs: [
      {
        id: tabId,
        user_id: 'user-1',
        song_id: `song-${versionId}`,
        title: 'Chart',
        file_url: `https://store.public.blob.vercel-storage.com/tabs/${tabId}.pdf`,
        created_at: '2026-05-01T00:00:00Z',
      },
    ],
    customFields: [],
  }
}

/** A personal setlist of several songs, for `seedSetlistOf`. */
export interface SeedSetlistOfInput {
  playlistId: string
  playlistName: string
  /** Each entry's version id and title, in order; the chart id is `tab-<versionId>`. */
  entries: Array<{ versionId: string; title: string }>
  /** Version ids the list holds but this device never stored, for an `N of M` count. */
  notStored?: string[]
  savedAt?: string
}

/**
 * Downloads a personal setlist of several songs the way the hook does: each
 * song, then the list. A song another seeded setlist already stored is saved
 * again, which leaves one record — the shared-song case (RH-194).
 */
export async function seedSetlistOf(store: OfflineStore, input: SeedSetlistOfInput): Promise<void> {
  const savedAt = input.savedAt ?? '2026-09-20T18:04:00.000Z'
  const skipped = new Set(input.notStored ?? [])
  for (const { versionId, title } of input.entries) {
    if (skipped.has(versionId)) continue
    await store.saveOfflineSong({ song: seedSongInput(versionId, `tab-${versionId}`, title), bandId: null, savedAt })
  }
  await store.saveOfflineSetlist({
    playlistId: input.playlistId,
    playlistName: input.playlistName,
    bandId: null,
    savedAt,
    entries: input.entries.map(({ versionId, title }) => ({ versionId, title, artist: null })),
  })
}

/** The three ports, wired together, with their contents readable. */
export function createFakePorts(options: FakePortsOptions = {}): FakeOfflinePorts {
  const fetched: string[] = []
  return {
    records: createFakeRecordPort(options.failRecordPutOnCall),
    blobs: createFakeBlobPort(options.failBlobPutOnCall),
    fetched,
    fetch: ((input: RequestInfo | URL) => {
      const url = String(input)
      fetched.push(url)
      return Promise.resolve(options.respond ? options.respond(url) : tabResponse(1024))
    }) as typeof fetch,
  }
}
