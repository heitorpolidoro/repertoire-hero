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
  OfflineSnapshotRecord,
  OfflineStorePorts,
} from '@/lib/offlineStore'

/** The record port plus the map behind it, so a test can read what survived. */
export interface FakeRecordPort extends OfflineRecordPort {
  rows: Map<string, OfflineSnapshotRecord>
  putCalls: number
}

/** The blob port plus the map behind it, keyed exactly as Cache Storage is. */
export interface FakeBlobPort extends OfflineBlobPort {
  entries: Map<string, Response>
  putCalls: number
  /** Every key currently held under `/__offline-tab/<playlistId>/`. */
  keysFor(playlistId: string): string[]
}

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
