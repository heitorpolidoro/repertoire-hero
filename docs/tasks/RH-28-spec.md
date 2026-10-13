# RH-28 — Implement offline mode (integration and verification)

> **Renamed 2026-10-13** to match its task id. Older text below may describe a "board id + 1" filename rule: that was a mistake copied between specs, not a convention. A spec is always `docs/tasks/<task id>-spec.md`.


> **Filename mapping.** This is the spec for board task **RH-28**, written to
> `docs/tasks/RH-28-spec.md`; in this repository the spec filename is board id + 1.
> (Not to be confused with board task RH-29, native packaging.) Blocked-by specs:
> RH-78 -> `RH-78-spec.md`, RH-79 -> `RH-79-spec.md`, RH-80 -> `RH-80-spec.md`.

Design authority: `docs/superpowers/specs/2026-09-20-offline-mode-design.md`.
Children RH-78 (`56db96f`, PWA shell), RH-79 (`b34810a`, snapshot and download),
RH-80 (`376b3a2`, Fast View read path and e2e) are done. This task re-specs none of that.

## Scope

Verify the whole feature end to end against the design, and close the one genuine
gap found while auditing it. Audit result, design item by item:

| Design item | Owner | State at HEAD |
|---|---|---|
| Manifest, 192/512 icons, standalone, SW with navigation fallback, update handling (`skipWaiting`, `clientsClaim`, `updateViaCache: 'none'`) | RH-78 | shipped, `pwa-shell.spec.ts` |
| Snapshot module, store, schemaVersion mismatch = absent, quota error and rollback, download control, `/settings` aggregate | RH-79 | shipped |
| Sign-out clears every snapshot and PDF | RH-79 | shipped (`SignOutButton`), **unit-tested only** |
| `offlineFirst` decorator, read-only banner, disabled controls, empty state, cold-start e2e | RH-80 | shipped, `offline-mode.spec.ts` |
| Cross-origin PDF (measured, no proxy route) | design correction | closed |

**Genuine gap.** The design says sign-out must clear caches because the offline
cache bypasses `src/proxy.ts`. That behaviour is proven only by unit tests that
stub the store. No test shows, in a real browser with a real service worker, that
after sign-out a reload of a previously downloaded Fast View no longer serves the
data. Secondary: all offline e2e is skipped without `E2E_PROD`, so CI never runs it;
this task does not change CI, but records the manual command.

Not covered: write queue, native packaging, other routes offline, any change to
child-delivered behaviour unless the verification run exposes a defect (fix it, and
name it in the report).

## Approach

1. Run the full gate once at HEAD (lint, typecheck, `typecheck:sw`, unit tests with
   coverage, production build) and the two offline e2e files under `E2E_PROD`
   using the command in the header of `e2e/offline-mode.spec.ts`. Any failure is
   fixed here.
2. Add one test to `e2e/offline-mode.spec.ts` (same `E2E_PROD` guard and helpers):
   download a playlist through the UI, sign out through the real Sign Out button,
   then confirm IndexedDB `repertoire-hero-offline` holds no snapshots and
   `rh-offline-tabs-v1` holds no entries, and that with the network cut a reload of
   the Fast View URL does not render the setlist data (it shows the login or the
   offline shell, never the song).
3. Add one test to `e2e/pwa-shell.spec.ts`, inside the existing `E2E_PROD` describe,
   named `serves an installable manifest with reachable 192 and 512 PNG icons`. It
   uses Playwright's `request` fixture (no page needed): `GET /manifest.webmanifest`
   must return 200 with JSON whose `display` is `standalone`; the `icons` array must
   contain an entry with `sizes` `192x192` and one with `512x512`, each `type`
   `image/png`; then `GET` each icon's `src` and assert status 200, a `content-type`
   of `image/png`, and a non-empty body. (Pixel dimensions are already pinned by
   `src/lib/__tests__/pwaShell.test.ts`; this test proves the served URLs.)
4. Confirm no new `complexity-budget/override` entry and bump `package.json` version.

## Files touched

- `e2e/offline-mode.spec.ts` — one new sign-out purge test.
- `e2e/pwa-shell.spec.ts` — one new manifest and icon fetch test (ER5).
- `package.json` — version bump.
- Any file a verification failure in step 1 forces, named in the report.

## Expected Results

- [ ] ER1 — Lint, typecheck, `typecheck:sw`, unit tests with the coverage gate and `npm run build` all pass at HEAD.
- [ ] ER2 — `e2e/pwa-shell.spec.ts` and `e2e/offline-mode.spec.ts` pass (none skipped) under `E2E_PROD=1` against a production build.
- [ ] ER3 — New e2e test: after UI sign-out, `repertoire-hero-offline` snapshots and `rh-offline-tabs-v1` entries are both empty.
- [ ] ER4 — New e2e test: after sign-out, offline reload of the previously downloaded Fast View URL does not render the song's setlist data.
- [ ] ER5 — New e2e test `serves an installable manifest with reachable 192 and 512 PNG icons` in `e2e/pwa-shell.spec.ts` passes: `/manifest.webmanifest` is `display: standalone` and both icon URLs return 200 `image/png`.
- [ ] ER6 — The `complexity-budget/override` list in `eslint.config.mjs` has no new entry.

## Out of Scope

- CI wiring for `E2E_PROD` runs.
- Native packaging (board RH-29), write queue, background sync, other offline routes.
