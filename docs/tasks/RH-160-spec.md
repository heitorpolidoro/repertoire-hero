# RH-160 — Scaffold the Trusted Web Activity repo files with placeholders

> **Renamed 2026-10-13** to match its task id. Older text below may describe a "board id + 1" filename rule: that was a mistake copied between specs, not a convention. A spec is always `docs/tasks/<task id>-spec.md`.


Part 1 of the RH-81 split (publish Repertoire Hero to Google Play as a TWA). File is RH-161 by the repo's id+1 filename offset. Everything here is repo-only and merges with PLACEHOLDER values; the operator replaces them later (package id confirmation, signing fingerprint, store assets).

## Scope
Add the committed files a TWA build and Play listing need, and the tests that keep them honest: the Digital Asset Links file, the Bubblewrap manifest, a build/release checklist, listing copy, a public `/privacy` page linked from the landing footer, and ignore rules for signing material and build artifacts.

Not covered: running Bubblewrap, generating a keystore, any real fingerprint, screenshots or feature graphics, Play Console work, Play Billing, changes to `src/app/manifest.ts` or the service worker.

## Approach

### Behavior
- **`public/.well-known/assetlinks.json`** — one statement: relation `delegate_permission/common.handle_all_urls`, `android_app` target, the proposed package id `app.repertoirehero.twa`, and an all-zero 32-byte fingerprint (`00:` x32 form) as the placeholder. It is a static file served at `/.well-known/assetlinks.json`; `src/proxy.ts`'s matcher is an allow-list that does not include it, so no proxy change is needed (a test asserts the path is not matched).
- **`android/twa-manifest.json`** — Bubblewrap manifest: `packageId` (same value), `host` `repertoire-hero.vercel.app`, `name`, `launcherName`, `themeColor`, `backgroundColor`, `startUrl`, `display`, icon URLs under `/icons/`, `signingKey` path pointing at an ignored location. Name/short name/colours/start URL/display are copied from `src/app/manifest.ts`.
- **`android/README.md`** — the release checklist. Every value still to be replaced is marked with the literal word `PLACEHOLDER` (package id confirmation, host, fingerprint, keystore, listing assets). It contains a heading "Why this is not a thin wrapper" naming: installable offline repertoire, Fast View with PDF tablature and Stage Mode, setlist navigation, band shared repertoires. It also states that the package id can never change after the first Play upload.
- **`android/listing.md`** — a `## Short description` (<= 80 chars) and a `## Full description` (<= 4000 chars) section, English, and the privacy policy URL (`/privacy`).
- **`/privacy`** — public Server Component page (`src/app/privacy/page.tsx`), no session lookup, not added to the proxy matcher. Plain static text in the existing dictionary/i18n style (en + pt-BR): what is collected (account email, repertoire data, uploaded files), that it is not sold, how to request deletion. Reuses existing layout/typography; no mock needed.
- **Landing footer** — `LandingPage.tsx` footer gains a link to `/privacy` (dictionary-driven label). `src/app/page.tsx` renders `LandingPage` so the link appears there.
- **`.gitignore`** — `*.keystore`, `*.jks`, `*.aab`, `*.apk` (plus Bubblewrap build output dirs under `android/`).
- **`package.json`** — version bump per AGENTS.md.

### Files touched
- `public/.well-known/assetlinks.json` — new.
- `android/twa-manifest.json`, `android/README.md`, `android/listing.md` — new.
- `src/app/privacy/page.tsx` — new public page.
- `src/components/landing/LandingPage.tsx` — footer link.
- `src/i18n/dictionaries/en.json`, `pt-BR.json` — privacy copy and footer link label.
- `.gitignore`, `package.json`.
- Tests: `src/lib/__tests__/twaAssetLinks.test.ts`, `src/lib/__tests__/twaManifestParity.test.ts`, `src/lib/__tests__/twaListing.test.ts`, `src/lib/__tests__/twaRepoHygiene.test.ts` (git ls-files + .gitignore), plus a LandingPage test for the link and a privacy page render test.

### Test criteria
- assetlinks test checks structure only, so it passes with the all-zero placeholder fingerprint: relation, target namespace, package id equal to the manifest's, >= 1 fingerprint matching `^([0-9A-F]{2}:){31}[0-9A-F]{2}$`.
- Parity test compares `android/twa-manifest.json` with the object returned by `src/app/manifest.ts` on name, short_name, theme_color, background_color, start_url, display.
- Listing test enforces the 80 and 4000 character limits.
- Hygiene test: `git ls-files` has no keystore/jks/aab/apk, and `.gitignore` lists all four patterns.
- README test (in the listing or hygiene test): heading present and the four named features appear.
- `/privacy` and `/.well-known/assetlinks.json` are not matched by the `src/proxy.ts` matcher (extend `proxy.test.ts` or the new test).
- `npm run lint` and the existing guard tests (`actionSessionGuard`, complexity budget) stay green.

## Expected Results
- [ ] ER1 — `twaAssetLinks.test.ts` passes: handle_all_urls relation, android_app target, package id equal to `android/twa-manifest.json`, at least one well-formed fingerprint.
- [ ] ER2 — `twaManifestParity.test.ts` passes: name, short_name, theme_color, background_color, start_url and display agree with `src/app/manifest.ts`.
- [ ] ER3 — `git ls-files` lists no `*.keystore`, `*.jks`, `*.aab` or `*.apk`, and `.gitignore` covers all four patterns.
- [ ] ER4 — `GET /privacy` returns 200 with no session, and the landing footer links to `/privacy`.
- [ ] ER5 — `android/listing.md` has a short description of at most 80 characters and a full description of at most 4000, asserted by a test.
- [ ] ER6 — `android/README.md` has a "Why this is not a thin wrapper" heading naming offline repertoire, Fast View with PDF tablature and Stage Mode, setlist navigation and band shared repertoires.

## Out of Scope
Real signing, fingerprints, store art, Play Console submission (later parts of RH-81).
