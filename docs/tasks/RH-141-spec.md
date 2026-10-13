# RH-141 — Build the grouped correction review screen

> **Renamed 2026-10-13** to match its task id. Older text below may describe a "board id + 1" filename rule: that was a mistake copied between specs, not a convention. A spec is always `docs/tasks/<task id>-spec.md`.


> Filename follows the repo convention `docs/tasks/<board id + 1>-spec.md`; this is the spec for board task **RH-141**. The mock is `docs/tasks/RH-141-mock.html`. Written against HEAD `51bba28`, where RH-107 (`catalog_suggestions`) has landed.

## Scope

Replace the admin moderation queue's "one card per submission" view with the two-level grouped review decided in `docs/use-cases.md:705-713`: the outer level is the **target** (`songs` row + column), the inner level is the **value**, identical proposals collapsing to one option carrying its count and its requesters. Choosing an option approves it and closes every competing option for that target column in the same act.

Today `PENDING_SUGGESTION_GROUPS_SQL` (`src/lib/catalogSuggestionSql.ts`) groups by `group_id` (one submission), so five musicians proposing the same fix produce five cards, and approving one only supersedes the others after the fact. This task changes the read, adds the "approve this value" action, and rebuilds the screen.

**Layout is an open operator decision** (see the mock, "Question 1"): A = one card per song with a section per contested field (spec default); B = one card per field. Both use identical data and the same option rows; the choice affects only the outer component. Implement the answer recorded on the task; if none, A.

**Not in scope:** requester notices and the "keep my value as a personal override" offer (RH-111); per-link-row corrections (RH-138); targets other than `songs`; splitting/merging/deleting catalog rows (RH-117); any change to the submit path or to the `catalog_suggestions` schema/migrations; landing page (internal moderation queue, `AGENTS.md:526`).

## Approach

**Behavior**
- The queue read returns, per `(song, column)` having at least one `pending` row, the song, the column, the current catalog value, and a list of options ordered by requester count descending. Each option holds the value, its count, its requesters (profile name/email) and the ids of the underlying suggestion rows. Values are compared as jsonb, so `"G"` from five people is one option. A row whose `value` is a proposed SQL NULL is its own option, rendered as "(empty)". Only `pending` rows count; orphans whose song is gone stay hidden as today. `checkSystemAdmin` is still the first statement.
- Approving an option, in one `withTransaction` unit: validates the value through `parseCatalogSuggestionValue`, applies it via the existing single catalog write (including the `links` / `song_links` replace-set path and the `updated_at` bump), marks **all** pending rows of that target column holding that value `approved`, and marks every other pending row of that column `superseded` (existing `SUPERSEDE_SUGGESTIONS_SQL`, run after the approve). Rows in other columns, even of the same submission, are untouched. No savepoints.
- Rejecting a field rejects every pending row of that target column with an optional `rejection_reason`; the catalog is untouched.
- Fields are decided independently; after a decision the field leaves the screen, and a song card with no pending fields disappears. A stale action (option already decided by someone else) surfaces a distinct "already reviewed" message rather than a generic failure, consistent with the existing `Catalog suggestion group is already reviewed` handling.
- UI: option row shows value, count badge (highlighted when > 1), requester names, an "Approve this" button; the field shows the current value, total requests, and "Reject all for this field" with the existing inline reason input. After approval a notice states how many other options were closed as superseded. The empty-state sentence "There are no pending catalog corrections to review right now." is kept. The header pending count counts contested fields, not submissions.
- The old per-submission `reviewCatalogSuggestionGroup` path stays only if something else still calls it; otherwise remove it and its action, with its tests. The submission `reason` is shown on the option row when present.

**Files touched**
- `src/lib/catalogSuggestionSql.ts` — new target/value-grouped read statement and the "approve value" / "reject column" statements; the per-submission read is removed if unused.
- `src/lib/moderation.ts` — new grouped read and two review functions (approve a value, reject a column) built on the SQL above; stays inside the base complexity budget (extract helpers, no new override).
- `src/types/database.ts` — new types for the target group and its options.
- `src/app/actions/moderation.ts` — thin Server Actions for the new read and the two reviews, resolving the user via `getRequiredUserId`; no caller-supplied `userId`.
- `src/app/admin/moderation/page.tsx` — reads the new projection.
- `src/components/admin/ModerationQueue.tsx`, `PendingEditCard.tsx`, `PendingEditDiff.tsx` — replaced/reworked into the grouped screen (song card and option row components per the chosen layout).
- Tests: new/updated `src/lib/__tests__/catalogSuggestions.db.test.ts`, `src/components/admin/__tests__/ModerationQueue.test.tsx`, action guard tests (`thinActions`, `actionSessionGuard`, `authzRepertoire.db`).
- `docs/use-cases.md` — mark the grouped screen as built if it is listed as pending; `package.json` — version bump (`AGENTS.md:523`).

**Test criteria**
- DB test: five pending rows with the same value and one with another, for one column, read as two options with counts 5 and 1.
- DB test: approving the 5-count option applies the value, approves all five rows, supersedes the other, and leaves a different column's pending row alone.
- DB test: a `links` approval writes `song_links` and bumps `songs.updated_at`; an invalid value aborts and leaves every row pending.
- DB test: reject-column marks all pending rows `rejected` with the reason and leaves `songs` unchanged; a non-admin is refused by all three.
- Component test: option rows render value/count/requesters; clicking Approve calls the action with the option's ids; the superseded notice appears; empty state renders.
- Standing guards (`complexityBudget`, `catalogTimestampGuard`, `transactionGuard`, `migrationsSingleSource`) still pass.

## Expected Results
- [ ] A db test shows five pending rows with an identical value for one `songs` column plus one differing row are read as exactly two options with counts 5 and 1, ordered by count descending.
- [ ] A db test shows approving an option applies its value to `songs`, marks every pending row with that value `approved` and every other pending row of that column `superseded`, leaving other columns' pending rows untouched.
- [ ] A db test shows an invalid value or a `links` option behaves correctly: invalid aborts with all rows still `pending`; `links` writes `song_links` and advances `songs.updated_at`.
- [ ] A db test shows rejecting a field marks all its pending rows `rejected` with the given reason and leaves the `songs` row unchanged.
- [ ] The moderation read and both review actions refuse a non-system-admin, asserted in the db and action-guard tests.
- [ ] `ModerationQueue` tests show an option row renders value, count badge and requester names, Approve calls the action with that option's suggestion ids, and the "other options closed (superseded)" notice appears.
- [ ] `/admin/moderation` renders the layout matching the operator's recorded answer to the mock's Question 1, and the empty-state sentence when nothing is pending.
- [ ] `npm run lint`, `npx tsc --noEmit` and `npx vitest run` exit 0 with no budget override added.

## Out of Scope
Requester notifications (RH-111), per-link corrections (RH-138), non-`songs` targets, catalog merge/split/delete (RH-117), submit-path or schema changes.
