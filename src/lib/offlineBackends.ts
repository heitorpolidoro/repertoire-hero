/**
 * The real storage adapter behind `@/lib/offlineStore`'s ports (RH-79):
 * IndexedDB for the snapshot records, Cache Storage for the tab PDFs and, since
 * RH-195, for the Fast View documents the service worker answers offline.
 *
 * Decision-free on purpose. Every rule about *what* to store, in what order and
 * what to unwind lives in `offlineStore.ts` and is unit-tested over in-memory
 * fakes; this file only translates a port call into the browser API call that
 * performs it. It is the one module in the offline set that cannot run under
 * `jsdom`, which implements neither `indexedDB` nor `caches` — which is exactly
 * why the store reaches it through a lazy dynamic import and never at module
 * scope.
 */

import {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OFFLINE_PAGE_CACHE,
  OFFLINE_SNAPSHOT_STORE,
  OFFLINE_TAB_CACHE,
} from '@/lib/offlineStore'
import type {
  OfflineBlobPort,
  OfflinePagePort,
  OfflineRecordPort,
  OfflineStoredRecord,
  OfflineStorePorts,
} from '@/lib/offlineRecords'

/** One `IDBRequest` as a promise. */
function fromRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

/** The database, opened (and created on first use) on demand. */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(OFFLINE_SNAPSHOT_STORE)) {
        db.createObjectStore(OFFLINE_SNAPSHOT_STORE, { keyPath: 'playlistId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase()
  try {
    const transaction = db.transaction(OFFLINE_SNAPSHOT_STORE, mode)
    return await fromRequest(run(transaction.objectStore(OFFLINE_SNAPSHOT_STORE)))
  } finally {
    db.close()
  }
}

function createRecordPort(): OfflineRecordPort {
  return {
    async get(recordId) {
      const row = await withStore<OfflineStoredRecord | undefined>('readonly', (store) =>
        store.get(recordId),
      )
      return row ?? null
    },
    async put(record) {
      await withStore('readwrite', (store) => store.put(record))
    },
    async delete(recordId) {
      await withStore('readwrite', (store) => store.delete(recordId))
    },
    list() {
      return withStore<OfflineStoredRecord[]>('readonly', (store) => store.getAll())
    },
  }
}

function openTabCache(): Promise<Cache> {
  return caches.open(OFFLINE_TAB_CACHE)
}

function createBlobPort(): OfflineBlobPort {
  return {
    async put(key, response) {
      const cache = await openTabCache()
      await cache.put(key, response)
    },
    async match(key) {
      const cache = await openTabCache()
      return cache.match(key)
    },
    async delete(key) {
      const cache = await openTabCache()
      await cache.delete(key)
    },
    async deleteByPrefix(prefix) {
      const cache = await openTabCache()
      // A prefix scan of the cache's own keys, kept for purging a pre-RH-192
      // record no upgrade can read (its bytes are keyed by its record id).
      for (const request of await cache.keys()) {
        if (new URL(request.url).pathname.startsWith(prefix)) await cache.delete(request)
      }
    },
    async clear() {
      await caches.delete(OFFLINE_TAB_CACHE)
    },
  }
}

/**
 * The worker's own Fast View document cache (RH-80), written by a song download
 * too since RH-195. A relative path resolves against the page's origin, which
 * is the URL the worker later looks the navigation up by.
 */
function createPagePort(): OfflinePagePort {
  return {
    async put(path, response) {
      const cache = await caches.open(OFFLINE_PAGE_CACHE)
      await cache.put(path, response)
    },
  }
}

/**
 * The ports the default `OFFLINE_STORE` runs on. Called from inside a store
 * method, never at import time: this is the only function here that touches a
 * browser global, and it is reached through a dynamic import.
 */
export function createDefaultOfflinePorts(): OfflineStorePorts {
  return {
    records: createRecordPort(),
    blobs: createBlobPort(),
    pages: createPagePort(),
    fetch: (...args) => fetch(...args),
  }
}
