# RH-81 — Publish Repertoire Hero to Google Play as a Trusted Web Activity

> **Renamed 2026-10-13** to match its task id. Older text below may describe a "board id + 1" filename rule: that was a mistake copied between specs, not a convention. A spec is always `docs/tasks/<task id>-spec.md`.


> **Filename mapping.** Board task **RH-81**, written to `docs/tasks/RH-81-spec.md` (spec filename = board id + 1 in this repository). `RH-80-spec.md` is RH-80's spec.

Builds on RH-78 (PWA shell, `src/app/manifest.ts`, `src/app/sw.ts`) and RH-80 (offline Fast View). No UI mock: the only UI is one static text page.

## Scope

A TWA is a thin Android shell around the production PWA, so this task splits cleanly into what **the repository delivers and CI verifies** (Part A) and what **only the operator can do** (Part B: Play Console, signing keys, a physical device). The task is done when both parts are done; the repo PR may merge after Part A, and Part B is recorded on the task as evidence.

Not covered: iOS, a native-code feature, push notifications, Play billing, a production-track rollout (internal testing only), automating AAB builds in CI, localising the listing beyond English and pt-BR.

## Approach

### Part A — repository deliverables

1. **Digital Asset Links.** `public/.well-known/assetlinks.json` is a static file served by Vercel with `content-type: application/json`. It holds one statement with relation `delegate_permission/common.handle_all_urls`, target `android_app`, the chosen package id, and `sha256_cert_fingerprints` listing the **Play app-signing certificate** fingerprint (Play Console -> App integrity) and, optionally, the upload key. The signing fingerprint exists only after the app is created in Play Console, so the operator supplies it (Part B step 2) before this file is committed. Verify that nothing in `src/proxy.ts` or the `sw.ts` navigation fallback intercepts `/.well-known/`; if the worker's fallback would serve `/offline` for it, exclude the path.
2. **Guard test** `src/lib/__tests__/twaAssetLinks.test.ts` (node environment): parses the file, asserts the relation, `android_app` target, a package id equal to the one in `twa-manifest.json`, and every fingerprint matching `^([0-9A-F]{2}:){31}[0-9A-F]{2}$` with at least one present.
3. **Bubblewrap project definition.** Commit `android/twa-manifest.json` (host, `startUrl`, `name`, `launcherName`, `packageId`, `themeColor`, `backgroundColor`, `display: standalone`, icon URLs, `appVersionName`/`appVersionCode`, `enableNotifications: false`, `signingKey.path` pointing at a gitignored keystore path) plus `android/README.md` documenting the exact reproducible commands: `bubblewrap init --manifest=https://<host>/manifest.webmanifest`, `bubblewrap build`, `bubblewrap fingerprint`, and how to bump `appVersionCode` per upload. Generated Gradle output, `*.aab`, `*.apk` and the keystore are gitignored; the keystore and its passwords are never committed (back-up location recorded by the operator outside the repo).
4. **Manifest parity test** `src/lib/__tests__/twaManifestParity.test.ts`: imports the default export of `src/app/manifest.ts` and asserts `twa-manifest.json` agrees on `name`, `short_name` (launcher name), `theme_color`, `background_color`, `start_url` and `display`. Any manifest change that drifts from the TWA definition fails CI.
5. **Privacy policy page.** A public, server-rendered `/privacy` route (English; covers account email, repertoire data, Spotify OAuth tokens, Vercel Blob PDFs, Sentry, Vercel Analytics, Resend, data deletion contact). Linked from the landing page footer and reachable signed-out (do not add it to the `src/proxy.ts` matcher). A component or Playwright check asserts it returns 200 without a session.
6. **Minimum-functionality evidence.** `android/README.md` ends with a "Why this is not a thin wrapper" section naming the features the listing leans on: installable offline repertoire (RH-79/RH-80 snapshot), Fast View with PDF tablature and Stage Mode, setlist navigation, band shared repertoires. The Play listing copy drafts (short <= 80 chars, full <= 4000) live in `android/listing.md` and must lead with those features, not with "the website".
7. Version bump in `package.json` (AGENTS.md rule).

### Part B — operator steps (recorded as evidence on the task, not repo-verifiable)

1. Decide the permanent package id and the production host (see Question); the id can never change after the first upload.
2. Create the app in Play Console with Play App Signing on; copy the SHA-256 app-signing fingerprint and hand it to the developer for `assetlinks.json`; deploy; confirm with `curl -i https://<host>/.well-known/assetlinks.json` and Google's Statement List Tester.
3. Run Bubblewrap per `android/README.md`, build the signed AAB.
4. On a real Android device install from the **internal testing** track and verify: no address bar or Chrome tab strip (screenshot); offline path: open a playlist, tap Available offline, enable airplane mode, force-stop, reopen, setlist and a tablature PDF render (screenshot or recording).
5. Complete the store listing: 512x512 icon, 1024x500 feature graphic, >= 2 phone screenshots, short and full description, category (Music & Audio), contact email, privacy policy URL `https://<host>/privacy`, content rating, data-safety form, target audience.
6. Read the pre-launch report; resolve policy blockers and crashes; record the outcome.
7. Known risk to check on-device: leaving the origin (Spotify OAuth at `accounts.spotify.com`) shows a Custom Tab bar; that is expected and not a failure, but the sign-in must return to the TWA.

## Expected Results

- [ ] `public/.well-known/assetlinks.json` exists and `twaAssetLinks.test.ts` passes: relation `delegate_permission/common.handle_all_urls`, matching package id, at least one well-formed SHA-256 fingerprint.
- [ ] After deploy, `curl -i https://<host>/.well-known/assetlinks.json` returns `200` with `content-type: application/json` (operator evidence).
- [ ] `android/twa-manifest.json` and `android/README.md` are committed, and `twaManifestParity.test.ts` passes against `src/app/manifest.ts`; no keystore, AAB or APK is tracked by git.
- [ ] `GET /privacy` returns `200` signed-out and is linked from the landing page.
- [ ] A signed AAB installs from the Play internal testing track on a real device and opens with no address bar or tab strip (screenshot).
- [ ] Inside the installed TWA, after a playlist download, airplane mode and force-stop, the setlist and a tablature PDF render on reopen.
- [ ] The Play listing is complete (icon, feature graphic, >= 2 phone screenshots, descriptions, category, contact, privacy URL) and the pre-launch report shows no policy blocker or crash.
- [ ] `android/README.md` records the features that justify Play's minimum-functionality policy and the listing copy leads with them.

## Out of Scope

Production-track release, CI-built AABs, iOS, notifications, a native Android feature layer, editing the PWA manifest or service worker beyond the `/.well-known/` exclusion if one is needed.
