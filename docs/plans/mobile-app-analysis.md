# RH-30 — Shipping Repertoire Hero on Google Play and the Apple App Store

**Type:** analysis / decision document. No code changes.
**Question:** what does it actually take to publish Repertoire Hero as a mobile app on both stores?
**Answer, in one line:** harden the web app into a real PWA first (it is currently *not* one), then wrap it with **Capacitor pointed at the deployed URL** for both stores. A native rewrite is not justified today.

Every claim below is grounded in the code as of `v0.1.50-202609012115`. File and line references are literal.

---

## 1. Current-state inventory

### 1.1 Rendering model — an SPA that happens to use Server Actions

This is the single most important fact for every option below, and it cuts both ways.

- `src/app/layout.tsx:10` declares `export const dynamic = "force-dynamic"`, globally disabling static prerendering for every route. The comment explains why: prerendering `/_not-found` crashed because `better-auth/react` hooks are unavailable in the server context.
- `next.config.ts` sets `output: process.env.VERCEL ? undefined : "standalone"` — never `"export"`.
- Only **three** modules in `src/app` are true React Server Components:
  - `src/app/layout.tsx`
  - `src/app/songs/search/page.tsx`
  - `src/app/join/[code]/page.tsx`

  Every other page — including `src/app/page.tsx` (626 lines) and `src/app/songs/[id]/fast-view/page.tsx` (1566 lines) — begins with `'use client'`.
- All reads and writes go through Server Actions in `src/app/actions/*.ts` (7 modules: `bands`, `moderation`, `playlists`, `profile`, `repertoire`, `tabs`), called directly from client components. Route handlers under `src/app/api/**` cover only auth, Spotify OAuth/proxy, and dev tooling.

**Consequence (positive):** the UI is already a client-side SPA with a narrow, explicit server boundary — 7 action modules plus 9 route handlers. There is very little RSC streaming to preserve, so a WebView shell will behave much like the browser does today.

**Consequence (negative):** Server Actions are **not an API**. They are a Next.js-runtime-bound RPC: the client posts to the same origin with a `Next-Action` header carrying a build-specific action ID. They cannot be called from a React Native client, cannot be statically exported, and cannot be served from a bundled `file://` origin. Combined with `force-dynamic` and the middleware, **`output: "export"` is structurally impossible** without deleting the entire server layer. This eliminates the "bundled static export" variant of Capacitor outright — see §3.2.

### 1.2 Auth and session mechanics

Note: despite `NEXT_PUBLIC_SUPABASE_*` entries still sitting in `.env.example` and the `@supabase/*` packages still in `package.json`, **the app does not use Supabase Auth**. `AGENTS.md` documents these as historical leftovers, and the code confirms it.

- `src/lib/auth.ts` configures **Better Auth** directly against the `pg` pool. Email/password only; no social login.
- Sessions are **cookie-based**. No `advanced.cookies` / `sameSite` / `crossSubDomain` configuration is present, so Better Auth defaults apply (httpOnly, `SameSite=Lax`, `Secure` in production) — i.e. **first-party, same-origin cookies**.
- `src/lib/auth-client.ts` derives its `baseURL` from `window.location.origin` at runtime.
- `src/lib/auth.ts:19-23` sets a **hardcoded `trustedOrigins`** list: `http://localhost:3000`, `http://127.0.0.1:3000`, plus `NEXT_PUBLIC_APP_URL`. Any new shell origin (`capacitor://localhost`, `http://localhost`) would be rejected.
- `src/proxy.ts` (Next.js middleware) gates **every** non-public request by `fetch`-ing `/api/auth/get-session` with the caller's forwarded `cookie` header, with a 3 s abort timeout, and redirects to `/login` on failure.
- Server Actions authorise via `getRequiredUserId()` (`src/lib/auth-session.ts`), which reads `headers()` — again, the cookie.

**The cookie is load-bearing everywhere.** This is what forces the remote-URL Capacitor variant (§3.2): only when the WebView's own origin *is* the production https origin do these cookies stay first-party.

### 1.3 Three concrete blockers hiding in `src/proxy.ts`

The middleware `matcher` excludes `_next/static`, `_next/image`, `favicon.ico`, and files ending in `.svg|.png|.jpg|.jpeg|.gif|.webp`. `PUBLIC_PATHS` is `['/login', '/signup', '/forgot-password', '/reset-password', '/api/auth/', '/api/dev/', '/join/']`, plus `/` itself.

Simulating that matcher and the `isPublicPath` test against the paths every mobile path needs:

| Path | Middleware runs | `isPublicPath` | Result today |
|---|---|---|---|
| `/.well-known/assetlinks.json` | yes | no | **302 → `/login`** |
| `/.well-known/apple-app-site-association` | yes | no | **302 → `/login`** |
| `/manifest.webmanifest` | yes | no | **302 → `/login`** |
| `/sw.js` | yes | no | **302 → `/login`** |
| `/icon-512.png` | no (extension excluded) | — | ok |

So, as the code stands:

1. **TWA / Digital Asset Links verification would fail** — Chrome fetches `assetlinks.json` anonymously and would receive a redirect to the login page. The TWA would launch with a browser address bar visible, which is exactly the failure mode Bubblewrap users hit.
2. **iOS Universal Links would fail** — Apple's CDN fetches `apple-app-site-association` anonymously; same redirect.
3. **The PWA would not be installable for logged-out visitors** — `/` is public and renders `LandingPage`, but the manifest fetch from that page redirects to `/login`, so no `manifest` is parsed and no install prompt appears. Service-worker registration at `/sw.js` fails for the same reason.

Icons are safe by accident (the `.png` extension is excluded from the matcher). This is a small, cheap fix, but it is a prerequisite for *every* option and it is invisible until you try to ship.

### 1.4 PWA readiness: effectively zero

- `public/` contains only the five unmodified Next.js template SVGs: `file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`.
- **No** `manifest.json` / `manifest.webmanifest`. **No** service worker. **No** PWA icon set, no `apple-touch-icon`.
- The only app icon is `src/app/icon.jpg` — a **182 KB JPEG** using Next's file convention. Stores need PNG; Play needs a 512×512 32-bit PNG, Apple needs 1024×1024 with no alpha and no rounded corners. A manifest needs a maskable variant. None of this exists.
- `src/app/layout.tsx:22-25` exports `metadata` with only `title` and `description`. There is **no `export const viewport`** anywhere in the repo, so there is no `theme-color` and, critically, no `viewport-fit=cover`.

That last one is a latent bug, not just a gap: `src/components/tabs/TabDrawingStage.tsx:779` already renders a safe-area spacer with `height: env(safe-area-inset-bottom, 0px)`. Without `viewport-fit=cover` in the viewport meta, `env(safe-area-inset-bottom)` **resolves to `0px`**. The spacer that Stage Mode relies on to keep the toolbar clear of the iPhone home indicator is currently doing nothing on notched devices. Any of the three options fixes this, but PWA hardening fixes it first and cheapest.

### 1.5 Stage Mode — the touch-critical surface

`src/components/tabs/TabDrawingStage.tsx` (817 lines) is the most WebView-sensitive code in the app:

- Unified **Pointer Events** path for mouse/touch/stylus, with `setPointerCapture` / `releasePointerCapture` and an explicit `onLostPointerCapture` recovery handler (lines 487-497, with a long comment explaining why a silently-stolen pointer would otherwise make the next single touch read as a pinch).
- Hand-rolled two-finger **pinch-zoom** (`startPinch` / `updatePinch`, lines 340-370) driving `zoomLevel` plus `scrollLeft`/`scrollTop` on the scroll container.
- `touch-action` is `'none'` while drawing and `'pan-x pan-y'` while reading (`stageTouchAction` in `src/lib/stageInteraction.ts`), deliberately applied to the drawing subtree only, never the stage root — the comment at lines 546-556 explains that `touch-action` composes as an intersection down the ancestor chain.
- `overscrollBehavior: 'contain'` on the scroll container and the overlay root.
- The overlay height comes from a measured `visualViewport.height` (`stageViewportHeight`, `isStableViewportMeasurement`), because `100vh` resolves against the *large* viewport on iOS/Android and pushes the toolbar off screen.
- Canvas is sized by `devicePixelRatio`; strokes are stored as normalised coordinates (`src/lib/annotationMath.ts`) and persisted per page via `jsonb_set` in `saveTabAnnotationsAction`.

Almost all of the complexity here — `visualViewport` measurement, `overscroll-behavior`, browser pinch suppression — exists to work around **browser chrome that a native shell does not have**. In a Capacitor shell you can disable WebView bounce and system zoom at the config level, which is strictly more reliable than the current CSS workarounds. Stage Mode is therefore an *argument for* a shell, not against one.

Two gaps worth naming: `pointerType === 'pen'` is never inspected, so there is **no palm rejection and no Apple Pencil / S Pen differentiation**; and pressure (`e.pressure`) is unused, so stroke width is a constant `STROKE_WIDTH_PX = 3`.

### 1.6 PDF handling — a hard external CDN dependency (**resolved by RH-19**)

> **Update — RH-19 is done.** The pdf.js worker is no longer fetched from a CDN.
> `scripts/copy-pdf-worker.mjs` copies it out of `node_modules` into `public/`
> on `postinstall` / `predev` / `prebuild`, and `src/lib/pdfWorker.ts` now sets
> `workerSrc` to the same-origin path `` `/pdf.worker.min.mjs?v=${pdfjs.version}` ``.
> Everything below describes the situation *before* that change and is kept as
> the rationale for it.

`src/lib/pdfWorker.ts:17`, at the time of this analysis:

```ts
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
```

The pdf.js worker was fetched from **unpkg at render time**. The file comment explained the reasoning (dual-bundler constraint: Webpack in dev, Turbopack in build). The consequences for mobile were severe:

- Stage Mode could not render **any** PDF offline — this alone would defeat RH-29.
- On a bad venue network (the exact scenario Stage Mode exists for), tabs failed to load.
- A TWA or a hardened WebView with a restrictive CSP blocks the cross-origin worker.
- App-store reviewers on throttled networks may see a broken core feature.

**`RH-19` ("Hospedar o worker do pdf.js localmente em vez de CDN externa") covered exactly this and has shipped.** It was a prerequisite for every option here and for RH-29; that prerequisite is now met. RH-29 still has to add the service worker and offline storage — RH-19 only removed the third-party blocker.

PDF files themselves live in **Vercel Blob** as public URLs (`src/app/actions/tabs.ts:65-70`), and `src/app/songs/[id]/fast-view/page.tsx:904` exposes them via `<a target="_blank" rel="noopener noreferrer">`. In a WebView, `target="_blank"` with no window-open delegate **does nothing** — the button is silently dead. Same for the external song links at line 1067 (YouTube, Spotify, chord sites). A shell must route these to the system browser explicitly.

### 1.7 Uploads, permissions, and other WebView-sensitive APIs

- File inputs: `accept="application/pdf"` for tabs (`fast-view/page.tsx:1007`); `accept="image/*"` at three sites (`bands/page.tsx:176`, `profile/page.tsx:519`, `bands/[id]/page.tsx:588`). These work in modern WKWebView and Android WebView, but a native shell must declare `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription` and Android media permissions or the picker fails silently — and Apple rejects missing or boilerplate purpose strings.
- Upload limits are consistent and already mobile-aware: 10 MB check in `tabs.ts:42`, `serverActions.bodySizeLimit: '12mb'` in `next.config.ts`, client-side image compression in `src/lib/imageCompressor.ts`. `tabs.ts:54` even sniffs `%PDF-` magic bytes because Android's Storage Access Framework reports unreliable MIME types — evidence the codebase has already met Android WebView quirks.
- **Secure-context-only APIs in use:** `navigator.clipboard.writeText` for invite links (`bands/[id]/page.tsx:100`, `profile/page.tsx:94`) and `crypto.randomUUID()` (`TabDrawingStage.tsx:298`, `SongForm.tsx:59,154`). Both work over `https://` and over `capacitor://`, but **both throw on a plain `http://localhost` shell origin**. Stroke creation would break outright.
- **Spotify OAuth** (`src/app/api/auth/spotify/authorize/route.ts`) does a server redirect to `accounts.spotify.com`, holding CSRF state in an httpOnly `SameSite=Lax` cookie for 10 minutes, then returns to `SPOTIFY_REDIRECT_URI` and finally `/playlists`. Both Apple and Google require third-party OAuth to run in `ASWebAuthenticationSession` / Chrome Custom Tabs rather than a raw WebView, and Spotify itself blocks embedded-WebView logins. Those surfaces have a **separate cookie jar** from the WebView, so the `SameSite=Lax` state cookie can be dropped on return. This is the most fiddly single integration in a Capacitor build.
- i18n (`src/lib/i18n.ts`) persists locale in a `NEXT_LOCALE` cookie — fine in a persistent WebView jar, lost if the shell clears cookies.
- `sentry.client.config.ts` enables Session Replay at 10 % in production. This must be disclosed in both stores' privacy forms (§4.3).

---

## 2. Option A — PWA, and PWA + TWA for Play

### 2.1 PWA only (installable, no store listing)

**What it requires**

1. Fix `src/proxy.ts` so `/manifest.webmanifest`, `/sw.js` and `/.well-known/*` are publicly reachable (§1.3).
2. Add `public/manifest.webmanifest`: name, short_name, `start_url`, `display: "standalone"`, `background_color`, `theme_color`, `orientation`, and an icon array including a `purpose: "maskable"` entry.
3. Generate a real PNG icon set (192, 512, maskable 512, `apple-touch-icon` 180) from a redrawn source — `src/app/icon.jpg` is a JPEG and unusable as-is.
4. Add `export const viewport` to `src/app/layout.tsx` with `themeColor` and `viewportFit: 'cover'` — which also repairs the dead safe-area spacer in Stage Mode (§1.4).
5. A service worker. This is the subtle part, not a drop-in: with `force-dynamic` everywhere and Server Actions as the write path, the SW must **never** cache or replay `POST` requests carrying `Next-Action`, and must not serve stale HTML for authenticated routes. A conservative first SW should handle the app shell, static assets, and the pdf.js worker (after RH-19), and stay out of the data path entirely. Real data caching belongs to **RH-29**, not here.

**What changes in the repo:** `public/` (manifest + icons), `src/app/layout.tsx` (viewport export), `src/proxy.ts` (public paths), one new SW file plus registration. No change to any action, page, or component logic.

**Effort: S (~1-2 days).** Small, mechanical, and entirely additive. The SW is the only design decision.

**Risks:** low. Main risk is an over-eager service worker serving stale authenticated HTML or breaking Server Actions — mitigated by keeping the SW out of the data path in v1.

**What it does *not* buy:** no store listing, no store search discovery, no push on iOS unless the user manually adds to Home Screen, and no answer to "is it on the App Store?".

### 2.2 PWA + Trusted Web Activity for Google Play (Bubblewrap)

A TWA is a Play-distributable APK/AAB that runs the site full-screen in Chrome with no address bar, provided Digital Asset Links verify.

**What it requires, on top of §2.1:** a Play Console account, an Android signing keystore, `bubblewrap init` from the manifest URL, and `/.well-known/assetlinks.json` served publicly with the SHA-256 fingerprint of the **Play App Signing** key (not the local upload key — a classic mistake). Requires the PWA to pass installability criteria, including a service worker with a fetch handler.

**What changes in the repo:** essentially nothing beyond §2.1 plus the `assetlinks.json` file. The Android project is generated and can live outside `src/`.

**Effort: S (~1-2 days) once §2.1 is done**, most of it spent on signing and Play Console paperwork rather than code.

**Risks:** low-moderate. The asset-links redirect problem in §1.3 is the one real trap. Play's "minimum functionality" bar is far more permissive than Apple's, and a TWA of a genuinely useful app is a well-trodden, accepted pattern. Deep links work through the same asset-links mechanism.

**iOS limitation — the decisive one:** *there is no TWA equivalent on iOS.* Apple has never permitted a browser-backed store wrapper. A PWA on iOS can only be installed via Safari's "Add to Home Screen", is invisible to App Store search, historically loses its storage after a period of disuse, and has significantly weaker push support. **Option A cannot put Repertoire Hero on the App Store at all.** If App Store presence is a requirement — and the task says it is — Option A is a foundation, never a destination.

---

## 3. Option B — Capacitor shell

### 3.1 Why the bundled-static-export variant is impossible

Capacitor's default model bundles a static build into the app and serves it from a local origin. That requires `output: "export"`, which requires:

- removing `export const dynamic = "force-dynamic"` from the root layout (`src/app/layout.tsx:10`), which exists to prevent a real prerender crash;
- replacing all 7 Server Action modules with HTTP route handlers, because Server Actions cannot be statically exported;
- deleting `src/proxy.ts`, because middleware does not exist in a static export;
- re-architecting auth, because cookies to a remote API from a `capacitor://` origin are third-party and blocked by ITP on iOS.

That is not a Capacitor migration; it is Option C with extra steps. **Rule it out.**

### 3.2 Remote-URL Capacitor (`server.url`) — the viable variant

Point the shell's `server.url` at the production Vercel deployment. The WebView's origin then *is* `https://<production-host>`, so:

- Better Auth session cookies stay **first-party** — no ITP problem, no auth rewrite;
- Server Actions, `force-dynamic` and `src/proxy.ts` all keep working unchanged;
- `navigator.clipboard` and `crypto.randomUUID()` keep working (secure context);
- deployments ship instantly without a store review, which is a genuine operational advantage.

**What changes in the repo**

- A new `android/` and `ios/` project plus `capacitor.config.ts` (kept out of `src/`).
- `src/lib/auth.ts:19-23`: add the shell origins to `trustedOrigins`.
- `src/proxy.ts`: public paths for `/.well-known/apple-app-site-association` and `assetlinks.json` (§1.3).
- A small client-side shell adapter: intercept `target="_blank"` navigations (`fast-view/page.tsx:904`, `:1067`) and route them to `@capacitor/browser` so PDF and external-link buttons are not dead (§1.6).
- Android hardware **back button** handling via `@capacitor/app` — otherwise back exits the app instead of navigating.
- iOS purpose strings and Android media permissions for the four file inputs (§1.7).
- Spotify OAuth reworked to open in `@capacitor/browser` and return via a deep link, with the `spotify_oauth_state` cookie strategy revisited for the split cookie jar.

**Plugins needed:** `@capacitor/app` (deep links, back button, lifecycle), `@capacitor/browser` (external links + OAuth), `@capacitor/status-bar` and `@capacitor/keyboard` (Stage Mode chrome), `@capacitor/splash-screen`, `@capacitor/haptics`, `@capacitor/preferences`, `@capacitor/share`, `@capacitor/filesystem` (offline tab cache, for RH-29), `@capacitor/push-notifications` if push is wanted.

**Stage Mode in WKWebView vs Android WebView.** This is where a shell *helps*. Both engines support Pointer Events, `setPointerCapture`, `touch-action` and `overscroll-behavior`, so `TabDrawingStage.tsx` should largely work as-is. The shell additionally lets you set `scrollEnabled=false` / disable bounce on WKWebView and disable system zoom, removing the class of problems that `stageViewportHeight` and `isStableViewportMeasurement` currently work around. Two things still need real device testing: iOS edge-swipe-back can steal a pan gesture starting near the screen edge (disable `allowsBackForwardNavigationGestures`), and the `visualViewport` measurement behaves differently with no browser chrome — the existing code falls back to `innerHeight` safely, so this should be a simplification rather than a break. Apple Pencil is exposed as `pointerType === 'pen'`, which the code does not yet read; adding palm rejection here is both a UX win and §3.3 review ammunition.

**Effort: M (~3-5 days) for a working shell on both platforms; L (~2-3 weeks) to reach something that credibly passes Apple review**, because of §3.3.

### 3.3 The real risk: App Store Guideline 4.2 (Minimum Functionality)

Apple explicitly rejects apps that are "simply a song or movie… or a repackaged website". A pure remote-URL shell with zero native capability is the archetypal 4.2 rejection. **Plan for this from the start rather than discovering it after submission.** Credible mitigations, all of which are genuinely useful to a musician on stage:

- **Offline tab access** via `@capacitor/filesystem` — the app's core scenario is a stage with no usable network. This is the strongest single argument, and it converges exactly with **RH-29**.
- **Apple Pencil support** with pressure and palm rejection in Stage Mode.
- **Screen wake lock** so a tab does not sleep mid-song.
- **Share sheet** integration for tabs and setlists.
- **Push notifications** for band invites and setlist changes.
- Haptics, native splash, status-bar control.

Note that the two highest-value items (offline, Pencil) are things the operator plausibly wants regardless of packaging. That is the honest case for Capacitor: the review requirement pushes you toward features you should build anyway.

**Guideline 5.1.1(v) — account deletion — is a hard blocker.** A repo-wide search for account-deletion logic finds **nothing** in application code (the only match is a `deleteUser` stub in `src/lib/__tests__/test-helpers.ts:204`). `src/app/settings/page.tsx` offers no such option. Apple requires any app supporting account creation — which `/signup` does — to offer in-app account deletion. This must be built before the first submission, and it is non-trivial given the schema: `profiles`, `repertoire`, `band_members`, band admin succession, and the `sync_band_repertoire_on_member_update` trigger that recomputes band aggregate status as the MIN across members. Deleting a member changes other users' visible data.

Other risks: Play's more permissive bar means Android will likely pass easily while iOS does not; and a remote-URL app means a bad deploy breaks shipped apps instantly with no rollback via the store.

---

## 4. Option C — React Native / Expo rewrite

**What could genuinely be shared.** The codebase has already extracted its pure logic for testability, which pays off here:

- `src/types/database.ts` — the authoritative domain types.
- `src/lib/statusConfig.ts`, `filterSongs.ts`, `songSanitizer.ts`, `bandColors.ts`.
- `src/lib/annotationMath.ts` — normalised stroke coordinates, denormalisation, eraser hit-testing. Renderer-agnostic and ports cleanly.
- `src/lib/stageInteraction.ts` — explicitly documented as DOM-free ("must not import from react/react-dom and must not touch window or document"), though its `touch-action` helpers are CSS-specific and would not apply.
- `src/i18n/dictionaries/*.json` and most of `src/lib/i18n.ts`.
- The Vitest suite covering all of the above.

**What would be rebuilt from zero.**

- Every screen. `src/app/songs/[id]/fast-view/page.tsx` (1566 lines) and `src/app/page.tsx` (626 lines) are two files carrying most of the product; nothing in `src/app` or `src/components` survives, and all Tailwind styling is discarded.
- **A real HTTP API.** All 7 Server Action modules must be reimplemented as authenticated endpoints, since Server Actions cannot be consumed by a native client. This also means duplicating the authorisation checks (e.g. `checkAccess` in `tabs.ts:11-26`) at a new boundary.
- **Auth.** Cookie sessions replaced by Better Auth's Expo/bearer-token flow with secure storage.
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
- **Data disclosure** must cover everything the app actually collects: email and name (Better Auth), profile photos and band covers (Vercel Blob), uploaded PDFs and handwritten annotations, Spotify account linkage and tokens, plus third-party SDKs — **`@sentry/nextjs` with Session Replay at 10 % in production** (`sentry.client.config.ts`) and `@vercel/analytics`. Session Replay in particular must be disclosed accurately.
- **Apple privacy nutrition labels** and Google's **Data Safety form**, kept in sync with reality.
- **Account deletion (Apple 5.1.1(v)) — currently missing entirely.** See §3.3. This is the single largest functional gap between the app as it exists and an App Store submission, and it applies to the TWA path too if the app is ever also submitted to Apple.

### 5.4 Assets

- Icons: Play needs 512×512 32-bit PNG; Apple needs 1024×1024 PNG, no alpha, no pre-rounded corners; the manifest needs 192/512 plus maskable; iOS needs `apple-touch-icon` at 180. The only existing asset is `src/app/icon.jpg`, a 182 KB **JPEG** — a new source asset is required.
- Splash screens for both platforms.
- Screenshots: Apple requires 6.7" iPhone (and iPad sizes if the app claims iPad support — which it should, given Stage Mode is tablet-oriented and RH-28 was driven by tablet testing). Play requires phone screenshots plus a 1024×500 feature graphic.
- Store listing copy, in both **pt-BR and en**, matching the app's existing `SUPPORTED_LOCALES` (`src/lib/i18n.ts`).

### 5.5 Release pipeline and the version-bump convention

Existing CI: `.github/workflows/ci.yml` (shared org workflow + Playwright e2e against a Postgres service) and `.github/workflows/pr-label-check.yml`, which requires exactly one of `major` / `minor` / `bugfix` / `skip-release` on every PR. Deployment is Vercel with `ignoreCommand: exit 1` (always build).

**The version-bump convention needs an explicit mapping, because the current format is not a legal store version.** `AGENTS.md` mandates `X.Y.Z-YYYYMMDDHHmm`; the current value is `0.1.50-202609012115`.

- Apple's `CFBundleShortVersionString` must be **one to three dot-separated integers** — `0.1.50-202609012115` is rejected outright.
- Google's `versionName` is free-form, but `versionCode` must be a **monotonically increasing integer ≤ 2,100,000,000**. The raw timestamp `202609012115` is roughly 100× over that ceiling.

Proposed mapping, derivable mechanically from `package.json` with no change to the AGENTS.md rule:

| Source | iOS | Android |
|---|---|---|
| `X.Y.Z` prefix (`0.1.50`) | `CFBundleShortVersionString` | `versionName` |
| timestamp suffix (`202609012115`) | `CFBundleVersion` (build) | `versionCode`, **compressed** |

For `versionCode`, the timestamp must be reduced to fit — e.g. *minutes elapsed since a fixed project epoch*, which stays monotonic, stays well inside the integer ceiling for centuries, and remains a pure function of the existing version string. A small script in `scripts/` should derive both values so the two never drift from `package.json`.

**Tooling:** **EAS Build + EAS Submit** is the pragmatic choice — it removes the macOS build-machine requirement, manages credentials, and submits to both stores from CI. Fastlane is the alternative if builds stay local. Either way, a `release-mobile.yml` workflow triggered on a version tag, reusing the existing label-driven release convention.

---

## 6. Recommendation

**Phase 0 — PWA hardening + prerequisites (effort S, ~1 week).**
Fix `src/proxy.ts`, add manifest, viewport export, and a real icon set; **RH-19** (local pdf.js worker) is already done. This is worth doing *even if no store app is ever shipped*: it makes the app installable, repairs the dead safe-area spacer in Stage Mode, and — via RH-19 — removes the CDN dependency that made offline impossible. It is also an unavoidable prerequisite for every other option.

**Phase 1 — build the two blockers (effort M).**
Account deletion (Apple 5.1.1(v), currently absent) and offline tab caching (**RH-29**). Both are required for an App Store submission to have any chance, and both are features the operator wants independently of packaging. Do these *before* touching Capacitor, so the shell is wrapping an app that can actually pass review.

**Phase 2 — Capacitor shell, remote URL, both stores (effort M-L).**
Ship Android first — Play's bar is lower and it validates the shell — then iOS with the Phase 1 features plus Apple Pencil support and wake lock as the 4.2 argument. A TWA is available as an optional fast-track to Play if store presence is wanted sooner, but since Capacitor covers Android too, it is an accelerator, not a step: retire it once the Capacitor build ships.

**Phase 3 — re-evaluate native.**
Only if Phase 2 produces measured Stage Mode latency or gesture problems that shell configuration cannot fix. Decide with data from real devices, not in advance.

**Why not the alternatives:** Option A alone cannot reach the App Store at all, which fails the stated goal. Option C is a 2-3 month second client whose hardest component (PDF + annotation canvas) would be rebuilt from scratch to solve a performance problem nobody has demonstrated. Option B preserves the entire server architecture — Server Actions, `force-dynamic`, middleware, cookie auth — unchanged, which is exactly what makes it cheap.

### 6.1 Proposed follow-up backlog items

Titles in Portuguese to match the existing backlog convention (RH-1…RH-29); justifications in English to match this document.

1. **`Liberar manifest, service worker e /.well-known no proxy de sessão`**
   *`src/proxy.ts` currently 302s `/manifest.webmanifest`, `/sw.js`, `assetlinks.json` and `apple-app-site-association` to `/login`, which silently breaks PWA installability, TWA verification and iOS Universal Links.*

2. **`Adicionar manifest PWA, ícones e viewport-fit=cover`**
   *No manifest, no service worker and no PNG icon set exist; adding `viewport-fit=cover` also repairs the `env(safe-area-inset-bottom)` spacer in `TabDrawingStage.tsx:779`, which currently resolves to 0px on notched devices.*

3. **`Implementar exclusão de conta do usuário`**
   *Hard blocker for Apple Guideline 5.1.1(v); no deletion logic exists anywhere in application code, and the band-membership trigger makes the data model non-trivial.*

4. ~~**`(Re-priorizar RH-19) Hospedar o worker do pdf.js localmente`**~~ — **resolved by RH-19.**
   *The CDN worker that made offline Stage Mode impossible is gone: the worker is now copied into `public/` by `scripts/copy-pdf-worker.mjs` and served from the app's own origin. The prerequisite this item represented for RH-29 and every mobile path is satisfied.*

5. **`Criar shell Capacitor apontando para a URL de produção`**
   *The only Capacitor variant compatible with `force-dynamic`, Server Actions and cookie-based Better Auth sessions; includes `trustedOrigins`, the Android back button, and routing `target="_blank"` links to the system browser.*

6. **`Suportar Apple Pencil e rejeição de palma no Stage Mode`**
   *`pointerType === 'pen'` and `e.pressure` are currently ignored; adds real native value and is direct ammunition against an App Store 4.2 "repackaged website" rejection.*

7. **`Adaptar OAuth do Spotify para Custom Tabs / ASWebAuthenticationSession`**
   *Both stores forbid third-party OAuth in a raw WebView, and the separate cookie jar can drop the `SameSite=Lax` `spotify_oauth_state` cookie set in `api/auth/spotify/authorize`.*

8. **`Derivar versões de loja a partir de package.json`**
   *`0.1.50-202609012115` is not a legal `CFBundleShortVersionString`, and the raw timestamp exceeds Play's `versionCode` ceiling of 2.1e9; a script must derive both values so they never drift from the AGENTS.md convention.*

9. **`Publicar política de privacidade e preencher formulários de privacidade das lojas`**
   *Mandatory on both stores; disclosure must cover Sentry Session Replay at 10% in production, Vercel Analytics, Spotify token linkage, and uploaded PDFs/annotations.*

10. **`Configurar pipeline de release mobile (EAS Build/Submit)`**
    *Removes the macOS build-machine requirement and extends the existing label-driven release convention in `.github/workflows/` to store submissions.*

---

## 7. Out of scope for this document

- **Offline behaviour design** — owned by **RH-29**. This document only establishes how offline relates to each packaging option: it is optional for a PWA, and effectively mandatory for an App Store submission because it is the strongest answer to Guideline 4.2.
- Push notification architecture, monetisation, ASO, and any implementation work. No code was changed.
