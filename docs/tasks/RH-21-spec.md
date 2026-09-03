# RH-21 — Padronizar tratamento de erros no projeto

Baseline commit for every comparison in this spec: **`e7f01dd`** (current `master` HEAD).

## Scope

A single behaviour-preserving consistency sweep over error handling in `src/`.

It covers exactly four kinds of deviation from the conventions that already dominate the
codebase, plus the machinery that keeps them from regressing:

1. `catch (x: any)` clauses (11 sites) → typed narrowing.
2. Lib-layer catches that re-throw the raw error instead of logging + wrapping (4 sites).
3. Unsafe `error as Error` casts fed to `logger.error` (3 sites).
4. `console.error` inside a catch body where `logger` is available (4 sites).
5. Undocumented binding-less swallowed catches in `src/lib/linkFetcher.ts` (4 sites).

Plus:

- a new vitest guard test that greps `src/` so the `catch (x: any)` style cannot come back;
- an **Error Handling Conventions** section in `AGENTS.md` recording the target standard;
- assertions in `src/lib/__tests__/errors.test.ts` for the two lib messages that become wrapped.

**This task does NOT cover:**

- Introducing a shared `src/lib/errors.ts` helper module. The dominant style is inline
  narrowing; adding a helper would mean rewriting ~50 call sites and is a separate refactor.
- The 26 `.catch(console.error)` / `console.error,` **argument-position** promise handlers in
  `src/app/playlists/page.tsx`, `src/app/playlists/[id]/page.tsx` and `src/app/settings/page.tsx`.
  They are a different pattern (fire-and-forget handlers, mostly inline in JSX) and folding them
  in would triple the diff for no consistency gain in `catch` blocks. Follow-up task.
- `console.log` at `src/lib/auth.ts:32-33` (dev-only password-reset URL echo). Routing it through
  `logger.info` would attach a live password-reset URL to a Sentry breadcrumb — a regression, not
  a fix. It stays a `console.log`.
- `console.warn` at `src/lib/db.ts:6`. It fires at module-load time, potentially before Sentry is
  initialised; `logger` is deliberately not used there.
- `src/lib/moderation.ts` re-throws (3 sites). They are the *correct* pattern already: a guarded
  domain-error passthrough and a rollback-then-rethrow into an outer wrapping catch.
- Any change to behaviour other than the error **message text** produced by the four lib
  functions listed in §2 below.
- **Landing page**: per the AGENTS.md Landing Page Rule, this task is internal consistency and
  operational hygiene — **not a selling point**. `src/components/landing/LandingPage.tsx`,
  `src/i18n/dictionaries/en.json` and `src/i18n/dictionaries/pt-BR.json` must be left untouched.
- Browser-level verification. `GET /` and authenticated routes SSR-500 locally (RH-32,
  `AppLayout` / `useSession`), so this task is verified entirely by tests and greps.

---

## The target standard

These are not invented; each is the pattern already used by the majority of the code. Write them
into `AGENTS.md` verbatim (condensed) as part of this task.

### L1 — Data-access / domain layer (`src/lib/*.ts`): log, then throw a prefixed message

Used by every function in `songs.ts`, `playlists.ts`, `profile.ts`, `bands.ts`, `moderation.ts`.

```ts
try {
  const res = await query(sql, [userId])
  return res.rows as Band[]
} catch (error) {
  const err = error instanceof Error ? error : new Error(String(error))
  logger.error('Failed to fetch bands', err, { userId })
  throw new Error(`Failed to fetch bands: ${err.message}`)
}
```

The logged message and the thrown prefix are the same `Failed to <verb the thing>` phrase.
`logger.error` is called *before* throwing so the event reaches Sentry even if a caller swallows.

**L1a — exception.** A domain / authorization error deliberately raised inside the same `try`
is re-thrown unwrapped, behind an explicit message check (precedent: `moderation.ts:70-74`):

```ts
} catch (error) {
  const err = error instanceof Error ? error : new Error(String(error))
  if (err.message.startsWith('Access denied')) throw err
  logger.error('Failed to fetch pending global song edits', err, { adminUserId })
  throw new Error(`Failed to fetch pending global song edits: ${err.message}`)
}
```

A precondition check that throws a user-facing message (e.g. *"Only band admins can regenerate
the invite link"*) is placed **outside** the wrapping `try` so its text survives verbatim.

### A1 — Server Actions that return a result envelope

Used by `getTabAnnotationsAction` / `saveTabAnnotationsAction` (`src/app/actions/tabs.ts:133-136`,
`:170-173`) — the newest code in the file, and the canonical form:

```ts
} catch (err) {
  const message = err instanceof Error ? err.message : undefined
  return { error: message || 'Failed to save annotations' }
}
```

`undefined` (not `String(err)`) is deliberate: it makes `|| fallback` fire for non-`Error` throws
*and* for an `Error` with an empty message, exactly as `err.message || fallback` did.

### A2 — Thin Server Actions

Actions that only resolve the session and delegate (`src/app/actions/profile.ts`,
`src/app/actions/moderation.ts`) have **no** `try/catch`: they let the L1 wrapped error propagate.
Do not add catches to these.

### R1 — Route handlers (`src/app/api/**/route.ts`)

```ts
} catch (error) {
  logger.error('[spotify/playlists]', error instanceof Error ? error : undefined, { id })
  return NextResponse.json({ error: 'Unexpected error fetching Spotify playlists', code: 500 }, { status: 500 })
}
```

Tag is the route path in brackets; the client gets a fixed message plus `code`, never the raw
exception text.

### P1 — Client pages / components

Narrow with `instanceof Error`, surface through component state (inline banner / Toast), and log
with `logger.error`. Never `console.error`; never `catch (x: any)`.

### S1 — Deliberate swallow

A catch that intentionally discards the error uses the binding-less form **and carries a one-line
comment saying why**:

```ts
} catch {
  // oEmbed is best-effort — fall through to the next strategy.
}
```

### E1 — Postgres error-code checks

Never `catch (err: any)` just to read `.code`:

```ts
} catch (err) {
  // 23505 = unique_violation: the row is already there, which is not an error here.
  if ((err as { code?: string }).code !== '23505') throw err
}
```

---

## Approach — the complete deviation list

**26 deviations across 14 files.** Every line number below is as of `e7f01dd`.

### 1. `catch (x: any)` → typed narrowing (11 sites, 6 files)

All 11 are also `@typescript-eslint/no-explicit-any` **errors** today.

| # | File:line | Function | Change |
|---|---|---|---|
| 1 | `src/app/actions/tabs.ts:82` | `uploadTabAction` | apply **A1**, fallback `'An unexpected error occurred during upload'` |
| 2 | `src/app/actions/tabs.ts:115` | `deleteTabAction` | apply **A1**, fallback `'Failed to delete tablatura'` |
| 3 | `src/app/actions/bands.ts:113` | `uploadBandCoverAction` | apply **A1**, fallback `'Failed to upload band cover image'` |
| 4 | `src/app/songs/[id]/fast-view/page.tsx:441` | tab upload handler | `const message = err instanceof Error ? err.message : undefined; setUploadError(message \|\| 'Failed to upload tab')` |
| 5 | `src/app/api/spotify/playlists/[id]/sync/route.ts:128` | `addSongsToRepertoire` (band branch) | apply **E1** |
| 6 | `src/app/api/spotify/playlists/[id]/sync/route.ts:143` | same (member loop) | apply **E1** |
| 7 | `src/app/api/spotify/playlists/[id]/sync/route.ts:154` | same (personal branch) | apply **E1** |
| 8 | `src/app/api/spotify/playlists/[id]/import/route.ts:133` | band branch | apply **E1** |
| 9 | `src/app/api/spotify/playlists/[id]/import/route.ts:148` | member loop | apply **E1** |
| 10 | `src/app/api/spotify/playlists/[id]/import/route.ts:159` | personal branch | apply **E1** |
| 11 | `src/lib/__tests__/test-helpers.ts:190` | `SupabaseMockQuery.then` | `catch (err) { const e = err as { message?: string; code?: string }; ... { message: e.message, code: e.code } }` |

Site 11 is in `src/lib/__tests__/` but is **not** a `*.test.ts` file, so the eslint
`no-explicit-any` override does not apply to it and the guard test (which walks all of `src/`)
would flag it. It must be fixed.

### 2. Lib-layer raw re-throw → **L1** wrapped message (4 sites, 3 files)

| # | File:line | Function | New thrown message |
|---|---|---|---|
| 12 | `src/lib/bands.server.ts:27` | `getBandByInviteCodeServer` | `` `Failed to fetch band by invite code: ${err.message}` `` |
| 13 | `src/lib/bands.server.ts:48` | `joinBandByInviteServer` | `` `Failed to join band by invite: ${err.message}` `` |
| 14 | `src/lib/bands.ts:240-274` | `regenerateBandInviteCode` | `` `Failed to regenerate band invite code: ${err.message}` `` |
| 15 | `src/lib/songs.ts:439-442` | `mergeGlobalSongs` | `` `Failed to merge global songs: ${err.message}` `` (add the missing `logger.error` too) |

**Site 14 in detail.** Today the admin precondition query at `bands.ts:244-247` sits *outside*
any `try`, so a DB failure there escapes raw; and the retry catch at `:265-271` logs but throws
`e` unwrapped. Restructure to:

```ts
export const regenerateBandInviteCode = async (
  bandId: string,
  userId: string,
): Promise<string> => {
  let memberRes
  try {
    memberRes = await query(
      `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2`,
      [bandId, userId],
    )
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to regenerate band invite code', err, { bandId })
    throw new Error(`Failed to regenerate band invite code: ${err.message}`)
  }

  // User-facing precondition — outside the wrapping catch so the text survives verbatim.
  if (memberRes.rowCount === 0 || memberRes.rows[0].role !== 'admin') {
    throw new Error('Only band admins can regenerate the invite link')
  }

  const MAX_ATTEMPTS = 3
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      /* …unchanged UPDATE… */
    } catch (error) {
      // 23505 = unique_violation on invite_code — retry with a fresh code.
      if ((error as { code?: string }).code === '23505' && attempt < MAX_ATTEMPTS - 1) continue
      const err = error instanceof Error ? error : new Error(String(error))
      logger.error('Failed to regenerate band invite code', err, { bandId })
      throw new Error(`Failed to regenerate band invite code: ${err.message}`)
    }
  }
  throw new Error('Failed to regenerate invite code')
}
```

The `'Only band admins can regenerate the invite link'` string must remain byte-identical — it is
rendered directly by `src/app/bands/[id]/page.tsx:127`. The inner `'Band not found'` throw now
surfaces as `Failed to regenerate band invite code: Band not found`; that is the intended,
convention-mandated message change and the only observable behaviour delta in this task.

Existing `src/lib/__tests__/bands.test.ts` assertions use bare `.rejects.toThrow()` with no message
argument, so they stay green.

### 3. `error as Error` → `instanceof` narrowing (3 sites)

| # | File:line | Change |
|---|---|---|
| 16 | `src/lib/spotifyAuth.ts:21` | `logger.error('Failed to query Spotify tokens', error instanceof Error ? error : new Error(String(error)))` |
| 17 | `src/lib/spotifyAuth.ts:90` | same shape, message `'Failed to refresh Spotify token'` |
| 18 | `src/app/api/auth/spotify/disconnect/route.ts:21` | same shape, message `'Failed to disconnect Spotify'` |

Behaviour is identical: `logger.error` already branches on `error instanceof Error` internally,
so the cast only ever lied to the type checker. The three `return null` / 500-response paths are
unchanged.

### 4. `console.error` in a catch body → `logger.error` (4 sites)

| # | File:line | Change |
|---|---|---|
| 19 | `src/app/songs/[id]/fast-view/page.tsx:294` | `logger.error('Failed to load personal tabs', e instanceof Error ? e : new Error(String(e)))` |
| 20 | `src/app/songs/[id]/fast-view/page.tsx:298` | `logger.error('Failed to load personal entry', e instanceof Error ? e : new Error(String(e)))` |
| 21 | `src/app/api/spotify/search/route.ts:131` | `logger.error('[spotify/search]', error instanceof Error ? error : undefined)` — matches **R1** as already used by the sibling `playlists` / `tracks` routes; the empty-array fail-safe return on the next line is unchanged |
| 22 | `src/lib/auth.ts:59` | `logger.error('Failed to send password reset email', error instanceof Error ? error : new Error(String(error)))` |

Add the `import { logger } from '@/lib/logger'` where missing (`fast-view/page.tsx`,
`api/spotify/search/route.ts`, `src/lib/auth.ts`).

### 5. Undocumented swallowed catches → **S1** (4 sites, 1 file)

`src/lib/linkFetcher.ts` lines 27, 38, 52, 85 are bare `} catch {}` with no explanation. Give each
a one-line reason comment (`// YouTube oEmbed is best-effort — fall through to noembed.`, etc.).
No logic change. The `catch { return cleanUrl }` at line 91 already self-documents and is left alone.

### 6. New guard test — `src/lib/__tests__/errorHandlingStyle.test.ts`

Modelled on `src/lib/__tests__/noBrowserDialogs.test.ts`:

- Export a detector `findAnyTypedCatches(source: string): string[]` matching
  `/catch\s*\(\s*[A-Za-z_$][A-Za-z0-9_$]*\s*:\s*any\s*\)/` over comment-stripped source (reuse the
  same `stripComments` approach so prose about the rule does not trip it).
- Detector unit tests, with the offending literal built by string concatenation so the file never
  contains a real match: flags `catch (err: any)`, flags `catch (e: any)`, flags an arbitrary
  binding name, ignores the same text inside a `//` comment, ignores a clean `catch (err)`.
- A tree test that walks every `.ts` / `.tsx` under `src/` (excluding the test file itself via a
  `SELF` constant) and asserts the violation list `.toEqual([])` — i.e. the gate is **exactly the
  post-sweep baseline of zero**, not a shrinking allowance. Failure message must name AGENTS.md
  and list `path:line — text` for each offender.

### 7. `src/lib/__tests__/errors.test.ts` update

The two `bands.server` cases at lines 336-344 currently assert only `.rejects.toThrow()`. Tighten
them to the new wrapped messages:

```ts
await expect(getBandByInviteCodeServer('some-code')).rejects.toThrow(
  'Failed to fetch band by invite code: Mocked Database Error',
)
await expect(joinBandByInviteServer('mock-user-id', 'some-code')).rejects.toThrow(
  'Failed to join band by invite: Mocked Database Error',
)
```

No other test in the file changes — the 30-odd existing `Failed to …: Mocked Database Error`
assertions already encode convention **L1** and must stay green untouched.

### 8. `AGENTS.md`

Insert a new top-level section `# Error Handling Conventions` immediately **before**
`# UI & UX Behavioral Directives`. It must state, compactly: L1 (+ L1a), A1, A2, R1, P1, S1, E1,
and name `src/lib/__tests__/errorHandlingStyle.test.ts` as the mechanical guard. Do not touch the
`nextjs-agent-rules` or `MERIDIAN_INSTRUCTIONS` blocks.

### 9. Version bump

`package.json` is at `0.1.61-202609030559` — the highest version used anywhere in `git log`. Bump
to `0.1.62-YYYYMMDDHHmm` (local time, at commit time). The version must only go up.

---

## Baselines at `e7f01dd` (measured, for reference)

| Measurement | Value at `e7f01dd` | Expected after |
|---|---|---|
| `npx vitest run` | 24 files / 243 tests, all pass | ≥25 files / ≥247 tests, 0 failed |
| `npx eslint .` | 44 problems — 24 errors, 20 warnings | ≤13 errors, ≤20 warnings |
| `no-explicit-any` eslint lines | 14 | exactly 3 |
| `catch (x: any)` in `src/` | 11 | 0 |
| bare `throw err/error/e` in `src/lib/*.ts` | 7 | 3 (all in `moderation.ts`) |
| `console.error(` statements in `src/` (excl. `.catch(console.error)`) | 7 | 3 |
| `as Error` in `src/` excl. `__tests__` | 3 | 0 |
| `} catch {}` in `linkFetcher.ts` | 4 | 0 |

**eslint never has to exit 0** — 24 errors and 20 warnings are pre-existing. The only requirement
is that the totals do not grow and that the 11 `catch (x: any)` errors disappear (24 → 13).

## Expected Results

- [ ] `grep -rEn "catch[[:space:]]*\([[:space:]]*[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*:[[:space:]]*any[[:space:]]*\)" src/` returns no matches (exit status 1). At `e7f01dd` it returns 11.
- [ ] `src/lib/__tests__/errorHandlingStyle.test.ts` exists and `npx vitest run src/lib/__tests__/errorHandlingStyle.test.ts` passes with ≥5 tests, including a detector test that flags a constructed `catch`-clause-with-`any` snippet and one that asserts the `src/` tree has zero violations.
- [ ] `npx vitest run` reports 0 failed test files and 0 failed tests, with ≥25 test files and ≥247 tests (baseline at `e7f01dd`: 24 files / 243 tests).
- [ ] `npx eslint . 2>&1 | tail -3` reports at most 13 errors and at most 20 warnings (baseline at `e7f01dd`: 24 errors / 20 warnings), and `npx eslint . 2>&1 | grep -c no-explicit-any` prints exactly `3` (baseline: `14`).
- [ ] `grep -rEn "^[[:space:]]*throw (err|error|e);?[[:space:]]*$" src/lib/*.ts` returns exactly 3 matches and all 3 are in `src/lib/moderation.ts` (baseline at `e7f01dd`: 7 matches across `bands.server.ts`, `bands.ts`, `moderation.ts`, `songs.ts`).
- [ ] `grep -rn "console.error(" src/ | grep -v ".catch(console.error)"` returns exactly 3 lines — `src/lib/logger.ts` once and `src/lib/__tests__/spotify.test.ts` twice (baseline at `e7f01dd`: 7 lines, additionally in `src/app/songs/[id]/fast-view/page.tsx` twice, `src/app/api/spotify/search/route.ts`, `src/lib/auth.ts`).
- [ ] `grep -rn "as Error" src/ | grep -v __tests__` returns no matches (baseline at `e7f01dd`: 3 — `src/lib/spotifyAuth.ts` twice, `src/app/api/auth/spotify/disconnect/route.ts` once).
- [ ] `grep -cE "\} catch \{\}" src/lib/linkFetcher.ts` prints `0`, and the four formerly-empty catch blocks in that file — the ones guarding the YouTube oEmbed fetch, the noembed.com fallback fetch, the Spotify oEmbed fetch, and the generic HTML `og:title` / `<title>` fetch — each contain a `//` comment line. The fifth binding-less catch, `catch { return cleanUrl }` (the `new URL()` domain-name fallback), is unchanged and gets no comment (baseline at `e7f01dd`: 4 bare `} catch {}`).
- [ ] `src/lib/__tests__/errors.test.ts` contains the exact strings `Failed to fetch band by invite code: Mocked Database Error` and `Failed to join band by invite: Mocked Database Error`, and `npx vitest run src/lib/__tests__/errors.test.ts` passes.
- [ ] `grep -c "Only band admins can regenerate the invite link" src/lib/bands.ts` prints `1` — the user-facing admin precondition message is unchanged and is still thrown outside any wrapping catch.
- [ ] `grep -n "Failed to merge global songs" src/lib/songs.ts` matches, and `mergeGlobalSongs` calls `logger.error` before throwing (baseline at `e7f01dd`: its catch does `await query('ROLLBACK'); throw error` with no logging and no wrapping).
- [ ] `AGENTS.md` contains a top-level heading `# Error Handling Conventions`, placed before `# UI & UX Behavioral Directives`, whose body names all of: the lib-layer `Failed to X: ${err.message}` wrapping rule, the `err instanceof Error ? err.message : undefined` Server-Action rule, the ban on `catch (x: any)`, the ban on `console.error` in favour of `logger`, and the file `src/lib/__tests__/errorHandlingStyle.test.ts`.
- [ ] `git diff e7f01dd --stat -- src/components/landing/LandingPage.tsx src/i18n/dictionaries/en.json src/i18n/dictionaries/pt-BR.json` produces no output — this task is internal consistency, not a selling point, so the AGENTS.md Landing Page Rule requires the landing copy to be untouched.
- [ ] `node -p "require('./package.json').version"` matches `^0\.1\.(6[2-9]|[7-9][0-9])-20[0-9]{10}$` (baseline at `e7f01dd`: `0.1.61-202609030559`; the version must only ever go up).
- [ ] `git diff e7f01dd --name-only` lists no file outside this set: `package.json`, `AGENTS.md`, `docs/tasks/RH-21-spec.md`, `docs/suggestions-log.md`, `src/lib/__tests__/errorHandlingStyle.test.ts`, `src/lib/__tests__/errors.test.ts`, `src/lib/__tests__/test-helpers.ts`, `src/lib/bands.ts`, `src/lib/bands.server.ts`, `src/lib/songs.ts`, `src/lib/spotifyAuth.ts`, `src/lib/linkFetcher.ts`, `src/lib/auth.ts`, `src/app/actions/tabs.ts`, `src/app/actions/bands.ts`, `src/app/songs/[id]/fast-view/page.tsx`, `src/app/api/spotify/search/route.ts`, `src/app/api/spotify/playlists/[id]/sync/route.ts`, `src/app/api/spotify/playlists/[id]/import/route.ts`, `src/app/api/auth/spotify/disconnect/route.ts`.
- [ ] `git diff e7f01dd -- src/app/api/spotify/playlists/[id]/sync/route.ts src/app/api/spotify/playlists/[id]/import/route.ts` shows only `catch` clauses changed: each of the 6 sites still short-circuits on Postgres code `23505` and re-throws otherwise, with no change to any SQL statement, HTTP status, or response body in either file.

## Out of Scope

- A shared `src/lib/errors.ts` helper module (would touch ~50 call sites — separate task).
- The 26 `.catch(console.error)` argument-position promise handlers in `src/app/playlists/page.tsx`, `src/app/playlists/[id]/page.tsx`, `src/app/settings/page.tsx`.
- `console.log` in `src/lib/auth.ts:32-33` (dev-only reset URL — must not become a Sentry breadcrumb) and `console.warn` in `src/lib/db.ts:6` (module-load time, pre-Sentry).
- The 3 remaining `no-explicit-any` eslint errors: `src/app/songs/[id]/fast-view/page.tsx:838` (`statusKey as any` in JSX) and `src/lib/__tests__/test-helpers.ts:94,118` (function parameters) — none is a `catch` clause.
- The pre-existing `react-hooks/set-state-in-effect`, `prefer-const` and `@next/next/no-html-link-for-pages` eslint errors.
- Any landing-page or i18n dictionary change (Landing Page Rule: error handling is explicitly listed there as *not* a selling point).
- Browser / e2e verification — RH-32 makes local SSR of `/` and authenticated routes unreliable.
