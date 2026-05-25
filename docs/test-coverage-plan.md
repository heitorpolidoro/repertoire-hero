# Test Coverage Plan

## Overview

To satisfy the SonarCloud Quality Gate (≥ 100% coverage on New Code), the strategy
is **hybrid**: write integration tests for files with real business logic, and exclude
infrastructure wrappers from coverage analysis.

**Current status: ✅ Implemented and passing in CI.**

---

## Phase 1 — Exclude infrastructure from coverage (must be done first, single commit)

These files contain no business logic — they are client instantiation wrappers, logger
shims, or pure types. Testing them would only test the third-party library, not our code.

| File | Reason for exclusion |
|------|----------------------|
| `src/lib/supabase/**` | Supabase client/server factory wrappers |
| `src/lib/spotify*.ts` | OAuth token exchange and Spotify API calls |
| `src/lib/mongodb.ts` | DB connection singleton |
| `src/lib/logger.ts` | Console wrapper |
| `src/store/**` | Zustand store (React-only, depends on Supabase) |
| `src/components/**` | React UI components |
| `src/types/**` | Type definitions, no runtime code |
| `src/app/**` | Next.js App Router pages and API routes |

**Config files updated:**
- `sonar-project.properties` → `sonar.coverage.exclusions`
- `vitest.config.ts` → `coverage.exclude`

> This phase must precede test writing so the Quality Gate threshold is realistic.

---

## Phase 2 — Integration tests for business logic (fully parallelizable)

All test files are independent — no shared state, each creates its own Supabase users
in `beforeAll` and deletes them in `afterAll`. Any number of these can be written
simultaneously.

```
┌──────────────────────────────────────────────────────────┐
│ PARALLEL — all can be written/reviewed at the same time  │
│                                                          │
│  statusConfig.test.ts   ← trivial (~30 min)             │
│  filtering.test.ts      ← pure functions (~1 h)         │
│  profile.test.ts        ← ~2 h                          │
│  playlists.test.ts      ← ~4 h                          │
│  bands.test.ts          ← ~4 h                          │
│  songs.test.ts          ← ~8 h (largest file)           │
│  middleware.test.ts     ← mocked Next.js (~2 h)         │
│  edge_cases.test.ts     ← cross-cutting edge cases      │
│  errors.test.ts         ← error path coverage           │
│  global-songs-cross-user.test.ts ← RLS visibility       │
└──────────────────────────────────────────────────────────┘
          ↓ (merge order doesn't matter)
┌──────────────────────────────────────────────────────────┐
│ SEQUENTIAL (single PR after all above)                   │
│  Update sonar-project.properties / vitest.config.ts      │
│  if any new files slipped through exclusions             │
└──────────────────────────────────────────────────────────┘
```

### Test pattern used

All integration tests follow the same structure:

```ts
const skip = !SERVICE_ROLE_KEY || !ANON_KEY

// Tests are skipped locally (no Supabase) and run in CI (Supabase started via
// heitorpolidoro/.github/.github/actions/setup-supabase@master)
describe.skipIf(skip)('...', () => {
  beforeAll(async () => {
    // Create temp users via admin API (timestamp-suffix emails)
    // Insert seed data attributed to those users
  })
  afterAll(async () => {
    // Delete seed data, then delete users
  })
  it('...', async () => { ... })
})
```

### Why integration tests, not unit tests with mocks

Mocking Supabase at the call level would not catch:
- Row Level Security (RLS) policy violations
- Column constraints / FK errors
- Auth token → user mapping

Integration tests against the local Supabase instance (started via
`supabase start` in CI) catch all of these for free.

---

## Phase 3 — Optional: React component tests (not required for Sonar gate)

Components are excluded from coverage. If component tests are wanted for other
quality reasons (regression prevention), use `@testing-library/react` + jsdom.
These are **independent** of Phase 2 and can run in parallel with it.

---

## CI configuration

```yaml
# .github/workflows/ci.yml
jobs:
  build:
    uses: heitorpolidoro/.github/.github/workflows/node-ci.yml@master
    with:
      node-versions: "['24.x']"
      sonar-node-version: "24.x"
      database: supabase   # starts local Supabase before npm test
    secrets: inherit
```

The shared workflow runs:
1. `npm ci`
2. `heitorpolidoro/.github/.github/actions/setup-supabase@master` (exports well-known local keys)
3. `npm test -- --run --coverage.enabled --coverage.reporter=lcov`
4. SonarCloud scan (uploads `coverage/lcov.info`)

---

## What is NOT parallelizable

| Task | Why it must be sequential |
|------|--------------------------|
| Phase 1 must precede Phase 2 | Without exclusions, 100% gate is unreachable for infra files |
| `supabase start` must precede integration tests in CI | Tests fail on `fetch failed` without it |
| SonarCloud scan must be last CI step | Needs the lcov report from the test run |
