# RH-29 — Shipping Repertoire Hero on Google Play and the Apple App Store

> **Status.** Re-verified against the code on **2026-10-13**, at `package.json` version `0.1.183-202610130947` (git HEAD `18be8d0`). **Decision requested from the operator:** approve the recommended path in §6 (harden the remaining PWA gaps, build account deletion, then a Capacitor shell with `server.url`, Android first) so the follow-up backlog items in §6.1 can be created.

**Type:** analysis / decision document. No code changes.
**Question:** what does it actually take to publish Repertoire Hero as a mobile app on both stores?
**Answer, in one line:** the web app is now a real, installable PWA with an offline mode; finish the last PWA gaps, build account deletion, then wrap it with **Capacitor pointed at the deployed URL** for both stores. A native rewrite is not justified today.

Every claim below is grounded in the code as of the Status line. File and line references are literal. (The document was first drafted as RH-30 against `v0.1.50-202609012115`; this revision is the RH-29 re-verification.)

**Changelog.**

- **RH-43 / RH-65 / RH-61 (2026-09-09):** the root layout no longer declares `force-dynamic` (RH-61, `57bc60a`), and `src/proxy.ts` is now a synchronous, header-only redirect convenience (RH-65, `66d9442`). The body below describes the current code, and §3.1 re-derives the `output: "export"` conclusion.
- **RH-74 (2026-09-17):** the `@supabase/*` packages and `NEXT_PUBLIC_SUPABASE_*` env entries are gone; auth is Better Auth over `pg`.
- **RH-78 / RH-79 / RH-80:** the PWA shell (manifest, icons, service worker) and the offline mode (snapshot store, downloaded PDFs, offline Fast View) shipped. §1.3, §1.4, §2.1 and §3.3 were updated accordingly.
- **RH-29 (2026-10-13):** full re-verification, new comparison table (§0), file and line references corrected.

---

## 0. Side-by-side comparison

| Option | Auth / cookies | Deep links | Offline | Push | Recurring cost | Effort (from today) |
|---|---|---|---|---|---|---|
| **PWA only** | Unchanged: Better Auth first-party `SameSite=Lax` cookies on the production origin | None on iOS; on Android only Chrome's link capturing for an installed PWA, with no verified App Link | Shipped (RH-78/79/80): precached shell, downloaded playlists and PDFs, offline Fast View. iOS may evict storage after disuse | Web Push; on iOS only after the user adds the app to the Home Screen | $0 beyond current hosting | XS-S (~1 day): maskable and `apple-touch-icon` icons, `viewport` export |
| **PWA + TWA** (Google Play only) | Unchanged: runs in Chrome, same cookie jar as the browser | Android App Links through `/.well-known/assetlinks.json` (Play App Signing SHA-256); no iOS equivalent | Same as PWA only (Chrome service worker and storage) | Web Push through Chrome on Android; nothing on iOS | $25 one-time (Play Console) | S (~1-2 days) on top of PWA; Android only, cannot reach the App Store |
| **Capacitor (`server.url`)** | Unchanged: the WebView origin is the production https origin, so cookies stay first-party; add shell origins to `trustedOrigins` only if the shell sends a different `Origin` (verify on device); Spotify OAuth must move to a system browser surface | Android App Links (`assetlinks.json`) and iOS Universal Links (`apple-app-site-association` plus the Associated Domains entitlement), through `@capacitor/app` | The web offline layer runs in the WebView, but service workers in WKWebView need App-Bound Domains (to verify on device); `@capacitor/filesystem` is the fallback | FCM (Android) and APNs (iOS) through `@capacitor/push-notifications`; also Web Push where the WebView supports it | $99/year (Apple) plus $25 one-time (Play) | M (~3-5 days) for a working shell; L (~2-3 weeks) to pass Apple review (§3.3) |
| **React Native / Expo** | Rewrite: cookie sessions replaced by Better Auth's bearer-token flow with secure storage; all authorisation re-implemented behind a new HTTP API | Android App Links and iOS Universal Links through Expo linking (same two hosted files) | Rebuilt natively (native storage and PDF files); the web service worker does not apply | FCM and APNs through Expo notifications; no Web Push | $99/year (Apple) plus $25 one-time (Play), plus optional paid EAS Build plans, plus a second client to maintain | XL (~2-3 months solo) |

Push is out of scope for design here (§7); the table only states what each path makes possible.

---

## 1. Current-state inventory

### 1.1 Rendering model — a mostly client-side app with Server Actions and a few server-rendered pages

This is the single most important fact for every option below, and it cuts both ways.

- `src/app/layout.tsx` is a plain Server Component: it exports `metadata`, loads the fonts, and mounts `AppShell`, `ServiceWorkerRegistrar` and `Analytics`. It no longer declares `force-dynamic` (RH-61).
- `next.config.ts` sets `output: process.env.VERCEL ? undefined : "standalone"` — never `"export"`.
- The server-rendered modules in `src/app` are the root layout and eight pages: `src/app/page.tsx` (94 lines; it awaits `getSession()`, which awaits `headers()`, so it is dynamic by construction and renders `LandingPage` when signed out), `src/app/admin/moderation/page.tsx`, `src/app/bands/page.tsx`, `src/app/playlists/page.tsx`, `src/app/playlists/[id]/page.tsx`, `src/app/join/[code]/page.tsx` and `src/app/offline/page.tsx`. The pages that stay `'use client'` are `src/app/songs/[versionId]/fast-view/page.tsx` (284 lines, a composition root over `src/components/fastview/*` and `src/hooks/*`), `settings`, `signup`, `login`, `forgot-password`, `reset-password`, `profile` and `bands/[id]`.
- Reads and writes go through Server Actions in `src/app/actions/*.ts` (8 modules: `audio`, `bands`, `catalogAdmin`, `moderation`, `playlists`, `profile`, `repertoire`, `tabs`), plus root-level binding files (`src/app/*Actions.ts`) that wrap them for the client. Route handlers cover only auth, Spotify OAuth and its proxy, and dev tooling: 10 `route.ts` files under `src/app/api/**`.

**Consequence (positive):** the interactive surface is client-side with a narrow, explicit server boundary, so a WebView shell will behave much like the browser does today.

**Consequence (negative):** Server Actions are **not an API**. They are a Next.js-runtime-bound RPC: the client posts to the same origin with a `Next-Action` header carrying a build-specific action ID. They cannot be called from a React Native client, cannot be statically exported, and cannot be served from a bundled `file://` origin. Together with the server-rendered pages (which read `headers()` and `cookies()`) and the route handlers, this keeps **`output: "export"` out of reach** without deleting the server layer — see §3.1. This eliminates the "bundled static export" variant of Capacitor.

### 1.2 Auth and session mechanics

- `src/lib/auth.ts` configures **Better Auth** directly against the `pg` pool. Email/password only; no social login. (The Supabase packages and env entries were removed in RH-75/RH-76.)
- Sessions are **cookie-based**. No `advanced.cookies` / `sameSite` / `crossSubDomain` configuration is present in `src/lib/auth.ts`, so Better Auth defaults apply (httpOnly, `SameSite=Lax`, `Secure` in production) — i.e. **first-party, same-origin cookies**.
- `src/lib/auth-client.ts` derives its `baseURL` from `window.location.origin` at runtime.
- `src/lib/auth.ts:45-49` sets a **hardcoded `trustedOrigins`** list: `http://localhost:3000`, `http://127.0.0.1:3000`, plus `NEXT_PUBLIC_APP_URL` when set. A shell that sends any other `Origin` (`capacitor://localhost`, `http://localhost`) would be rejected.
- `src/proxy.ts` (Next.js proxy/middleware) is **not** an authorization boundary (RH-65). It reads the request headers only, checks whether a Better Auth session cookie is present with `getSessionCookie`, and redirects to `/login` (or an auth page to `/`). It never validates the cookie and makes no network call. Its `matcher` is an allow-list of 12 entries (the four auth pages, `/profile`, `/settings`, `/bands/(.*)`, `/playlists/(.*)`, `/songs/(.*)`, `/admin/(.*)`, `/bands`, `/playlists`); everything else, including `/`, is not matched.
- Server Actions authorise via `getRequiredUserId()` (`src/lib/auth-session.ts`), which reads `headers()` — again, the cookie.

**The cookie is load-bearing everywhere.** This is what forces the remote-URL Capacitor variant (§3.2): only when the WebView's own origin *is* the production https origin do these cookies stay first-party.

### 1.3 `src/proxy.ts` and the mobile well-known paths (blocker resolved; files still missing)

An earlier version of this document found three blockers in the proxy: it redirected `/.well-known/assetlinks.json`, `/.well-known/apple-app-site-association`, `/manifest.webmanifest` and `/sw.js` to `/login`. After RH-65 the proxy only runs for the allow-listed routes in §1.2, so none of those paths is matched any more:

| Path | Proxy runs | Result today |
|---|---|---|
| `/manifest.webmanifest` | no | served by `src/app/manifest.ts` (RH-78) |
| `/sw.js` | no | served from `public/sw.js`, built by `serwist build` (RH-78) |
| `/.well-known/assetlinks.json` | no | not redirected, but **the file does not exist** (no `public/.well-known/`) |
| `/.well-known/apple-app-site-association` | no | not redirected, but **the file does not exist** |

So the TWA verification, Universal Links and PWA-installability blockers are gone. What remains is creating the two association files when a store build exists (§2.2, §3.2). A new private page route does not inherit the proxy redirect; that is a proxy-maintenance rule, not a mobile blocker.

### 1.4 PWA readiness: mostly in place

- **Shipped (RH-78):** `src/app/manifest.ts` (name, `short_name`, `start_url: '/'`, `display: 'standalone'`, `background_color`, `theme_color`), two committed PNG icons `public/icons/icon-192.png` and `public/icons/icon-512.png` (purpose `any`), and a Serwist service worker built from `src/app/sw.ts` to `public/sw.js` as the last stage of `npm run build`, registered by `src/components/layout/ServiceWorkerRegistrar.tsx` in production only. The worker precaches an allow-list (hashed `_next/static`, `public/**`, `/offline`) and never caches authenticated HTML or Server Action POSTs.
- **Still missing:** a `purpose: "maskable"` icon and an `apple-touch-icon` (180); the favicon `src/app/icon.jpg` is still a 182 KB JPEG, and stores need a 1024×1024 PNG without alpha (§5.4).
- **Still missing:** `export const viewport`. `src/app/layout.tsx` exports only `metadata`, so there is no `theme-color` meta and no `viewport-fit=cover`.

That last one is a latent bug, not just a gap: `src/components/tabs/TabDrawingStage.tsx:742-749` renders a safe-area spacer with `height: env(safe-area-inset-bottom, 0px)`. Without `viewport-fit=cover`, `env(safe-area-inset-bottom)` **resolves to `0px`**, so the spacer that keeps the Stage Mode toolbar clear of the iPhone home indicator does nothing on notched devices. Every option fixes this; the `viewport` export fixes it first and cheapest.

### 1.5 Stage Mode — the touch-critical surface

`src/components/tabs/TabDrawingStage.tsx` (788 lines) is the most WebView-sensitive code in the app:

- Unified **Pointer Events** path for mouse/touch/stylus, with `setPointerCapture` / `releasePointerCapture` and an explicit `handleLostPointerCapture` recovery handler (defined at line 490, wired at line 597, with a long comment explaining why a silently-stolen pointer would otherwise make the next single touch read as a pinch).
- Hand-rolled two-finger **pinch-zoom** (`startPinch` at line 346, `updatePinch` at line 359) driving `zoomLevel` plus `scrollLeft`/`scrollTop` on the scroll container.
- `touch-action` is `'none'` while drawing and `'pan-x pan-y'` while reading (`stageTouchAction` in `src/lib/stageInteraction.ts`), applied to the drawing subtree (lines 566-590) and not the stage root, which keeps `'pan-x pan-y'` (line 562), because `touch-action` composes as an intersection down the ancestor chain.
- `overscrollBehavior: 'contain'` on the scroll container (line 571).
- The overlay height comes from a measured `visualViewport.height` (`stageViewportHeight` and `isStableViewportMeasurement` in `src/lib/stageInteraction.ts`, consumed by `src/hooks/usePdfStage.ts`), because `100vh` resolves against the *large* viewport on iOS/Android and pushes the toolbar off screen.
- Canvas is sized by `devicePixelRatio`; strokes are stored as normalised coordinates (`src/lib/annotationMath.ts`) and persisted per page via `saveTabAnnotationsAction`.
- Fast View already keeps the screen awake with the Screen Wake Lock API (`src/hooks/useWakeLock.ts`, called from `src/app/songs/[versionId]/fast-view/page.tsx`).

Almost all of the complexity here — `visualViewport` measurement, `overscroll-behavior`, browser pinch suppression — exists to work around **browser chrome that a native shell does not have**. In a Capacitor shell you can disable WebView bounce and system zoom at the config level, which is strictly more reliable than the current CSS workarounds. Stage Mode is therefore an *argument for* a shell, not against one.

Two gaps worth naming: `pointerType === 'pen'` is never inspected (no occurrence in `src/`), so there is **no palm rejection and no Apple Pencil / S Pen differentiation**; and pressure (`e.pressure`) is unused, so stroke width is a constant `STROKE_WIDTH_PX = 3` (line 54).

### 1.6 PDF handling — same-origin worker (**resolved by RH-19**) and offline copies (RH-79/80)

> **Update — RH-19 is done.** The pdf.js worker is no longer fetched from a CDN.
> `scripts/copy-pdf-worker.mjs` copies it out of `node_modules` into `public/`
> on `postinstall` / `predev` / `prebuild`, and `src/lib/pdfWorker.ts` sets
> `workerSrc` to the same-origin path `` `/pdf.worker.min.mjs?v=${pdfjs.version}` ``.
> The original unpkg dependency was a hard blocker for offline Stage Mode, for
> restrictive-CSP WebViews and for app-store review on throttled networks; that
> prerequisite is met.

Offline PDFs are now handled too: RH-79 writes each downloaded PDF into the `OFFLINE_TAB_CACHE` cache under a synthetic same-origin key (`/__offline-tab/<playlistId>/<tabId>`, see `src/lib/offlineCacheNames.ts`), and the service worker answers that key with a `CacheOnly` route. A chart that was never downloaded fails with Stage Mode's own load-error panel.

PDF files themselves live in **Vercel Blob** as public URLs (`put` in `src/app/actions/tabs.ts:117`). Two places expose a remote URL through `<a target="_blank" rel="noopener noreferrer">`: the tab "open in new tab / download" button (`src/components/fastview/TabList.tsx:60`) and the song links (YouTube, Spotify, chord sites; `src/components/fastview/LinksSection.tsx:54`). In a WebView, `target="_blank"` with no window-open delegate **does nothing** — the buttons are silently dead. A shell must route these to the system browser explicitly.

### 1.7 Uploads, permissions, and other WebView-sensitive APIs

- File inputs, three sites: tab upload `accept={ACCEPTED_UPLOAD_TYPES}` (PDF plus image content types, `src/components/fastview/TabUploadForm.tsx:71`), audio upload `accept={AUDIO_ACCEPT}` (`audio/mpeg,audio/mp4,.mp3,.m4a`, `src/components/fastview/AudioUploadForm.tsx:50`) and band cover `accept="image/*"` (`src/components/bands/CoverPicker.tsx:56`). These work in modern WKWebView and Android WebView, but a native shell must declare `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription` and Android media permissions or the picker fails silently — and Apple rejects missing or boilerplate purpose strings.
- Upload limits are consistent and already mobile-aware: `MAX_FILE_BYTES` of 10 MB (`src/app/actions/tabs.ts:28`, enforced at line 72), `serverActions.bodySizeLimit: '12mb'` in `next.config.ts`, client-side image compression in `src/lib/imageCompressor.ts`. `src/lib/fileIngest.ts:101` sniffs `%PDF-` magic bytes because Android's Storage Access Framework reports unreliable MIME types — evidence the codebase has already met Android WebView quirks.
- **Secure-context-only APIs in use:** `navigator.clipboard.writeText` for the band invite link (`src/hooks/useBandAdmin.ts:215`) and `crypto.randomUUID()` (`TabDrawingStage.tsx:299`, `SongForm.tsx:109`, `SongLinksEditor.tsx:65`). Both work over `https://` and over `capacitor://`, but **both throw on a plain `http://localhost` shell origin**. Stroke creation would break outright. The Screen Wake Lock API is also secure-context only.
- **Spotify OAuth** (`src/app/api/auth/spotify/authorize/route.ts`) does a server redirect to `accounts.spotify.com`, holding CSRF state in an httpOnly `SameSite=Lax` cookie (`spotify_oauth_state`, set at line 25) for 10 minutes, then returns through `src/app/api/auth/spotify/callback/route.ts`. Both Apple and Google require third-party OAuth to run in `ASWebAuthenticationSession` / Chrome Custom Tabs rather than a raw WebView, and Spotify itself blocks embedded-WebView logins. Those surfaces have a **separate cookie jar** from the WebView, so the `SameSite=Lax` state cookie can be dropped on return. This is the most fiddly single integration in a Capacitor build.
- i18n (`src/lib/i18n.ts`, `COOKIE_NAME = 'NEXT_LOCALE'`) persists locale in a cookie — fine in a persistent WebView jar, lost if the shell clears cookies.
- `sentry.client.config.ts` enables Session Replay at 10 % in production (and 100 % on error). This must be disclosed in both stores' privacy forms (§5.3).

---

## 2. Option A — PWA, and PWA + TWA for Play

### 2.1 PWA only (installable, no store listing)

**What it required, and where it stands**

1. Make `/manifest.webmanifest`, `/sw.js` and `/.well-known/*` publicly reachable — **done** by the RH-65 matcher allow-list (§1.3).
2. A web manifest — **done** (`src/app/manifest.ts`, RH-78); it has no `orientation` and no maskable icon.
3. A real PNG icon set — **partly done**: 192 and 512 PNGs exist; a maskable 512 and an `apple-touch-icon` 180 do not (§1.4).
4. `export const viewport` with `themeColor` and `viewportFit: 'cover'` — **not done**; it also repairs the dead safe-area spacer in Stage Mode.
5. A service worker that never caches or replays `Next-Action` POSTs and never serves stale authenticated HTML — **done** (`src/app/sw.ts`, RH-78), with the offline data layer on top (RH-79/80).

**What remains in the repo:** `public/icons/` (maskable and `apple-touch-icon` PNGs), `src/app/manifest.ts` (maskable entry), `src/app/layout.tsx` (viewport export). No change to any action, page, or component logic.

**Remaining effort: XS-S (~1 day).**

**Risks:** low. The main standing risk is service-worker staleness, mitigated by the allow-list precache and `updateViaCache: 'none'` registration.

**What it does *not* buy:** no store listing, no store search discovery, no push on iOS unless the user adds the app to the Home Screen, and no answer to "is it on the App Store?".

### 2.2 PWA + Trusted Web Activity for Google Play (Bubblewrap)

A TWA is a Play-distributable APK/AAB that runs the site full-screen in Chrome with no address bar, provided Digital Asset Links verify.

**What it requires, on top of §2.1:** a Play Console account, an Android signing keystore, `bubblewrap init` from the manifest URL, and `/.well-known/assetlinks.json` served publicly (as a file under `public/.well-known/`) with the SHA-256 fingerprint of the **Play App Signing** key (not the local upload key — a classic mistake). Requires the PWA to pass installability criteria, including a service worker with a fetch handler, which `public/sw.js` has.

**What changes in the repo:** essentially nothing beyond §2.1 plus the `assetlinks.json` file. The Android project is generated and can live outside `src/`.

**Effort: S (~1-2 days) once §2.1 is done**, most of it spent on signing and Play Console paperwork rather than code.

**Risks:** low. Play's "minimum functionality" bar is far more permissive than Apple's, and a TWA of a genuinely useful app is a well-trodden, accepted pattern. Deep links work through the same asset-links mechanism.

**iOS limitation — the decisive one:** *there is no TWA equivalent on iOS.* Apple has never permitted a browser-backed store wrapper. A PWA on iOS can only be installed via Safari's "Add to Home Screen", is invisible to App Store search, historically loses its storage after a period of disuse, and has significantly weaker push support. **Option A cannot put Repertoire Hero on the App Store at all.** If App Store presence is a requirement — and the task says it is — Option A is a foundation, never a destination.

---

## 3. Option B — Capacitor shell

### 3.1 Why the bundled-static-export variant is still ruled out (re-derived against the current code)

Capacitor's default model bundles a static build into the app and serves it from a local origin. That requires `output: "export"`. Re-deriving the conclusion against the code at the Status line:

**Blockers no longer in force**

- `force-dynamic` in the root layout: removed by RH-61; `src/app/layout.tsx` has no `dynamic` export. It is not a reason any more.
- A session-fetching `src/proxy.ts`: since RH-65 the proxy is a header-only redirect convenience with no network call, and authorization lives in the Server Actions and page-level checks, not in the proxy. A static export has no proxy, but losing a redirect convenience would cost a client-side redirect, not a rewrite. It is not a blocker on its own.

**Blockers still in force**

- **Server Actions** (8 modules in `src/app/actions/` plus the root-level binding files) cannot be statically exported; they would all have to become HTTP route handlers or an external API.
- **Dynamic server-rendered pages and route handlers.** `src/app/page.tsx` and the other seven server pages read `headers()`/`cookies()` and call `redirect()`; the 10 `route.ts` handlers (Better Auth catch-all, Spotify OAuth and proxy, dev tooling) need a server. None of that exists in a static export.
- **Cookie auth from a `capacitor://` origin.** Calls from a bundled origin to the remote API are third-party requests, which iOS ITP blocks; auth would have to be re-architected around bearer tokens (the Option C auth work).

That is still not a Capacitor migration; it is Option C with extra steps. **Conclusion: the bundled-static-export variant stays ruled out, now for three blockers instead of five. The Capacitor `server.url` recommendation is unchanged.** (This was derived by reading the code; `next build` with `output: "export"` was not run.)

### 3.2 Remote-URL Capacitor (`server.url`) — the viable variant

Point the shell's `server.url` at the production Vercel deployment. The WebView's origin then *is* `https://<production-host>`, so:

- Better Auth session cookies stay **first-party** — no ITP problem, no auth rewrite;
- Server Actions, the server-rendered pages and `src/proxy.ts` all keep working unchanged;
- `navigator.clipboard`, `crypto.randomUUID()` and the Wake Lock API keep working (secure context);
- deployments ship instantly without a store review, which is a genuine operational advantage.

**What changes in the repo**

- A new `android/` and `ios/` project plus `capacitor.config.ts` (kept out of `src/`).
- `src/lib/auth.ts:45-49`: add the shell origins to `trustedOrigins` if the shell sends an `Origin` other than the production host (verify on device; with `server.url` it is expected to be the production origin, which `NEXT_PUBLIC_APP_URL` already covers).
- The two association files, `public/.well-known/assetlinks.json` and `public/.well-known/apple-app-site-association` (§1.3); the proxy no longer needs a change for them.
- A small client-side shell adapter: intercept `target="_blank"` navigations (`TabList.tsx:60`, `LinksSection.tsx:54`) and route them to `@capacitor/browser` so PDF and external-link buttons are not dead (§1.6).
- Android hardware **back button** handling via `@capacitor/app` — otherwise back exits the app instead of navigating.
- iOS purpose strings and Android media permissions for the three file inputs (§1.7).
- Spotify OAuth reworked to open in `@capacitor/browser` and return via a deep link, with the `spotify_oauth_state` cookie strategy revisited for the split cookie jar.
- Verify the offline layer inside the shell: service workers in WKWebView require App-Bound Domains, so the RH-78/79/80 offline mode may need that configuration or a `@capacitor/filesystem` fallback. This is untested.

**Plugins needed:** `@capacitor/app` (deep links, back button, lifecycle), `@capacitor/browser` (external links + OAuth), `@capacitor/status-bar` and `@capacitor/keyboard` (Stage Mode chrome), `@capacitor/splash-screen`, `@capacitor/haptics`, `@capacitor/preferences`, `@capacitor/share`, `@capacitor/filesystem` (only if the web offline store proves insufficient in the WebView), `@capacitor/push-notifications` if push is wanted.

**Stage Mode in WKWebView vs Android WebView.** This is where a shell *helps*. Both engines support Pointer Events, `setPointerCapture`, `touch-action` and `overscroll-behavior`, so `TabDrawingStage.tsx` should largely work as-is. The shell additionally lets you set `scrollEnabled=false` / disable bounce on WKWebView and disable system zoom, removing the class of problems that `stageViewportHeight` and `isStableViewportMeasurement` currently work around. Two things still need real device testing: iOS edge-swipe-back can steal a pan gesture starting near the screen edge (disable `allowsBackForwardNavigationGestures`), and the `visualViewport` measurement behaves differently with no browser chrome — the existing code falls back to `innerHeight` safely, so this should be a simplification rather than a break. Apple Pencil is exposed as `pointerType === 'pen'`, which the code does not yet read; adding palm rejection here is both a UX win and §3.3 review ammunition.

**Effort: M (~3-5 days) for a working shell on both platforms; L (~2-3 weeks) to reach something that credibly passes Apple review**, because of §3.3.

### 3.3 The real risk: App Store Guideline 4.2 (Minimum Functionality)

Apple explicitly rejects apps that are "simply a song or movie… or a repackaged website". A pure remote-URL shell with zero native capability is the archetypal 4.2 rejection. **Plan for this from the start rather than discovering it after submission.** Credible mitigations, all of which are genuinely useful to a musician on stage:

- **Offline tab access** — the app's core scenario is a stage with no usable network. This is the strongest single argument, and it is **already built in the web layer** (RH-78/79/80: downloadable playlists, cached PDFs, offline Fast View); what remains is making sure it works inside the shell (§3.2).
- **Apple Pencil support** with pressure and palm rejection in Stage Mode — not built.
- **Screen wake lock** so a tab does not sleep mid-song — already built as a web feature (`useWakeLock`); a native plugin is only needed if the WebView does not honour it.
- **Share sheet** integration for tabs and setlists.
- **Push notifications** for band invites and setlist changes.
- Haptics, native splash, status-bar control.

Note that the highest-value items (offline, Pencil) are things the operator plausibly wants regardless of packaging. That is the honest case for Capacitor: the review requirement pushes you toward features you should build anyway.

**Guideline 5.1.1(v) — account deletion — is a hard blocker, and still missing.** A repo-wide search of `src/` for `deleteUser`, `deleteAccount` and `delete-user` finds **nothing**; `src/app/settings/page.tsx` offers no such option. Apple requires any app supporting account creation — which `/signup` does — to offer in-app account deletion. This must be built before the first submission, and it is non-trivial given the schema: `user_songs`, `band_members`, band admin succession, playlists, uploaded song files and their Blob objects, and the band-owned rows whose authorship a deleted member leaves behind. (The `sync_band_repertoire_on_member_update` trigger that earlier made this worse was dropped in RH-96.)

Other risks: Play's more permissive bar means Android will likely pass easily while iOS does not; and a remote-URL app means a bad deploy breaks shipped apps instantly with no rollback via the store.

---

## 4. Option C — React Native / Expo rewrite

**What could genuinely be shared.** The codebase has already extracted its pure logic for testability, which pays off here:

- `src/types/database.ts` — the authoritative domain types.
- `src/lib/statusConfig.ts`, `filterSongs.ts`, `songResolution.ts`, `songStatus.ts`, `bandColors.ts`.
- `src/lib/annotationMath.ts` — normalised stroke coordinates, denormalisation, eraser hit-testing. Renderer-agnostic and ports cleanly.
- `src/lib/stageInteraction.ts` — explicitly documented as DOM-free, though its `touch-action` helpers are CSS-specific and would not apply.
- `src/i18n/dictionaries/*.json` and most of `src/lib/i18n.ts`.
- The Vitest suite covering all of the above.

**What would be rebuilt from zero.**

- Every screen. Nothing in `src/app` or `src/components` survives (the Fast View alone spans `src/app/songs/[versionId]/fast-view/page.tsx`, `src/components/fastview/*` and a dozen hooks), and all Tailwind styling is discarded.
- **A real HTTP API.** All 8 Server Action modules must be reimplemented as authenticated endpoints, since Server Actions cannot be consumed by a native client. This also means duplicating the per-action authorisation checks (guarded today by `src/app/actions/__tests__/actionSessionGuard.test.ts` and `actionAuthorizationGuard.test.ts`) at a new boundary.
- **Auth.** Cookie sessions replaced by Better Auth's Expo/bearer-token flow with secure storage.
- **Offline.** The RH-78/79/80 service-worker and Cache Storage layer does not apply; it would be rebuilt on native storage.
- **PDF rendering plus the annotation canvas — the hard part.** `react-pdf`/pdf.js does not exist in React Native; you would use `react-native-pdf` (native PDFium/PDFKit) for rendering and `react-native-skia` or SVG for strokes, then rebuild the pinch/pan/draw/erase gesture machine on Reanimated + Gesture Handler. `annotationMath.ts` survives; the entire pipeline around it does not. Getting the annotation canvas to stay pixel-aligned with a natively-rendered, zooming PDF page is materially harder than the current DOM overlay, where both layers share one coordinate space.
- The web app still has to exist and be maintained, so this is not a migration — it is a **second client**.

**Effort: XL (~2-3 months solo, with Stage Mode dominating).**

**When it would be justified:** if Stage Mode drawing latency in a WebView proves unacceptable on target devices, if deep native integration (background audio, MIDI, foot pedals, Bluetooth page turners) becomes core, or if the store presence must not depend on a live server. **None of these is demonstrated today.** Decide it with measurements from Option B, not in advance.

---

## 5. Store requirements common to every path

### 5.1 Accounts and fees

| Item | Apple | Google |
|---|---|---|
| Developer account | Apple Developer Program, **$99/year**, recurring | Play Console, **$25 one-time** |
| Identity | Individual, or organisation requiring a D-U-N-S number | Individual or organisation; personal accounts need 12 testers × 14 days closed testing before production |
| Build machine | **macOS required** for local builds (Xcode), or a cloud service (EAS Build, Codemagic) | Any platform |
| Review time | typically 24-48 h, rejections common on 4.2 / 5.1.1 | typically hours-days; new personal accounts slower |

### 5.2 Signing

- **Android:** an upload keystore plus Play App Signing. The **Play App Signing** SHA-256 is the one that must go into `assetlinks.json` — using the upload key is the most common TWA/deep-link failure.
- **iOS:** Apple Developer certificates and provisioning profiles, or `eas credentials` managing them. Universal Links additionally need the Associated Domains entitlement and a correctly served, publicly reachable `apple-app-site-association` (§1.3).

### 5.3 Privacy, data safety, and account deletion

- **Privacy policy URL** is mandatory on both stores. The repo has none — it would need a hosted page.
- **Data disclosure** must cover everything the app actually collects: email and name (Better Auth), band covers and uploaded files (Vercel Blob), uploaded PDFs and handwritten annotations, Spotify account linkage and tokens, plus third-party SDKs — **`@sentry/nextjs` with Session Replay at 10 % in production** (`sentry.client.config.ts`) and `@vercel/analytics`. Session Replay in particular must be disclosed accurately.
- **Apple privacy nutrition labels** and Google's **Data Safety form**, kept in sync with reality.
- **Account deletion (Apple 5.1.1(v)) — currently missing entirely.** See §3.3. This is the single largest functional gap between the app as it exists and an App Store submission, and it applies to the TWA path too if the app is ever also submitted to Apple.

### 5.4 Assets

- Icons: Play needs 512×512 32-bit PNG; Apple needs 1024×1024 PNG, no alpha, no pre-rounded corners; the manifest needs 192/512 plus maskable; iOS needs `apple-touch-icon` at 180. The existing assets are the 192 and 512 PNGs in `public/icons/` (derived from `src/app/icon.jpg`, a 182 KB JPEG) — a higher-resolution source asset is required for the 1024 store icon and the maskable variant.
- Splash screens for both platforms.
- Screenshots: Apple requires 6.7" iPhone (and iPad sizes if the app claims iPad support — which it should, given Stage Mode is tablet-oriented). Play requires phone screenshots plus a 1024×500 feature graphic.
- Store listing copy, in both **pt-BR and en**, matching the app's existing `SUPPORTED_LOCALES` (`src/lib/i18n.ts`).

### 5.5 Release pipeline and the version-bump convention

Existing CI: `.github/workflows/ci.yml` (shared org workflow `node-ci.yml` + Playwright e2e against a Postgres service) and `.github/workflows/pr-label-check.yml`, which requires exactly one of `major` / `minor` / `bugfix` / `skip-release` on every PR. Deployment is Vercel with `ignoreCommand: exit 1` (always build); the build runs `serwist build` last (`package.json` `build` script).

**The version-bump convention needs an explicit mapping, because the current format is not a legal store version.** `AGENTS.md` mandates `X.Y.Z-YYYYMMDDHHmm`; the current value is `0.1.183-202610130947`.

- Apple's `CFBundleShortVersionString` must be **one to three dot-separated integers** — `0.1.183-202610130947` is rejected outright.
- Google's `versionName` is free-form, but `versionCode` must be a **monotonically increasing integer ≤ 2,100,000,000**. The raw timestamp `202610130947` is roughly 100× over that ceiling.

Proposed mapping, derivable mechanically from `package.json` with no change to the AGENTS.md rule:

| Source | iOS | Android |
|---|---|---|
| `X.Y.Z` prefix (`0.1.183`) | `CFBundleShortVersionString` | `versionName` |
| timestamp suffix (`202610130947`) | `CFBundleVersion` (build) | `versionCode`, **compressed** |

For `versionCode`, the timestamp must be reduced to fit — e.g. *minutes elapsed since a fixed project epoch*, which stays monotonic, stays well inside the integer ceiling for centuries, and remains a pure function of the existing version string. A small script in `scripts/` should derive both values so the two never drift from `package.json`.

**Tooling:** **EAS Build + EAS Submit** is the pragmatic choice — it removes the macOS build-machine requirement, manages credentials, and submits to both stores from CI. Fastlane is the alternative if builds stay local. Either way, a `release-mobile.yml` workflow triggered on a version tag, reusing the existing label-driven release convention.

---

## 6. Recommendation

**Recommended path: finish the PWA, build account deletion, then ship a Capacitor shell pointed at the production URL (`server.url`), Android first and iOS second.** Phases:

**Phase 0 — close the remaining PWA gaps (effort XS-S, ~1 day).**
Add the `viewport` export (`themeColor`, `viewportFit: 'cover'`), a maskable icon and an `apple-touch-icon`. The proxy blockers, the manifest, the service worker and the same-origin pdf.js worker (**RH-19**) are already done (§1.3, §1.4). This is worth doing *even if no store app is ever shipped*: it repairs the dead safe-area spacer in Stage Mode and finishes installability.

**Phase 1 — build the remaining App Store blocker (effort M).**
Account deletion (Apple 5.1.1(v), absent today). The other Phase 1 item of the earlier draft, offline tab caching, has shipped (RH-78/79/80). Do this *before* touching Capacitor, so the shell is wrapping an app that can actually pass review.

**Phase 2 — Capacitor shell, remote URL, both stores (effort M-L).**
Ship Android first — Play's bar is lower and it validates the shell, including the offline layer inside the WebView — then iOS with offline, wake lock and Apple Pencil support as the 4.2 argument. A TWA is available as an optional fast-track to Play if store presence is wanted sooner, but since Capacitor covers Android too, it is an accelerator, not a step: retire it once the Capacitor build ships.

**Phase 3 — re-evaluate native.**
Only if Phase 2 produces measured Stage Mode latency or gesture problems that shell configuration cannot fix. Decide with data from real devices, not in advance.

**Why not the alternatives:** Option A alone cannot reach the App Store at all, which fails the stated goal. Option C is a 2-3 month second client whose hardest component (PDF + annotation canvas) would be rebuilt from scratch to solve a performance problem nobody has demonstrated. Option B preserves the entire server architecture — Server Actions, server-rendered pages, the proxy, cookie auth — unchanged, which is exactly what makes it cheap.

### 6.1 Proposed follow-up backlog items

Titles in Portuguese to match the existing backlog convention; justifications in English to match this document.

1. ~~**`Liberar manifest, service worker e /.well-known no proxy de sessão`**~~ — **resolved by RH-65 and RH-78.**
   *The proxy matcher is now an allow-list that does not match `/manifest.webmanifest`, `/sw.js` or `/.well-known/*` (§1.3).*

2. **`Adicionar viewport-fit=cover, ícone maskable e apple-touch-icon`** (reduced from "manifest, icons and viewport"; the manifest, two PNG icons and the service worker exist since RH-78)
   *There is no `viewport` export; adding `viewport-fit=cover` also repairs the `env(safe-area-inset-bottom)` spacer in `TabDrawingStage.tsx:742-749`, which currently resolves to 0px on notched devices.*

3. **`Implementar exclusão de conta do usuário`**
   *Hard blocker for Apple Guideline 5.1.1(v); no deletion logic exists anywhere in `src/`, and band membership, admin succession and Blob files make the data model non-trivial.*

4. ~~**`(Re-priorizar RH-19) Hospedar o worker do pdf.js localmente`**~~ — **resolved by RH-19.**
   *The worker is copied into `public/` by `scripts/copy-pdf-worker.mjs` and served from the app's own origin.*

5. **`Criar shell Capacitor apontando para a URL de produção`**
   *The only Capacitor variant compatible with Server Actions, server-rendered pages and cookie-based Better Auth sessions; includes the `assetlinks.json` and `apple-app-site-association` files, `trustedOrigins` if needed, the Android back button, routing `target="_blank"` links to the system browser, and verifying the offline layer in the WebView.*

6. **`Suportar Apple Pencil e rejeição de palma no Stage Mode`**
   *`pointerType === 'pen'` and `e.pressure` are currently ignored; adds real native value and is direct ammunition against an App Store 4.2 "repackaged website" rejection.*

7. **`Adaptar OAuth do Spotify para Custom Tabs / ASWebAuthenticationSession`**
   *Both stores forbid third-party OAuth in a raw WebView, and the separate cookie jar can drop the `SameSite=Lax` `spotify_oauth_state` cookie set in `api/auth/spotify/authorize`.*

8. **`Derivar versões de loja a partir de package.json`**
   *`0.1.183-202610130947` is not a legal `CFBundleShortVersionString`, and the raw timestamp exceeds Play's `versionCode` ceiling of 2.1e9; a script must derive both values so they never drift from the AGENTS.md convention.*

9. **`Publicar política de privacidade e preencher formulários de privacidade das lojas`**
   *Mandatory on both stores; disclosure must cover Sentry Session Replay at 10% in production, Vercel Analytics, Spotify token linkage, and uploaded PDFs/annotations.*

10. **`Configurar pipeline de release mobile (EAS Build/Submit)`**
    *Removes the macOS build-machine requirement and extends the existing label-driven release convention in `.github/workflows/` to store submissions.*

---

## 7. Out of scope for this document

- **Offline behaviour design** — owned by the offline-mode tasks (RH-28, shipped as RH-78/79/80). This document only establishes how offline relates to each packaging option (§0): it is shipped for the PWA, must be verified inside a Capacitor WebView, and is the strongest answer to Guideline 4.2.
- Push notification architecture, monetisation, ASO, and any implementation work. No code was changed.
