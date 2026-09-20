/// <reference lib="webworker" />
import {
  NetworkOnly,
  Serwist,
  type PrecacheEntry,
  type SerwistGlobalConfig,
} from 'serwist'

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
 */
// Structurally typed rather than annotated `RouteMatchCallback`: the same
// predicate is used as a `runtimeCaching` matcher and as a `fallbacks` entry
// matcher, and those two positions take different parameter shapes (the latter
// is a `HandlerDidErrorCallbackParam`, which carries no `url`/`sameOrigin`).
const isDocument = ({ request }: { request: Request }): boolean =>
  request.destination === 'document'

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  // `StrategyHandler.fetch` consumes `event.preloadResponse` for a navigate
  // request regardless of the strategy, so this stays coherent with NetworkOnly.
  navigationPreload: true,
  runtimeCaching: [{ matcher: isDocument, handler: new NetworkOnly() }],
  fallbacks: {
    entries: [{ url: '/offline', matcher: isDocument }],
  },
})

serwist.addEventListeners()
