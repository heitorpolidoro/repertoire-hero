// @ts-check
import { generateGlobPatterns, serwist } from '@serwist/next/config'

/**
 * RH-78 — build options for `serwist build serwist.config.js`, the final stage
 * of `npm run build`.
 *
 * `withSerwist` from `@serwist/next` is deliberately NOT used: it pulls
 * `@serwist/webpack-plugin` and does not support Turbopack, and this repository
 * runs Turbopack everywhere (AGENTS.md, RH-72, guarded by
 * `src/lib/__tests__/devBundler.test.ts`) because `pdfjs-dist` dies under the
 * webpack dev runtime and takes the whole Fast View client graph with it. The
 * `@serwist/next/config` subpath imports no webpack plugin at all, and
 * `next.config.ts` is not modified.
 *
 * ## The precache manifest is an allow-list
 *
 * `precachePrerendered` defaults to `true`, which appends
 * `<distDir>/server/{app,pages}/**\/*.html` and sweeps every prerendered
 * document into the precache — `/login`, `/signup`, `/forgot-password`,
 * `/reset-password`, `/profile`, `/settings` and `/songs/search` among them,
 * seven of which are in the `src/proxy.ts` matcher.
 *
 * That is fatal: `Serwist` registers its `PrecacheRoute` before the
 * runtime-caching routes and matches in registration order, so those URLs would
 * be served from the precache while online, the proxy's 307 would never be
 * issued, and a signed-out visitor to `/profile` would land on exactly the
 * spinner `src/proxy.ts` exists to prevent.
 *
 * So `precachePrerendered` is `false` and `globPatterns` is written out
 * explicitly: the hashed `_next/static` assets and `public/**` from
 * `generateGlobPatterns`, plus exactly one HTML file, `offline.html`. The
 * built-in `manifestTransforms` is unconditional, so that file still becomes the
 * URL `/offline`, which is what the worker's `fallbacks` entry needs. A
 * deny-list was rejected: it would be maintenance-coupled to `src/proxy.ts` and
 * fail open when a new private route is added.
 */
export default serwist.withNextConfig(async (nextConfig) => {
  // `generateGlobPatterns` and the built-in transforms both expect a distDir
  // with a trailing slash and no leading one — the normalisation `serwist()`
  // does internally happens *after* this callback runs. Reading
  // `nextConfig.distDir` raw yields `.nextserver/app/offline.html`, a pattern
  // that matches nothing and silently drops `/offline` from the manifest.
  const distDir = `${nextConfig.distDir.replace(/^\//, '').replace(/\/$/, '')}/`

  return {
    swSrc: 'src/app/sw.ts',
    swDest: 'public/sw.js',
    precachePrerendered: false,
    globPatterns: [...generateGlobPatterns(distDir), `${distDir}server/app/offline.html`],
  }
})
