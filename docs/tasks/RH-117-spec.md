# RH-117 — Build the admin catalog screen: merge, split and delete (integration close-out)

RH-154 (data layer), RH-155 (song split/merge) and RH-156 (the `/admin/catalog` screen, nav entry, AGENTS.md notes) are done and committed, and together they cover every item in the plan section "Build the admin catalog screen: merge, split and delete" (blast radius before confirming, merge, split, delete as the zero-reference case). Nothing is left to build; this task is verification only, plus one small seam test. The one gap found: the screen is tested against injected fake actions and the lib against the DB, and `src/app/actions/__tests__/catalogAdmin.test.ts` mocks the lib, so no test crosses the real Server Action -> lib -> DB seam with a non-admin caller.

Behavior: no production behavior changes. Files touched: `src/lib/__tests__/catalogAdminActions.db.test.ts` (new, follows the existing `*.db.test.ts` pattern; mocks only the session so `getRequiredUserId` returns a chosen user, imports the real actions from `@/app/actions/catalogAdmin`). If the test exposes a defect, fix it in the smallest place and note it in the report; otherwise nothing else changes.

Test criteria: with a system admin as caller, `mergeSongVersionsAction` moves a repertoire row and a playlist row to the target and removes the source version, and `getCatalogBlastRadiusAction` returns the pre-merge counts. With a non-admin caller, each of the five actions rejects and leaves the DB unchanged. Then run the full gate: `npm run lint` (exit code verified out of band per AGENTS.md), `npx tsc --noEmit`, `npm run lint:dead`, the unit suite and the db suite.

## Expected Results
- [ ] A db test calls the real `mergeSongVersionsAction` as a system admin and asserts the repertoire and playlist rows now point at the target version and the source version is gone.
- [ ] The same db test asserts `getCatalogBlastRadiusAction` returns the repertoire and playlist counts of a seeded version.
- [ ] The db test asserts all five catalog actions reject a non-admin caller and leave the seeded rows unchanged.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run lint:dead` and the existing RH-154/155/156 test files pass unchanged.

## Out of Scope
Any new UI, new lib SQL, standalone song delete, `song_files` management, audit trail of admin operations.
