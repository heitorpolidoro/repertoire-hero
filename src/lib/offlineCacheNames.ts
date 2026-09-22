/**
 * The Cache Storage cache names the offline feature uses — and nothing else.
 *
 * **This module must never gain an import.** It exists precisely because
 * `src/app/sw.ts` needs `OFFLINE_TAB_CACHE` and is bundled by
 * `serwist build` (esbuild, `platform: 'browser'`) as the last stage of
 * `npm run build`. Importing the constant from `@/lib/offlineStore` instead
 * pulls `@/lib/logger` → `@sentry/nextjs` → `next/constants` → the node
 * builtins `fs`, `stream` and `zlib` into a browser bundle, and the build
 * fails with three `Could not resolve` errors.
 *
 * `npm run typecheck:sw` does *not* catch that: `tsc -p tsconfig.sw.json`
 * resolves types without bundling and exits 0 on a worker the build cannot
 * emit. The guard that does catch it is `src/lib/__tests__/swBundle.test.ts`,
 * which runs a real esbuild browser bundle (RH-80).
 *
 * `offlineStore.ts` re-exports `OFFLINE_TAB_CACHE` from here, so the string
 * keeps exactly one definition and every existing importer is untouched.
 */

/** The Cache Storage cache the downloaded tab PDFs live in (RH-79). */
export const OFFLINE_TAB_CACHE = 'rh-offline-tabs-v1'

/**
 * The Cache Storage cache the Fast View *documents* live in (RH-80).
 *
 * Separate from the tab cache on purpose: this one holds HTML the worker wrote
 * itself while online, not bytes a download placed there, and the two have
 * different lifetimes. See the `runtimeCaching` note in `src/app/sw.ts` for why
 * a document cache exists at all and why it cannot serve stale HTML online.
 */
export const OFFLINE_PAGE_CACHE = 'rh-offline-pages-v1'
