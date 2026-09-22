/// <reference lib="webworker" />
import {
  CacheOnly,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  type PrecacheEntry,
  type SerwistGlobalConfig,
} from 'serwist'
// A leaf module with no imports of its own, deliberately: see the note under
// "Why the tab cache name comes from its own module" below.
import { OFFLINE_PAGE_CACHE, OFFLINE_TAB_CACHE } from '@/lib/offlineCacheNames'

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Injected by the `serwist build` stage of `npm run build`.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

/**
 * RH-78 — the PWA service worker source.
 *
 * Built by `@serwist/cli` (esbuild, no webpack) into `public/sw.js` as the last
 * stage of `npm run build`; `serwist.config.js` holds the build options.
 *
 * ## What is cached
 *
 * Only what the precache manifest lists, which `serwist.config.js` keeps as a
 * strict allow-list: content-hashed `_next/static` assets, `public/**` files and
 * exactly one document, `/offline`. No response of any kind is written to a
 * runtime cache by this task — `@serwist/next/worker`'s `defaultCache` is
 * deliberately not imported.
 *
 * That matters for correctness, not just size. `Serwist` registers its
 * `PrecacheRoute` *before* the `runtimeCaching` routes and `findMatchingRoute`
 * returns the first match, so any precached document URL is answered from the
 * precache while online — bypassing `src/proxy.ts` and its auth redirects
 * entirely. Keeping every application document out of the manifest is what
 * makes "no stale HTML" true by construction.
 *
 * ## Why there is a `runtimeCaching` entry at all
 *
 * `fallbacks` on its own is a silent no-op. In `serwist@9.5.12` the `Serwist`
 * constructor reads `fallbacks` only inside `if (runtimeCaching !== undefined)`,
 * where it builds a `PrecacheFallbackPlugin` and pushes it onto every
 * runtime-caching entry whose handler is a `Strategy`. With no `runtimeCaching`
 * the option is discarded with no error and no warning, and an offline
 * navigation matches no route at all — the browser paints its own network-error
 * page.
 *
 * So there is exactly one entry: a document-scoped `NetworkOnly`. Online it
 * always goes to the network and stores nothing, so it cannot introduce a stale
 * shell; offline it rejects, `handlerDidError` fires, the fallback entry's
 * matcher passes and `matchPrecache('/offline')` returns the precached shell.
 *
 * `precacheOptions.navigateFallback` is explicitly rejected: it registers a
 * precache-first `NavigationRoute` that answers *every* navigation — online
 * included — with `/offline`.
 *
 * ## The second entry: the downloaded tab PDFs (RH-80)
 *
 * RH-79 writes each downloaded PDF into the `OFFLINE_TAB_CACHE` cache under the
 * synthetic same-origin key `/__offline-tab/<playlistId>/<tabId>`, and RH-80's
 * offline `getTabs` hands the UI that key as the tab's `file_url` — the remote
 * Blob URL is unreachable with no network. This entry is what answers it.
 *
 * `CacheOnly`, not `CacheFirst`: it never touches the network and never writes,
 * so the "this worker writes nothing to a runtime cache" invariant above stays
 * literally true, and online the same key is still answered from the very cache
 * the download filled. A **miss is deliberately not given a fallback**: the
 * strategy rejects, the error propagates to `react-pdf`, and Stage Mode shows
 * its own `Failed to load PDF.` panel — which is the honest answer for a chart
 * that was never downloaded. The `fallbacks.entries` matcher is `isDocument`
 * and a PDF subresource is not a document, so the `/offline` shell can never be
 * served as a chart.
 *
 * Registration order does not matter here: the two matchers are disjoint (a
 * subresource is never `destination === 'document'`), so first-wins has nothing
 * to decide.
 *
 * ## The third entry: the Fast View document itself (RH-80)
 *
 * Everything above is inert without one more thing: offline, a *navigation* to
 * `/songs/<id>/fast-view` has to produce the Fast View and not the `/offline`
 * shell. Measured on this worker before this entry existed: it produced the
 * shell, so the whole offline read path was unreachable through a reload —
 * which is the one thing the feature is for (see the design's "navigation
 * fallback so a cold start in airplane mode resolves").
 *
 * `NetworkFirst`, scoped to exactly that path, registered *before* the
 * document-wide `NetworkOnly` above (`findMatchingRoute` returns the first
 * match). Online it behaves exactly like `NetworkOnly` from the user's side —
 * the network is always consulted first, so `src/proxy.ts` still issues its
 * auth redirects and no stale HTML is ever served while connected — and it
 * additionally *stores* the 200 it got. Offline that stored copy is what
 * answers, React boots, and the wrapped action bundles answer from the RH-79
 * snapshot.
 *
 * Two consequences worth stating plainly:
 *
 *  - The stored document carries **no user data**. The Fast View is a client
 *    component whose entry loads in an effect, so its server render is the
 *    `Loading...` placeholder; every song field arrives later from the snapshot
 *    or the network. That is why sign-out clearing the snapshot and PDF caches
 *    (RH-79) is still sufficient to keep one person's repertoire off another
 *    person's device.
 *  - It is stored **per URL**. A Fast View that has never been opened while
 *    online is still answered with the `/offline` shell; downloading a playlist
 *    does not pre-cache its songs' documents. Making the download warm this
 *    cache is a real improvement and deliberately not in RH-80's scope.
 *
 * ## Why the tab cache name comes from its own module
 *
 * `@/lib/offlineStore` owns the cache but must **not** be imported here: its
 * graph reaches `@/lib/logger` → `@sentry/nextjs` → `next/constants` → the node
 * builtins `fs`, `stream` and `zlib`, and a browser-target bundle of this file
 * then fails with three `Could not resolve` errors — breaking `npm run build`
 * at its `serwist build` stage. `npm run typecheck:sw` stays green on exactly
 * that breakage; `src/lib/__tests__/swBundle.test.ts` is the guard that does
 * not.
 */
// Structurally typed rather than annotated `RouteMatchCallback`: the same
// predicate is used as a `runtimeCaching` matcher and as a `fallbacks` entry
// matcher, and those two positions take different parameter shapes (the latter
// is a `HandlerDidErrorCallbackParam`, which carries no `url`/`sameOrigin`).
const isDocument = ({ request }: { request: Request }): boolean =>
  request.destination === 'document'

/** `/songs/<id>/fast-view`, and nothing else. */
const FAST_VIEW_PATH = /^\/songs\/[^/]+\/fast-view$/

const isFastViewDocument = ({ request, url }: { request: Request; url: URL }): boolean =>
  request.destination === 'document' && FAST_VIEW_PATH.test(url.pathname)

/** RH-79's synthetic, same-origin key prefix for a downloaded tab PDF. */
const isOfflineTab = ({ url }: { url: URL }): boolean =>
  url.pathname.startsWith('/__offline-tab/')

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  // `StrategyHandler.fetch` consumes `event.preloadResponse` for a navigate
  // request regardless of the strategy, so this stays coherent with NetworkOnly.
  navigationPreload: true,
  runtimeCaching: [
    // First, so it wins over the document-wide NetworkOnly below.
    { matcher: isFastViewDocument, handler: new NetworkFirst({ cacheName: OFFLINE_PAGE_CACHE }) },
    { matcher: isDocument, handler: new NetworkOnly() },
    { matcher: isOfflineTab, handler: new CacheOnly({ cacheName: OFFLINE_TAB_CACHE }) },
  ],
  fallbacks: {
    entries: [{ url: '/offline', matcher: isDocument }],
  },
})

serwist.addEventListeners()
