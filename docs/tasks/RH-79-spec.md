# RH-78 — Build the PWA shell: service worker, manifest and the offline signal

> **Filename mapping.** This file is `docs/tasks/RH-79-spec.md` and it specifies
> board task **RH-78**. Spec filenames in this repository run one ahead of the
> board id; `RH-78-spec.md` is already taken by an earlier task. Read every
> "RH-78" below as the board id, and the filename as an offset artefact.

Parent: **RH-28** (offline mode). Design of record:
`docs/superpowers/specs/2026-09-20-offline-mode-design.md` at `c418719`.

## Scope

Part 1 of the RH-28 three-way split: **the shell only**. It delivers the
service-worker build pipeline, the emitted worker, the web app manifest, the
installability icons, the client registration, and the online/offline signal
hook that RH-79 and RH-80 consume.

It does **not** deliver: the snapshot store, the per-playlist download, the Fast
View read path, the read-only banner, the settings storage view or the sign-out
purge. Those are RH-79 and RH-80 and are listed under Out of Scope.

## The mechanism — verified, not assumed

`withSerwist` is forbidden: `@serwist/next@9.5.12` pulls
`@serwist/webpack-plugin` and does not support Turbopack, and this repository
runs Turbopack everywhere (`AGENTS.md:51`, guarded by
`src/lib/__tests__/devBundler.test.ts`) because `pdfjs-dist` dies under the
webpack dev runtime and takes the whole Fast View client graph with it.

**Configurator mode works and is the mechanism.** Verified against the published
9.5.12 tarballs:

- `@serwist/next` exports a `./config` subpath (`dist/index.config.mjs`) whose
  `serwist(options)` returns a `BuildOptions` object for `@serwist/cli`. Its
  import list is `node:fs`, `node:path`, `@serwist/build`, `@serwist/utils`,
  `browserslist` and `next/constants.js` — **no `@serwist/webpack-plugin`**.
  Only `dist/index.mjs` (the `withSerwist` entry) touches the webpack plugin, and
  nothing here imports it.
- `@serwist/cli` ships a `serwist` binary with a `build <config.js>` command that
  bundles a TypeScript service-worker source with **esbuild** and injects the
  precache manifest. Its config loader is
  `(await import(configFile)).default`, awaited — so a config file that
  `export default`s the promise returned by `serwist(...)` is the supported
  shape.
- Smoke-tested end to end in an isolated directory at `@serwist/cli@9.5.12` +
  `serwist@9.5.12`: `serwist build serwist.config.js` consumed a `sw.ts`,
  reported *"The service worker will precache 3 URLs"* and emitted a 31 KB
  classic (non-module, no `import`/`export`) `sw.js` whose first bytes are the
  injected manifest array with per-file `revision` hashes. Zero webpack
  involvement.
- **`esbuild` must be declared explicitly.** Without it the CLI aborts with
  `Cannot find package 'esbuild' ... This command needs esbuild.` It is not a
  dependency of `@serwist/cli`. Re-verified: a clean
  `npm i serwist@9.5.12 @serwist/next@9.5.12 @serwist/cli@9.5.12` leaves
  `node_modules/esbuild` absent.

`next.config.ts` is therefore not modified at all, and Turbopack is untouched.

### The navigation fallback — verified, not assumed

`fallbacks` alone does nothing. In the installed `serwist@9.5.12`
(`dist/index.mjs`, the `Serwist` constructor), `fallbacks` is read **only inside
`if (runtimeCaching !== undefined) { … }`**: it builds a
`PrecacheFallbackPlugin` and pushes it onto the `plugins` array of every
runtime-caching entry whose `handler instanceof Strategy` and that has no
`handlerDidError` plugin yet. With no `runtimeCaching`, `fallbacks` is silently
discarded — no error, no warning. The only other recovery path, `_catchHandler`,
fires exclusively when an **already-registered route** throws, and the sole route
this task would otherwise register is the `PrecacheRoute`, which does not match
`/songs/<id>/fast-view`. An offline navigation would therefore match no route,
the worker would not respond, and the browser would paint its own network-error
page.

**Decision: one `runtimeCaching` entry, `NetworkOnly`, restricted to documents.**
`src/app/sw.ts` passes
`runtimeCaching: [{ matcher: isDocument, handler: new NetworkOnly() }]` together
with `fallbacks: { entries: [{ url: '/offline', matcher: isDocument }] }`, where
`isDocument` is `({ request }) => request.destination === 'document'`.
`NetworkOnly` extends `Strategy`, so it receives the `PrecacheFallbackPlugin`;
online it always goes to the network and **stores nothing**, so it cannot
introduce a stale shell; offline it rejects, `handlerDidError` runs, the entry's
`matcher` passes and `matchPrecache('/offline')` returns the precached document.
`navigationPreload: true` remains coherent: `StrategyHandler.fetch` consumes
`event.preloadResponse` for `request.mode === 'navigate'` regardless of strategy.

**`precacheOptions.navigateFallback` is explicitly rejected.** It registers a
precache-first `NavigationRoute` that answers *every* navigation — online
included — with `/offline`, which is exactly the stale-shell failure §3 promises
cannot happen.

### The precache manifest must be an allow-list — verified, not assumed

`@serwist/next/config` defaults `precachePrerendered: true`, which appends the
glob `<distDir>/server/{app,pages}/**/*.html`. In this repository that sweeps
**every prerendered document** into the precache: `.next/server/app` emits
`index.html`, `forgot-password.html`, `login.html`, `profile.html`,
`reset-password.html`, `settings.html`, `signup.html` and `songs/search.html`,
and the built-in `manifestTransforms` rewrites each to a bare URL (`/login`,
`/profile`, …). **Seven of those are in the `src/proxy.ts` matcher.**

That is fatal, because the `Serwist` constructor registers
`new PrecacheRoute(...)` *before* it walks `runtimeCaching`, and
`Serwist.findMatchingRoute` returns the **first** route that matches in
registration order. `PrecacheRoute`'s matcher matches any precached URL,
navigations included. So with the default manifest the document-scoped
`NetworkOnly` entry below would never be reached for those seven URLs: they
would be answered from the precache while online, the proxy's 307 would never
be issued, and a signed-out visitor to `/profile` or `/settings` would land on
exactly the spinner `src/proxy.ts` exists to prevent.

**Decision: turn the manifest into an allow-list.** `serwist.config.js` sets
`precachePrerendered: false` and supplies `globPatterns` explicitly, re-using the
exported `generateGlobPatterns(distDir)` (hashed `_next/static` assets plus
`public/**/*`) and adding exactly one HTML file:
`<distDir>server/app/offline.html`. `distDir` is read from the loaded Next
config rather than hardcoded, via the supported
`serwist.withNextConfig(async (nextConfig) => ({ … }))` entry point. The
built-in `manifestTransforms` is unconditional — it does not depend on
`precachePrerendered` — so that one file is still rewritten to the URL
`/offline`, which is what ER4 and the `fallbacks` entry need. Nothing else
replaces it and no prerendered document other than `/offline` is precached, so
a future private route added to the proxy matcher cannot silently rejoin the
precache.

A deny-list (`globIgnores` naming the seven files) was rejected: it is
maintenance-coupled to `src/proxy.ts` and fails open when a new route is added.

**Measured, not argued.** Against the installed `@serwist/next@9.5.12` +
`@serwist/build`, with a fixture tree containing all eight prerendered
documents, `getManifest` on the produced options yields:

- default (`precachePrerendered: true`) —
  `["/","/_next/static/chunks/a.js","/forgot-password","/icons/icon-192.png","/login","/offline","/profile","/reset-password","/settings","/signup","/songs/search"]`
- allow-list (the decision above) —
  `["/_next/static/chunks/a.js","/icons/icon-192.png","/offline"]`

`/offline` is only prerendered while it uses no dynamic API, which is why §9
forbids one in that route.

**Smoke-tested at these exact versions.** With `serwist@9.5.12` +
`@serwist/cli@9.5.12` + `esbuild`, a `sw.ts` of exactly the shape above built
clean (`The service worker will precache 1 URLs`); the emitted `sw.js` is a
classic script containing both `registerCapture` and `handlerDidError`, and the
same source typechecks with zero errors under `lib: ["esnext","webworker"]`.

## Approach

### Behavior

**1. Build pipeline.** The `build` npm script gains a final stage that runs the
Serwist CLI *after* `next build`, so the precache manifest is globbed from the
finished `.next` output. `dev` is untouched (its guard test must stay green).

**2. Worker source.** `src/app/sw.ts` constructs a `Serwist` from the `serwist`
package with `precacheEntries: self.__SW_MANIFEST`, `skipWaiting: true`,
`clientsClaim: true`, `navigationPreload: true`, the single document-scoped
`NetworkOnly` `runtimeCaching` entry and the `fallbacks.entries` entry pointing
at the precached `/offline` URL — both required, for the reason established in
"The navigation fallback" above; a `fallbacks` without a `runtimeCaching` is a
no-op. It does **not** import `@serwist/next/worker`'s `defaultCache`: no
response of any kind is written to a runtime cache by this task.

**3. Update strategy (settled).** Two halves:

- *No stale HTML by construction.* Precedence matters here and the wording is
  exact. Serwist registers the `PrecacheRoute` **before** the runtime-caching
  routes and matches routes in registration order, so any precached URL is
  answered from the precache — the `NetworkOnly` entry only sees what the
  precache does not contain. The guarantee is therefore bought by the manifest,
  not by the handler: the only precached entries are content-hashed
  `_next/static` assets, `public/**` files and the single document `/offline`
  (see "The precache manifest must be an allow-list"). Every other navigation —
  including all seven `src/proxy.ts` routes — falls through to the document
  `NetworkOnly` handler, which reads from no cache and writes to no cache, goes
  to the network, and lets the proxy's redirects run normally. It falls back to
  the precached `/offline` shell only when the handler **errors**, i.e. when
  there is no network. So: **no application page other than `/offline` is ever
  served from the worker's cache, and `/offline` is a static shell that carries
  no user data and cannot go stale in a way a user can observe.**
- *Worker replacement.* Every production build regenerates `sw.js` with a new
  manifest, so its bytes differ on every deploy; the browser's byte comparison
  detects it on the next navigation. `skipWaiting: true` + `clientsClaim: true`
  make the new worker activate and take control without waiting for every tab to
  close, and Serwist's precache cleanup drops the superseded entries on
  `activate`. Registration passes `updateViaCache: 'none'` so the worker script
  itself is never answered from the HTTP cache. **Recovery for a user stuck on
  an old build: one further navigation.** No update prompt and no forced reload
  are introduced — a reload-on-activate would interrupt a musician mid-set, which
  is precisely the situation this feature exists for.

**4. Where registration lives.** A new client component
`src/components/layout/ServiceWorkerRegistrar.tsx` renders `null` and, in a
`useEffect` with no `setState` (so `react-hooks/set-state-in-effect` stays
clean), calls `navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })`,
guarded on `'serviceWorker' in navigator` and on
`process.env.NODE_ENV === 'production'`, with a `.catch` that narrows via
`instanceof Error` and reports through `logger` (convention P1 — never
`console.error`).

It mounts in **`src/app/layout.tsx`, as a sibling of `<AppShell>` next to
`<Analytics />`** — not inside `AppShell`. Two reasons: `AppShell` delegates to
`ConditionalLayout`, which strips the chrome on the landing and auth routes, so a
registrar mounted inside it would not run on every route; and `AppShell` owns a
single responsibility (band-chrome data, RH-46) that this must not be folded
into. The root layout stays a Server Component — it renders a client component,
which is legal and is already what it does for `AppShell`.

**5. Dev vs production (settled).** `npm run dev` runs no Serwist step,
`public/sw.js` does not exist (it is gitignored, like
`public/pdf.worker.min.mjs`), and the registrar's `NODE_ENV` guard means nothing
is registered and nothing 404s. The existing Playwright suite, which starts the
server with `npm run dev` in CI, therefore behaves exactly as it does today —
this task must not change a single existing e2e outcome. The service worker is
exercised by a **new production-only** spec, `e2e/pwa-shell.spec.ts`, which
`test.skip`s unless `process.env.E2E_PROD` is set; it is run against
`npm run build && npx next start` (the `PLAYWRIGHT_WEB_SERVER` path AGENTS.md:51
already describes). Everything else in this task is provable without a browser:
the emitted artefact is asserted from Node, the hook and the registrar from
vitest.

The exact invocation for the production-only spec, which ER5 repeats verbatim
because QA never sees this document, is:

    npm run build && E2E_PROD=1 \
      PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" \
      npx playwright test e2e/pwa-shell.spec.ts --project=chromium

A run that reports the spec as *skipped* is a configuration failure, not a pass.
CI is deliberately left unchanged: `.github/workflows/ci.yml` still runs
`npm run test:e2e` against `npm run dev` with neither variable set, so the spec
skips there and no existing e2e outcome moves.

**6. Manifest.** `src/app/manifest.ts` (Next file convention, served at
`/manifest.webmanifest`) returns `display: 'standalone'`, `start_url: '/'`,
`name`/`short_name`, `background_color`/`theme_color`, and the two icons.

**7. Icons (settled).** `src/app/icon.jpg` is a 1024×1024 progressive JPEG and
stays as the favicon convention. The two manifest icons are **committed PNGs**
at `public/icons/icon-192.png` and `public/icons/icon-512.png`, derived once
from `icon.jpg` and regenerable by the documented one-off command recorded in the
spec header of the guard test (`sips -s format png -Z 192 src/app/icon.jpg
--out public/icons/icon-192.png`, and likewise 512; any equivalent resizer is
acceptable — the artefact is what matters). They are **not** generated at build
time: `sharp` is present only transitively and **fails to load on this machine's
Node 24**, so taking a build-time dependency on it to produce two assets that
change approximately never would add a native-binary failure mode to every build
for no gain. Correctness is held by a test that reads the PNG signature and the
IHDR width/height with plain Node — no image library. `purpose: 'any'` on both;
a maskable safe-zone variant is out of scope.

**8. Offline signal.** `src/hooks/useOfflineStatus.ts` exports
`useOfflineStatus(): boolean`, returning `true` when offline, built on
`useSyncExternalStore` following `src/hooks/useHydrated.ts` (RH-77): `subscribe`
adds `online`/`offline` listeners on `window` and returns a teardown removing
both, `getSnapshot` is `!navigator.onLine`, `getServerSnapshot` is `false`. It
contains **no `useEffect`** — the `useEffect` + `setState` shape is a
`react-hooks/set-state-in-effect` error under this config.

**9. The offline shell route.** `src/app/offline/page.tsx` is a static Server
Component rendering a short "You are offline" panel carrying
`data-testid="offline-shell"` **server-side**, so the assertion never depends on
hydration. It is the only place that element is created, and ER5 asserts on it.
It must use **no dynamic API** (`cookies`, `headers`, `searchParams`, `no-store`
fetches): if `/offline` is not statically prerendered, no `offline.html` lands in
`.next/server/app`, the URL never enters the precache manifest, and the fallback
has nothing to return. It is deliberately named `/offline`, not `/~offline`, to avoid an
exotic path character. It is not added to the `src/proxy.ts` allow-list: it must
render with no session, since offline the proxy does not run at all.

### Files touched

| Path | Change |
|---|---|
| `package.json` | add `serwist`, `@serwist/next`, `@serwist/cli`, `esbuild`; append the Serwist CLI stage to `build`; add `typecheck:sw`; bump `version` per the AGENTS.md rule |
| `serwist.config.js` (new, repo root) | default-exports `serwist.withNextConfig(...)` from `@serwist/next/config` with `swSrc: 'src/app/sw.ts'`, `swDest: 'public/sw.js'`, `precachePrerendered: false`, and `globPatterns` = `generateGlobPatterns(distDir)` plus `<distDir>server/app/offline.html` — the allow-list that keeps the seven proxy-matched documents out of the precache |
| `src/app/sw.ts` (new) | the worker source: precache entries, skipWaiting/clientsClaim, the document-scoped `NetworkOnly` runtime-caching entry and the `fallbacks` entry to `/offline` |
| `src/app/manifest.ts` (new) | the web app manifest |
| `src/app/offline/page.tsx` (new) | the static offline shell document |
| `src/components/layout/ServiceWorkerRegistrar.tsx` (new) | client registration, renders null |
| `src/components/layout/__tests__/ServiceWorkerRegistrar.test.tsx` (new) | registration + failure-path unit test |
| `src/app/layout.tsx` | mount `<ServiceWorkerRegistrar />` beside `<Analytics />` |
| `src/hooks/useOfflineStatus.ts` (new) | the `useSyncExternalStore` online/offline signal |
| `src/hooks/__tests__/useOfflineStatus.test.tsx` (new) | event flip + teardown test |
| `src/lib/__tests__/pwaShell.test.ts` (new) | Node-level guards: emitted `sw.js` shape, icon dimensions, no `withSerwist` |
| `public/icons/icon-192.png`, `public/icons/icon-512.png` (new) | committed derived icons |
| `tsconfig.json` | add `src/app/sw.ts` to `exclude` (its `webworker` lib conflicts with the app's `dom` lib) |
| `tsconfig.sw.json` (new) | extends the base, `lib: ["esnext","webworker"]`, includes only `src/app/sw.ts` |
| `.gitignore` | ignore `/public/sw.js` and `/public/sw.js.map` (build artefacts, same treatment as `pdf.worker.min.mjs`) |
| `knip.json` | add **both** `serwist.config.js` **and `src/app/sw.ts`** to `entry`, and add `esbuild` and `@serwist/cli` to `ignoreDependencies`. `src/app/sw.ts` matches none of knip's Next plugin production entry patterns (`node_modules/knip/dist/plugins/next/index.js` covers `manifest`/`robots`/`sitemap`/`icon`/`layout|page|route|template` only) and nothing under `src` imports it — the CLI reaches it through the `swSrc` path literal, which knip cannot resolve — so without the entry knip reports `src/app/sw.ts` as an unused file and `serwist` as an unused dependency. `esbuild` and `@serwist/cli` are reached only through the build-script binary |

`next.config.ts` and `eslint.config.mjs` are **not** modified. `public/**` is
already in the eslint `globalIgnores`, so the emitted worker cannot move the lint
baseline.

### Test criteria

- **vitest** — `useOfflineStatus`: initial value from `navigator.onLine`, flips on
  dispatched `window` `offline` and `online` events, and both listeners are
  removed on unmount (assert via spies on `add`/`removeEventListener`). Source
  contains no `useEffect`.
- **vitest** — `ServiceWorkerRegistrar`: with a stubbed `navigator.serviceWorker`,
  `register` is called once with `/sw.js`; with `register` rejecting, nothing
  throws and `logger.error` is called.
- **vitest** — `pwaShell.test.ts`: `withSerwist` appears nowhere in
  `next.config.ts` or `src`; the two icon PNGs exist with the declared
  dimensions read from IHDR; when `public/sw.js` exists it contains a
  `__SW_MANIFEST`-derived array with ≥1 entry, an entry whose url is
  `/offline`, and the strings `registerCapture` and `handlerDidError` (the proof
  that the runtime-caching route and the fallback plugin were both wired) (the test is a no-op assertion
  about absence when it does not, so `npm test` stays green on a dev tree).
- **vitest** — `pwaShell.test.ts`, precache URL set: parse the injected manifest
  by taking the **first** array literal of `public/sw.js` (it is the leading
  `var <id>=[{url:"…",revision:"…"},…];` statement) and collecting every
  `url:"…"` inside **that slice only** — bounding to the first array matters,
  because the literal `"/offline"` also appears later, in the compiled
  `fallbacks` entry. Assert the URL set contains `/offline` and at least one
  `/_next/static/…` entry, and contains **none** of `/login`, `/signup`,
  `/forgot-password`, `/reset-password`, `/profile`, `/settings`,
  `/songs/search`, and no URL matching any pattern in the `src/proxy.ts`
  `config.matcher` (read the matcher from the source rather than duplicating it,
  so a new private route is covered automatically).
- **existing guards, unedited** — `devBundler.test.ts` and
  `complexityBudget.test.ts` must pass with their assertions and `MAX_OVERRIDES`
  untouched. The override list is already at exactly 18 of a ceiling of 18, so no
  new entry is even possible.
- **build** — `npm run build` completes under Turbopack and emits `public/sw.js`
  with a non-empty precache manifest.
- **playwright, production-only** — `e2e/pwa-shell.spec.ts`: register the worker,
  await activation, `context.setOffline(true)`, navigate to a Fast View URL, and
  assert `[data-testid="offline-shell"]` is visible rather than the browser's
  network-error page. Run with the §5 invocation; a skipped run is not a pass.
- **gates** — `npm run lint` reproduces the baseline exactly; `npm run lint:dead`
  and `npm run test:coverage` pass (`src/hooks/useOfflineStatus.ts` is inside the
  coverage universe and is fully covered by its suite).

## Expected Results

- [ ] ER1 — `package.json` declares `serwist`, `@serwist/next`, `@serwist/cli` **and `esbuild`** (verified required: without it `@serwist/cli` aborts with "This command needs esbuild"), and a clean `npm install` resolves them with no peer-dependency error.
- [ ] ER2 — The service worker is wired through the configurator mode of `@serwist/next`: `grep -rn "withSerwist" next.config.ts src` returns no match, a root `serwist.config.js` default-exports the result of `serwist(...)` or `serwist.withNextConfig(...)` from `@serwist/next/config`, and `npm run build`'s final stage invokes the `serwist build` CLI.
- [ ] ER3 — `npm run dev` and `npm run build` both still run under Turbopack, `next.config.ts` is unchanged, and `src/lib/__tests__/devBundler.test.ts` passes with its assertions unedited.
- [ ] ER4 — `src/app/sw.ts` exists and `npm run build` emits `public/sw.js` containing a precache manifest with at least one app-shell entry **and an entry whose url is `/offline`**; the CLI's own output reports a non-zero "will precache N URLs".
- [ ] ER5 — The precache manifest is an allow-list, checkable from Node with no browser: parse the **first** array literal in `public/sw.js` (the leading `var <id>=[{url:"…",revision:"…"},…];` statement) and collect its `url:"…"` values. That set **contains** `/offline` and at least one URL starting `/_next/static/`, and **contains none of** `/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/profile`, `/settings`, `/songs/search`, nor any URL matching a pattern in `src/proxy.ts`'s `config.matcher`. A vitest guard in `src/lib/__tests__/pwaShell.test.ts` asserts exactly this. Rationale, verified against `serwist@9.5.12`: `Serwist` registers its `PrecacheRoute` before the `runtimeCaching` routes and matches in registration order, so any precached document URL is served from the precache while online and bypasses `src/proxy.ts` entirely.
- [ ] ER6 — The service worker actually installs the navigation fallback, proven by running:
      `npm run build && E2E_PROD=1 PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test e2e/pwa-shell.spec.ts --project=chromium`.
      The spec registers the worker, awaits activation, sets `context.setOffline(true)`, navigates to a `/songs/<id>/fast-view` URL, and the server-rendered `[data-testid="offline-shell"]` element of `/offline` is visible instead of the browser network-error page. **The test must report as passed, with 1 passed and 0 skipped — a skipped run does NOT count as a pass** (the spec `test.skip`s without `E2E_PROD`, and `npm run test:e2e` alone will skip it).
- [ ] ER7 — `src/app/sw.ts` passes **both** a `runtimeCaching` entry whose handler is a `Strategy` (a document-scoped `NetworkOnly`) **and** `fallbacks.entries` targeting `/offline`; it does not use `precacheOptions.navigateFallback`. `serwist@9.5.12` discards `fallbacks` entirely when `runtimeCaching` is undefined, so an implementation with only `fallbacks` fails this result even though it builds without error.
- [ ] ER8 — `GET /manifest.webmanifest` returns HTTP 200 with `display: "standalone"` and icons at 192x192 and 512x512 derived from `src/app/icon.jpg`; a vitest guard reads the PNG IHDR of `public/icons/icon-192.png` and `public/icons/icon-512.png` and asserts those exact dimensions.
- [ ] ER9 — `src/components/layout/ServiceWorkerRegistrar.tsx` registers the worker on mount and is mounted in `src/app/layout.tsx`; its unit test asserts `navigator.serviceWorker.register` is called with `/sw.js` and that a rejecting `register` is handled without throwing and reaches `logger.error`.
- [ ] ER10 — `src/hooks/useOfflineStatus.ts` is implemented with `useSyncExternalStore` and contains no `useEffect`.
- [ ] ER11 — A vitest suite for `useOfflineStatus` asserts the value flips on `window` `online` and `offline` events and that both listeners are removed on unmount.
- [ ] ER12 — `npm run lint` introduces no new problem against the baseline **re-measured at `c418719`: 8 errors / 12 warnings across 12 files, 14 distinct (file, rule, severity) pairs** — unchanged from the `23c6f1f` measurement.
- [ ] ER13 — `eslint.config.mjs` gains no new `complexity-budget/override` entry (the list stays at exactly 18, which is already the ceiling) and `src/lib/__tests__/complexityBudget.test.ts` passes with `MAX_OVERRIDES` unedited.
- [ ] ER14 — `npm run lint:dead` (knip) exits 0 with no reported issue. `knip.json` lists **both** `serwist.config.js` and `src/app/sw.ts` under `entry` (knip's Next plugin matches neither, and nothing under `src` imports `sw.ts`), and lists `esbuild` and `@serwist/cli` under `ignoreDependencies`; `public/sw.js` is gitignored so it never enters knip's or eslint's file set.

## Out of Scope

- The snapshot, its store and the per-playlist download — `src/lib/offlineSnapshot.ts`, `src/lib/offlineStore.ts`, `src/hooks/useOfflinePlaylist.ts`, `src/app/offlineActions.ts`, the `/playlists/[id]` control, the `/settings` storage view and the sign-out purge. **RH-79.**
- `src/lib/offlineFirst.ts`, the Fast View read path, the read-only banner and the cold-start Playwright test that asserts real setlist and PDF content. **RH-80.** RH-80 may replace or extend this task's fallback target; the `/offline` shell is the floor, not the final answer.
- **Runtime *caching* of responses.** No response — RSC, HTML, image, API — is written to a runtime cache by this task; `@serwist/next/worker`'s `defaultCache` is not imported. The one `runtimeCaching` entry the worker declares is a `NetworkOnly` document route that stores nothing and exists solely because `serwist@9.5.12` will not install a `fallbacks` plugin without one. This keeps the no-stale-shell guarantee of §3 intact while still producing an offline response.
- Maskable icons, splash screens, `share_target`, push notifications, native packaging (RH-29).
- Landing-page copy: per the AGENTS.md Landing Page Rule, this task ships no user-visible selling point on its own — installability and offline reading become one once RH-79 and RH-80 land, and that copy belongs to whichever of them completes the feature.
