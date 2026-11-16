# RH-202 spec generator report — round 3

## Finding addressed
Criteria links: the spec had ACs only under `## Expected Results` and a free-form `### Test Criteria` with multi-AC bullets.

## Changes
- Added `## Acceptance Criteria` with AC-1…AC-7 (product-level outcomes).
- Added `## Technical Criteria` with TC-1…TC-9, each `**TC-n** → AC-n` linking to exactly one AC; every AC has ≥1 TC.
  - TC-1 → AC-1 checks the migration itself via a new `src/lib/__tests__/subscriptionsMigration.db.test.ts` (columns, FK/unique, `plan`/`status` CHECK accept/reject), following the repo's existing `*Migration.db.test.ts` pattern (e.g. `songFilesMigration.db.test.ts`).
  - Former multi-AC bullets split: subscriptions resolution (TC-2) and entitlements limits (TC-3) both → AC-2; adapter contract (TC-4) → AC-3; mock checkout (TC-5) and billing actions/session guard (TC-6) → AC-4; webhook route (TC-7) → AC-5; settings render (TC-8) → AC-6; test+lint gate (TC-9) → AC-7.
- Removed the `### Test Criteria` block from Approach (pointer to Technical Criteria instead).
- Replaced the ready-made `CREATE TABLE` SQL with a column list (specs must not carry ready-made code).
- Added test files to Files Touched: migration DB test, webhook route test, SubscriptionSettingsSection render test.
- `## Expected Results` rewritten as plain checklist (no AC labels) mirroring the operator's seven results, tightened to one sentence each, meaning unchanged.
- Added `## Operator Results Coverage` table mapping each operator result to spec sections, TCs and returned results.

## Unchanged
Scope, behavior changes, mock (`docs/tasks/RH-202-mock.html`), out-of-scope. No open questions.
