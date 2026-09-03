# RH-18 — Real-database test for `already_member` semantics in `join_band_by_invite`

## Scope

Add one new **real-database integration test file** that exercises the Postgres
function `join_band_by_invite` (migration `0004_join_band_by_invite_already_member.sql`)
through the app's own data-access functions, against a live Postgres, and locks
in the re-join semantics that RH-12 only verified by hand:

- a fresh join reports `already_member = false` and inserts exactly one `band_members` row;
- a second join by the same user through the same invite code, **without** `leaveBand`
  in between, reports `already_member = true`, returns the same `band_id`, and still
  leaves exactly one `band_members` row (the `ON CONFLICT (band_id, user_id) DO NOTHING`
  guard, backed by the `UNIQUE (band_id, user_id)` constraint in `0001_initial_schema.sql`);
- an invite code that resolves to no band yields `null` from both callers.

This task changes **no production code**. `src/lib/bands.ts`, `src/lib/bands.server.ts`,
the `migrations/` directory and every route/action stay byte-identical to commit
`61a7994`. The existing mocked unit tests in `src/lib/__tests__/bands.server.test.ts`
stay exactly as they are — they cover the TypeScript mapping layer; the new file covers
the SQL underneath it. The two are complementary, not a replacement.

**Landing Page Rule (AGENTS.md)**: this task is explicitly **NOT a selling point**.
It is internal test coverage with no user-facing surface, so `src/components/landing/LandingPage.tsx`,
`src/i18n/dictionaries/en.json` and `src/i18n/dictionaries/pt-BR.json` must not be
touched.

## Context found in the current code

- **Convention for real-DB tests**: `src/lib/__tests__/songs.test.ts` and
  `src/lib/__tests__/bands.test.ts` both do
  `const skip = !process.env.SUPABASE_SERVICE_ROLE_KEY` +
  `describe.skipIf(skip)(...)`. The env var is only a *gate flag* — the "admin client"
  returned by `createAdminTestClient()` in `test-helpers.ts` is a fake Supabase chain
  that compiles to raw SQL and runs it through `query()` from `@/lib/db`. There is no
  Supabase server involved.
- **Connection**: `vitest.config.ts` loads `.env.local` / `.env.development.local` and
  defaults `DATABASE_URL` to `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
  when unset. `.env.local` in this repo defines `SUPABASE_SERVICE_ROLE_KEY`, so these
  suites really run locally (verified: `npx vitest run src/lib/__tests__/bands.test.ts`
  → 14 passed, not skipped).
- **Skip vs fail when the DB is absent**: the existing convention is **skip**, and this
  task follows it. Do not introduce a fail-hard gate.
- **Fixtures**: `createTestUser(admin, { email })` inserts into `"user"` + `profiles`
  and returns the id; `deleteTestUser(admin, userId)` deletes from `"user"`, which
  cascades to `profiles` → `band_members`. It does **not** delete `bands` (the `bands`
  table has no owner FK), so the band must be deleted explicitly.
- **Callers**:
  - `joinBandByInviteClient(userId, inviteCode)` in `src/lib/bands.ts` returns
    `string | null` — the `band_id` only; it discards `already_member`.
  - `joinBandByInviteServer(userId, inviteCode)` in `src/lib/bands.server.ts` returns
    `{ bandId, alreadyMember } | null` — this is the only caller that surfaces the flag,
    so the `already_member` assertions must go through it.
- **`bands.server.test.ts` cannot host this test**: it calls `vi.mock('@/lib/db')` at
  module scope, which replaces `query` for the entire file. The new test needs the real
  `query`, so it must live in its own file.

## Approach

Create **`src/lib/__tests__/joinBandByInvite.test.ts`** — a new, self-contained real-DB
integration test file. Do not add these cases to `bands.test.ts`: that file is a single
stateful sequence sharing one `bandId`/`inviteCode` across its `it` blocks (it even
re-joins and leaves to keep later tests happy), and injecting re-join cases into it would
couple the new assertions to that ordering.

Shape of the file:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminTestClient, createTestUser, deleteTestUser } from './test-helpers'
import { createBand, deleteBand, getBandWithMembers, joinBandByInviteClient } from '../bands'
import { joinBandByInviteServer } from '../bands.server'
import { query } from '@/lib/db'

const skip = !process.env.SUPABASE_SERVICE_ROLE_KEY
const admin = createAdminTestClient()

describe.skipIf(skip)('join_band_by_invite already_member semantics (real database)', () => {
  const suffix = Date.now()
  // ... users, band, invite code created in beforeAll
})
```

Rules for the implementation:

- **No `vi.mock('@/lib/db')` anywhere in the file.** The point of the task is to hit
  real SQL. (`src/lib/__tests__/setup.ts` globally mocks `@supabase/supabase-js`; that is
  unrelated and harmless.)
- **Membership counting helper**: a small local helper that runs
  `SELECT count(*)::int AS count FROM band_members WHERE band_id = $1 AND user_id = $2`
  through `query` and returns a number. Count by `(band_id, user_id)` — never a global
  count — so the file stays safe under vitest's parallel file execution.
- **Unique fixtures**: derive emails and band name from `Date.now()`
  (e.g. `test-rh18-a-${suffix}@example.com`, band name `RH-18 Invite Band ${suffix}`),
  matching the existing suffix convention.
- **No `any`**: the new file must be lint-clean on its own (see Expected Results). Type
  the count query with a generic (`query<{ count: number }>(...)`) instead of casting.
- **Cleanup in `afterAll`**: `deleteBand(bandId)` first (cascades `band_members`), then
  `deleteTestUser` for both users (cascades `profiles`). Guard each with a truthiness
  check as `bands.test.ts`/`songs.test.ts` do, so a failure mid-suite still cleans up
  what exists.

Test cases (at least these five, in this order):

1. **Fresh join** — user B calls `joinBandByInviteServer(userB, inviteCode)`; expect
   `{ bandId, alreadyMember: false }` with `bandId` equal to the band created in
   `beforeAll`; membership count for `(band, userB)` is exactly `1`.
2. **Re-join without leaving** — call `joinBandByInviteServer(userB, inviteCode)` again,
   with no `leaveBand` in between; expect the same `bandId`, `alreadyMember: true`, and
   the membership count still exactly `1`. Also assert the member's `role` is still
   `'member'` and that `getBandWithMembers(bandId)` reports exactly 2 members
   (admin A + member B, no duplicate).
3. **Client caller is idempotent** — the RH-12 UI path: call
   `joinBandByInviteClient(userB, inviteCode)` twice in a row; both calls resolve to the
   same `bandId` (neither throws, neither returns `null`), and the membership count is
   still exactly `1`.
4. **Unresolved invite code** — with a code that matches no band (e.g.
   `` `nope${suffix}` ``), `joinBandByInviteServer(userB, code)` resolves to `null` and
   `joinBandByInviteClient(userB, code)` resolves to `null`; no `band_members` row is
   created for user B beyond the one from the earlier cases.
5. **Band creator re-accepting their own invite** — `joinBandByInviteServer(userA, inviteCode)`
   for the admin who created the band returns `alreadyMember: true` and the same `bandId`,
   the membership count for `(band, userA)` is exactly `1`, and userA's `role` is still
   `'admin'` (the `ON CONFLICT DO NOTHING` must not demote the admin to `'member'`).

## Version bump

Per AGENTS.md, bump `package.json` to `0.1.58-<YYYYMMDDHHmm>` (local time). The highest
version used so far is `0.1.57-202609030245`; the version must only go up.

## Expected Results

- [ ] A new real-database test file `src/lib/__tests__/joinBandByInvite.test.ts` exists in the repertoire_hero repo, contains at least 5 `it(...)` cases, and does NOT contain `vi.mock("@/lib/db")` or `vi.mock('@/lib/db')` anywhere (grep returns no match) — it exercises the real Postgres function `join_band_by_invite`, not a mocked `query`.
- [ ] With the local Postgres reachable on `127.0.0.1:54322` (all six files in `migrations/` applied) and `SUPABASE_SERVICE_ROLE_KEY` set in `.env.local`, `npx vitest run` at the repo root finishes with "Test Files 21 passed (21)", at least 205 passed tests, 0 failed and 0 skipped (baseline at commit `61a7994` is 20 files / 200 tests).
- [ ] `npx vitest run src/lib/__tests__/joinBandByInvite.test.ts` passes with 0 failed and 0 skipped tests, and its output shows at least 5 tests run (the suite is NOT silently skipped).
- [ ] The new test file proves the fresh-join case against the real database: a test user who is not yet a member joins a band via its invite code and the call reports `alreadyMember`/`already_member` = false, returns the band's id, and exactly one `band_members` row exists for that (band_id, user_id) pair afterwards.
- [ ] The new test file proves the re-join case against the real database: the same user joins a second time through the same invite code with NO `leaveBand`/`DELETE FROM band_members` in between, and the call reports `alreadyMember`/`already_member` = true, returns the same band id as the first join, and there is still exactly one `band_members` row for that (band_id, user_id) pair.
- [ ] The new test file asserts that calling `joinBandByInviteClient(userId, inviteCode)` twice in a row resolves to the same non-null band id both times (neither call throws nor returns null) and leaves exactly one `band_members` row for that (band_id, user_id) pair.
- [ ] The new test file asserts that an invite code matching no band makes `joinBandByInviteServer` resolve to `null` AND `joinBandByInviteClient` resolve to `null`.
- [ ] The new test file asserts that the band's creator (role `admin`) re-accepting their own invite code gets `alreadyMember` = true, the same band id, exactly one `band_members` row, and a `role` still equal to `'admin'` (not demoted to `'member'`).
- [ ] The test cleans up after itself: after `npx vitest run` completes, querying the local database shows zero rows in `bands`, `band_members`, `profiles` and `"user"` created by the new file (e.g. `SELECT count(*) FROM bands WHERE name LIKE 'RH-18%'` returns 0 and `SELECT count(*) FROM "user" WHERE email LIKE 'test-rh18-%'` returns 0).
- [ ] `git diff --stat 61a7994 -- src/lib/bands.ts src/lib/bands.server.ts src/lib/__tests__/bands.server.test.ts src/lib/__tests__/bands.test.ts migrations/ src/app/ src/components/ src/i18n/` produces empty output — no production code, no migration, no UI/i18n/landing-page file was changed.
- [ ] `npx eslint src/lib/__tests__/joinBandByInvite.test.ts` exits with code 0 and prints no errors or warnings, and `npx eslint .` reports no more than 24 errors and 20 warnings in total (the pre-existing baseline at `61a7994`).
- [ ] `package.json` `version` is `0.1.58-<YYYYMMDDHHmm>` (e.g. `0.1.58-202609030310`) — strictly higher than the previous highest `0.1.57-202609030245`.
- [ ] `src/components/landing/LandingPage.tsx`, `src/i18n/dictionaries/en.json` and `src/i18n/dictionaries/pt-BR.json` are unchanged vs `61a7994`: this task is internal test coverage and explicitly NOT a landing-page selling point.

## Out of Scope

- Changing `join_band_by_invite` or adding any migration. `migrations/` must be identical to `61a7994`.
- Changing `joinBandByInviteClient` to expose `alreadyMember` (it deliberately returns only the band id today; changing its signature is a product change, not this task).
- Replacing or trimming the mocked tests in `bands.server.test.ts`.
- Adding the re-join cases to `bands.test.ts`.
- Wiring a Postgres service into CI, or changing the skip gate to a hard failure.
- Any UI, copy, i18n or landing-page change.
