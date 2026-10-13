# RH-114 — Make `last_practiced` writable, with the review list (integration close-out)

## Scope
RH-157 (edit-panel write), RH-158 (batch write and per-song Practised button) and RH-159
(whole-playlist review list) are done and committed (0d8bca5, c447f62, 7bdb928). Each child ships
its own unit and DB tests. This parent now covers ONLY the end-to-end close-out: proving the three
triggers hold together and that every original requirement has a named, passing test. It does not
re-implement or redesign any child behavior. The original full-scope spec is superseded.

Not covered: practice-session ordering, display of `last_practiced`, offline snapshot shape.

## Approach
Behavior: none new. Verification, plus filling a gap only if the audit finds one.

Files touched:
- `docs/tasks/RH-114-spec.md`: this file.
- At most one new DB-backed test file (or additions to `src/app/actions/__tests__/authzRepertoire.db.test.ts`), only for a requirement found without a covering test.

Audit already done (existing coverage):
- Panel write earlier date / null / band admin gate: `authzRepertoire.db.test.ts` "the edit panel writes last_practiced (RH-157)".
- Per-song write, row creation as `unknown`, band admin vs member, level leaves date alone, no `band_songs` insert, no other-user write: `practiceWrite.db.test.ts` and "the practice actions (RH-158)".
- List unticked / single control / confirm only ticked / status only for changed levels: `practiceReview.test.tsx`, `usePracticeReview.test.tsx`.
- Batch atomicity: `practiceWrite.db.test.ts` "a failing item rolls the whole batch back" and the RH-159 case in `authzRepertoire.db.test.ts`.

Remaining work for the developer:
1. Run `npm test` (and the DB-backed project) and confirm all files above pass together, with lint and typecheck clean.
2. Confirm by reading that the review list's confirm calls `recordPracticeAction` with the band id on a band playlist, and the per-song button uses the same action, so both go through the single write path.
3. Confirm there is an action-level (not lib-level) test asserting that a batch write never changes another member's `user_songs` row; add one if absent.

## Expected Results
- [ ] The full unit and DB-backed test suites pass, including the RH-157, RH-158 and RH-159 test files, with `tsc` and lint clean.
- [ ] A test through `recordPracticeAction` shows a batch by one user leaves another member's `user_songs` row unchanged and inserts no `band_songs` row.
- [ ] Every original requirement (panel edit, per-song tap, review list, atomic batch, owner rules) maps to a named passing test, listed in the task report.
- [ ] The review list confirm and the per-song button both call the same `recordPracticeAction` write path, with the band id passed on band playlists.

## Out of Scope
Any behavior or UI change to the three children's output; the mock `docs/tasks/RH-114-mock.html` is unchanged.
