VERDICT: NEEDS_OPERATOR

RH-191 is a split parent. Its children (RH-192 to RH-196) are merged into master at 7a56dda, and this
worktree is based on that commit. I verified against the code at HEAD b9ea1dc (master plus spec docs only).

## Expected Results Checked

- [x] 1. `offlineStore.test.ts` asserts one song record with one set of cached bytes per version and owner
  context, in a test named for two setlists sharing a song and in one named for personal and band context.
  Verified by running vitest and reading `src/lib/__tests__/offlineStore.test.ts` L122-157.
  - `two setlists sharing a song store exactly one song record with one set of cached bytes` passes. It asserts 3
    song records, `blobs.keysFor(v-shared)` is exactly 1 key, and `blobs.entries.size === 3`.
  - `a version downloaded in personal and band context stores one song record with one set of cached bytes per
    context` passes. It asserts 2 records, 1 key for each, and `entries.size === 2`, even after a repeat band save.
- [x] 2. After `Remove <title> from this device` on a row of a five-song setlist, the row reads "Not on this
  device", the control shows `4 of 5 songs`, and "Refresh offline copy" brings it back to `5 of 5 songs`.
  Verified by running vitest on `PlaylistDetailView.test.tsx`, test `removing a row from this device marks it,
  counts 4 of 5, and Refresh offline copy brings it back to 5 of 5` (L410-424). This test renders the real island
  over in-memory store fakes. It passes.
  - The production e2e `keeps a song and drops one removed from its row…` covers the same UI flow in a real
    browser on a two-song list (`1 of 2 songs`). I could not run it (see results 7 and 8).
- [x] 3. Removing one stored song leaves every other song and every setlist's list stored.
  `removeOfflineSong › removing one stored song leaves every other song and every setlist list stored` passes.
  It asserts v-2 and v-3 remain with their bytes, v-1's bytes are gone, and both pl-1 and pl-2 keep their full
  ordered entries.
- [x] 4. Removing a downloaded setlist deletes only the songs not held by another downloaded setlist and not
  downloaded individually. `removeOfflinePlaylist — the protection rule › removing a downloaded setlist deletes
  only…` passes:
  - v-only is deleted, bytes included.
  - v-shared (held by pl-2) and v-mine (individual) are kept with their bytes.
  - Related tests also pass: cross-owner-context, shared bytes, refresh drop.
- [x] 5. `offlineConversion.test.ts` converts a stored v6 setlist and a `song:` record with a throwing `fetch`.
  The test runs on `throwingFetch`, asserts one record per song with no `snapshot` left, and checks
  `individualDownload` true/false. Files answer through `offlineFirst.getTabs` from the existing cached bytes,
  and `ports.fetched` is `[]`. It passes, along with the v5 upgrade, purge, newest-wins, failed-conversion and
  rerun tests (7/7).
- [x] 6. When one song fails during a setlist download, `useOfflinePlaylist.test.tsx` shows the others stored,
  the count one short and "Try again". The test asserts stored `[v-rep-1, v-rep-3]`, status `downloaded`, count
  `{stored: 2, total: 3}`, the alert `1 of 3 songs could not be downloaded.`, and a rendered `Try again` button.
  It passes.
- [ ] 7. **NOT VERIFIED (environment).** `E2E_PROD=1` `offline-mode.spec.ts`: after a cold reload with no
  network, a kept song opens and a removed song shows the not-downloaded screen.
  - The test exists: `keeps a song and drops one removed from its row, after a cold reload with no network`
    (L618-682). Its assertions match the result.
  - I could not run it, for three reasons:
    1. `npm run build` fails in this worktree: `TurbopackInternalError: Symlink node_modules could not be
       resolved: the symlink target leaves the filesystem root`. The worktree's `node_modules` is a symlink to
       `/Users/heitor/workspace/repertoire_hero/node_modules`.
    2. This headless run refuses every way of setting `E2E_PROD`, `BETTER_AUTH_SECRET` and
       `PLAYWRIGHT_WEB_SERVER` (inline `VAR=`, `env`).
    3. The spec skips itself without `E2E_PROD`.
- [ ] 8. **NOT VERIFIED (environment).** `E2E_PROD=1` `offline-mode.spec.ts`: in a new tab with no network, the
  offline screen lists the setlist in order with the removed song marked "Not on this device", and ArrowRight
  skips it.
  - The test exists: `skips a song not on this device when walking a downloaded setlist from a new offline tab
    (RH-196)` (L757-817). Its assertions match the result and add `3 / 3`, ArrowLeft and Back.
  - It was not run, for the same reasons as result 7.

## Other checks run
- Full `npx vitest run` with RUN_DB_TESTS=1: 328/329 files and 4038 tests passed, 2 failed.
  - Both failures were `pdfWorkerAsset.test.ts`. The generated, gitignored `public/pdf.worker.min.mjs` was
    missing because the worktree had no postinstall run.
  - After `node scripts/copy-pdf-worker.mjs` that file passes 7/7. This is an environment artifact, not a code
    defect.
- `npx tsc --noEmit`: clean.
- `npm run lint` (eslint, `--max-warnings=0`): exit 0, no output.
- `lint:dead` and `lint:dup` were not run.

## Registry lines checked
Areas: **Offline** and **Fast View and queue**, from `node scripts/behavior.js area`.
- Offline is checked by vitest: offlineStore, offlineConversion, offlineFirst, offlineSnapshot,
  offlineSongRecord, useOfflinePlaylist, useOfflineLibrary, OfflineStorageSection, OfflineDownloadButton,
  PlaylistSongList, OfflineSetlists, pwaShell. All of these are in the passing full run.
  - Not checked in a real browser: the e2e-only claims (cold offline start on `/offline`, the document cache
    serving a never-opened song, the setlist being walked offline). The production e2e could not run.
- Fast View and queue lines (queue, owner context, navigation skipping offline entries, Stage Mode arrows,
  song window, setlist player, CSP) are covered by the passing usePlaylistNav, playlistNav, songQueue,
  songWindow, setlistPlayer, nextConfigCsp and fastViewPage tests.
- No failing registry line was found.

## Registry file check
`package.json` defines no `test:registry` script, so this check was skipped.

## Blocking Findings
None. Results 1 to 6 pass. Results 7 and 8 have matching tests in `e2e/offline-mode.spec.ts`, but I could not
run them in this run's environment, for the reasons under result 7.

## Suggestions
- A worktree whose `node_modules` is symlinked cannot run `npm run build` under Turbopack. Either install
  `node_modules` in task worktrees, or set `turbopack.root` to the parent repo. Then QA can run the production
  e2e headlessly.
- Task worktrees miss `public/pdf.worker.min.mjs` until `scripts/copy-pdf-worker.mjs` runs, so a plain
  `npx vitest run` shows 2 failures there.

## Note on verdict
Results 7 and 8 are not marked `[operator]`. Strictly, NEEDS_OPERATOR is reserved for `[operator]` results or
real-device checks. I chose it because the code is not at fault here: this headless run cannot build or set the
required env. A NEEDS_REVISION would send a developer to fix nothing. The operator steps are exact commands.
