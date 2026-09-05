# RH-32 — Fix the 500 on SSR of `/` and `/profile` (Invalid hook call in `AppLayout.useSession`)

Baseline commit for every measurement, quotation and diff in this spec: **`adef622`**
(`refactor(RH-23): extract shared toast, alert, band-admin and spotify helpers; add jscpd guard`),
the current `master` HEAD. Every number below was produced by actually running the command on that
tree.

## Summary of the root cause (established, not guessed)

`next.config.ts` lists **`"better-auth"`** in `serverExternalPackages`:

```ts
serverExternalPackages: ["better-auth", "@better-auth/kysely-adapter", "kysely", "pg"],
```

`serverExternalPackages` tells Next.js *not to bundle* a package into the server build. The package
is then loaded at runtime by plain Node resolution, so its own `import 'react'` resolves to
`/Users/heitor/workspace/repertoire_hero/node_modules/react/index.js`.

Next.js does **not** render client components on the server with that copy of React. It renders them
with its own vendored SSR build:

```
node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js
  → module.exports = require('../../module.compiled').vendored['react-ssr'].React
```

So there are two live React module instances during SSR. Only the vendored one has the hook
dispatcher installed (`ReactSharedInternals.H`). `src/lib/auth-client.ts` calls
`createAuthClient()` from **`better-auth/react`** — an externalized module — and
`AppLayout.tsx:169` calls `authClient.useSession()` on it. That hook runs against the *un-vendored*
React, whose dispatcher is `null`, and dereferences it:

```
Invalid hook call. Hooks can only be called inside of the body of a function component.
...
3. You might have more than one copy of React in the same app
⨯ TypeError: Cannot read properties of null (reading 'useRef')
    at AppLayout (src/components/layout/AppLayout.tsx:169:40)
```

This is *not* a missing `"use client"` boundary (`AppLayout.tsx` and `ConditionalLayout.tsx` both
have it), *not* npm-level React duplication (`npm ls react react-dom` shows a single deduped
`19.2.0`; `require.resolve('react', { paths: [require.resolve('better-auth/react')] })` returns the
one and only `node_modules/react/index.js`), and *not* a better-auth or Next.js version bug — the
same structural failure would occur for any externalized package that exports React hooks.

Direct evidence from the compiled Turbopack SSR chunk at `adef622`
(`.next/server/chunks/ssr/[root-of-the-server]__1z4ywbl._.js`) — `a.y(...)` is Turbopack's *external
require* helper, i.e. the module was deliberately left unbundled:

```js
module.exports=[2543,a=>a.a(async(b,c)=>{try{var d=await a.y("better-auth-7619253b5b4ed814/react");
a.n(d),c()}catch(a){c(a)}},!0),29139,...let f=(0,d.createAuthClient)({baseURL:"http://127.0.0.1:3000"});
a.s(["authClient",0,f]),...
```

### A/B proof

Measured on the real repo with real `node_modules`, `rm -rf .next` before each run:

| config | `next dev --webpack` `GET /` | `GET /profile` (signed in) | `next build && next start` `GET /` |
|---|---|---|---|
| `adef622` (with `"better-auth"`) | **500** + `useRef` null | **500** + `useRef` null | **500**, body is `<html id="__next_error__">` |
| `"better-auth"` removed | **200** | **200** | **200**, real app-shell HTML, zero server errors |

### Production is affected

```
$ curl -sI https://repertoire-hero.vercel.app/
HTTP/2 500
x-vercel-id: gru1::iad1::g27pc-1788634906716-a0548d7b95ff      # 2026-09-05T19:01:47 GMT
```

Per-route production probe at the same moment:

| path | status | why |
|---|---|---|
| `/` | **500** | goes through `ConditionalLayout → AppLayout` |
| `/login` | 200 | `ConditionalLayout` returns `children` and skips `AppLayout` |
| `/profile` | 307 → `/login` | anonymous probe is bounced by `src/proxy.ts` before rendering; a signed-in request reaches `AppLayout` and 500s |

The 500 body is Next's error document. The page still hydrates client-side, which is why the app
"looks fine" in a browser while every server response for `/` is a 500 — bad for crawlers, for
Sentry noise, for Vercel error-rate metrics and for any non-JS client.

## Scope

One deliverable: remove the externalization that splits React during SSR, and install two regression
guards (one unit-level, one end-to-end) so the same config edit cannot silently return.

In scope:

1. `next.config.ts` — drop `"better-auth"` from `serverExternalPackages`, with a comment explaining
   why it must never come back.
2. `src/app/layout.tsx` — correct the now-wrong comment above `export const dynamic = "force-dynamic"`,
   which currently blames "better-auth/react hooks aren't available in the server context". The
   directive itself **stays** (removing it would re-enable static prerendering for `/login`,
   `/signup`, `/forgot-password`, `/reset-password` and `/_not-found` — a caching behaviour change
   that belongs to its own task).
3. New unit guard `src/lib/__tests__/serverExternalPackages.test.ts`.
4. New e2e guard `e2e/ssr-smoke.spec.ts`.
5. `playwright.config.ts` — make `webServer.command` overridable by `PLAYWRIGHT_WEB_SERVER` so the
   e2e guard can be pointed at a production `next start` server, defaulting to today's `npm run dev`.
6. `AGENTS.md` — record the architectural rule this bug encodes.
7. `package.json` version bump per the AGENTS.md Version Bumping Rule.

**Not** in scope:

- Removing or narrowing `export const dynamic = "force-dynamic"`.
- Upgrading, downgrading or pinning `better-auth` / `next` / `react`. No dependency change at all;
  `package-lock.json` is expected to be byte-identical to `adef622`.
- Refactoring `AppLayout`/`ConditionalLayout`, or moving `useSession` behind a `ssr: false` dynamic
  boundary. `useSession` renders correctly during SSR once the React instance is correct — proven
  above — so hiding it would be a workaround, not the fix.
- Repairing the pre-existing, unrelated e2e failures listed in "E2E: before and after". They are
  spec drift and test-data pollution, not SSR failures, and several of them are non-deterministic.
  They deserve a separate task.
- `@better-auth/kysely-adapter`, `kysely` and `pg` stay in `serverExternalPackages`. Verified: none
  of them exposes a `./react` subpath (`require.resolve('<pkg>/react')` throws
  `ERR_PACKAGE_PATH_NOT_EXPORTED` for all three), so none can split React.

**Landing Page Rule** (AGENTS.md): this task ships **no** user-facing feature. It is a server-side
bug fix that restores an HTTP status; it is explicitly **not** a selling point.
`src/components/landing/LandingPage.tsx`, `src/i18n/dictionaries/en.json` and
`src/i18n/dictionaries/pt-BR.json` MUST be byte-identical to `adef622` when this task lands.

**Error Handling Conventions** (AGENTS.md): no `try/catch` is added, moved or reshaped anywhere in
`src/`. The two new files are test files; no `catch (x: any)`, no `console.error`.

**NO Browser Alerts** (AGENTS.md): no UI change, so nothing to check beyond the existing
`noBrowserDialogs.test.ts` staying green.

## Approach

### 1. `next.config.ts`

Replace the single line

```ts
  serverExternalPackages: ["better-auth", "@better-auth/kysely-adapter", "kysely", "pg"],
```

with

```ts
  // RH-32: `better-auth` MUST NOT be listed here. serverExternalPackages leaves a package
  // unbundled, so `better-auth/react` would load its own copy of `react` at runtime instead of
  // Next's vendored SSR React — the hook dispatcher is null in that copy and
  // `authClient.useSession()` crashes every SSR render with
  // "Cannot read properties of null (reading 'useRef')". Only Node-only packages with no React
  // entrypoint belong in this list. Guarded by
  // src/lib/__tests__/serverExternalPackages.test.ts.
  serverExternalPackages: ["@better-auth/kysely-adapter", "kysely", "pg"],
```

Nothing else in `next.config.ts` changes. `better-auth`'s *server* half keeps working because the
Node-only leaves it reaches for — `pg` and `kysely` — remain external; verified end to end below
(sign-up 200, sign-in 200, `get-session` 200, `/profile` 200 on a real `next start`).

### 2. `src/app/layout.tsx`

Keep `export const dynamic = "force-dynamic"`; rewrite only its comment so it no longer records a
diagnosis that is now known to be wrong. Suggested text:

```ts
// All routes require authentication, so there is nothing useful to prerender —
// disable static prerendering globally.
// (The "useRef of null" crash this comment used to blame was RH-32: `better-auth`
// was listed in `serverExternalPackages`, which split React during SSR. Fixed in
// next.config.ts; this directive is retained for the caching behaviour, not as a workaround.)
export const dynamic = "force-dynamic";
```

### 3. `src/lib/__tests__/serverExternalPackages.test.ts` (new)

A `node`-environment vitest file — no DB, no server, no network. It imports the real config object
(verified working: `import nextConfig from '../../../next.config'` resolves and type-checks under
the existing vitest setup) and asserts two things:

1. **Specific**: `serverExternalPackages` does not include `'better-auth'`.
2. **General**: for every entry in `serverExternalPackages`, `require.resolve(`${pkg}/react`)` must
   throw. This is the rule the bug violated — a package that ships a React entrypoint can never be
   externalized — and it will also catch a future `@better-auth/*` or any other React-exposing
   package being added to the list.

Shape:

```ts
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import nextConfig from '../../../next.config'

const require_ = createRequire(import.meta.url)

describe('next.config.ts serverExternalPackages', () => {
  const pkgs = nextConfig.serverExternalPackages ?? []

  it('does not externalize better-auth (RH-32)', () => {
    expect(pkgs).not.toContain('better-auth')
  })

  it('externalizes no package that ships a React entrypoint (RH-32)', () => {
    const withReactEntry = pkgs.filter((pkg) => {
      try {
        require_.resolve(`${pkg}/react`)
        return true
      } catch {
        // No `./react` subpath — safe to leave unbundled.
        return false
      }
    })
    expect(withReactEntry).toEqual([])
  })
})
```

The `catch {}` uses the binding-less **S1** form with the required one-line reason comment.

### 4. `e2e/ssr-smoke.spec.ts` (new)

The point of this file is to assert on the **server response**, not on the hydrated DOM — the bug
was invisible to every existing test precisely because the page hydrates fine. It therefore uses
Playwright's `request` fixture (raw HTTP, no JS execution) for the status/body assertions, plus one
browser assertion per audience.

Three tests:

1. `GET / signed out returns a 200 SSR document` — `request.get('/')`;
   `expect(res.status()).toBe(200)`; body must not contain `id="__next_error__"` nor
   `Cannot read properties of null`; body must contain `Repertoire Hero`.
2. `signed-out / renders the landing page in a browser` — default (no) storage state;
   `const res = await page.goto('/')`; `expect(res!.status()).toBe(200)`;
   `await expect(page.locator('nav[aria-label="Main navigation"]')).toHaveCount(0)` (the app shell
   must be absent) and `await expect(page.locator('a[href="/signup"]').first()).toBeVisible()`
   (landing-only element). Deliberately **no copy assertion**: `LandingPage` picks its dictionary
   from the `NEXT_LOCALE` cookie and defaults to `pt-BR`, so asserting English text would be
   locale-coupled and would also conflict with the Landing Page Rule freeze on the dictionaries.
3. A `test.describe` block with `test.use({ storageState: AUTH_STATE_PATH })` (imported from
   `./global-setup`, the same pattern `e2e/songs-crud.spec.ts` already uses):
   `GET /profile signed in returns a 200 SSR document` — `request.get('/profile')` (the `request`
   fixture inherits the storage-state cookies), `expect(res.status()).toBe(200)`, same
   `__next_error__` / `useRef` body assertions, plus a browser check that `/profile` returns 200 and
   renders the app shell.

   **The app-shell locator must be strict-mode-safe.** `nav[aria-label="Main navigation"]` resolves
   to **2** elements in the signed-in DOM — the desktop sidebar and the mobile bottom bar — so a bare
   `await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible()` aborts with a
   Playwright *strict mode violation* (`resolved to 2 elements`) and would fail ER8. Use `.first()`,
   exactly as test 2 already does for its `a[href="/signup"]` locator. Write it as:

   ```ts
   const res = await page.goto('/profile')
   expect(res!.status()).toBe(200)
   await expect(
     page.locator('nav[aria-label="Main navigation"]').first(),
   ).toBeVisible()
   ```

   (`toHaveCount(0)` in test 2 needs no such treatment — count assertions are not subject to strict
   mode. Neither are the `grep -c 'aria-label="Main navigation"'` checks in ER6/ER7: those count
   occurrences in raw HTML via `curl`, so a match count of 2 is expected and passes the `>= 1`
   threshold.)

Note for the implementer, confirmed by measurement: the SSR body of `/` for a signed-out visitor is
the **app shell with a `Loading...` placeholder**, not the landing markup — `authClient.useSession()`
is `isPending` on the server and `src/app/page.tsx:613` returns the loading branch. The landing page
appears after hydration. Test 1 must therefore assert *status + absence of the error document*, and
test 2 (browser) is what asserts "signed out → landing". Do not write an SSR-body assertion for
landing copy; it will fail for reasons unrelated to this bug.

### 5. `playwright.config.ts`

One line:

```ts
  webServer: {
    command: process.env.PLAYWRIGHT_WEB_SERVER ?? 'npm run dev',
    ...
```

Default behaviour is unchanged. This is what makes the guard runnable against a production build:

```bash
npx next build
PLAYWRIGHT_WEB_SERVER='npx next start -p 3000 -H 127.0.0.1' npx playwright test e2e/ssr-smoke.spec.ts
```

### 6. `AGENTS.md`

Add one bullet under **Key architectural decisions** (High-level Architecture), immediately after
the existing "Session gating" bullet:

> - **Never externalize a React-exposing package**: `next.config.ts`'s `serverExternalPackages` may
>   contain only Node-only packages (`pg`, `kysely`, the Kysely adapter). Listing a package that
>   ships React hooks — `better-auth` did, via `better-auth/react` — leaves it unbundled, so it
>   loads its own `react` instead of Next's vendored SSR React and every SSR render dies with
>   `Cannot read properties of null (reading 'useRef')` (RH-32). Enforced by
>   `src/lib/__tests__/serverExternalPackages.test.ts`.

### 7. Version bump

`package.json` `version` must go from `0.1.64-202609031401` to `0.1.65-<YYYYMMDDHHmm>` (local time
of the commit). Highest version used anywhere in `git log` at `adef622` is `0.1.64-202609031401`.

## Verification environment (read before running anything)

- **`BETTER_AUTH_SECRET` is empty in `.env.production.local`** (`BETTER_AUTH_SECRET=""`), and Next
  loads `.env.production.local` ahead of `.env.local` for `next build` / `next start`. With an empty
  secret Better Auth logs
  `[BetterAuthError]: You are using the default secret...` and every sign-in returns 403, so the
  *signed-in* half of the verification is impossible unless the secret is supplied explicitly.
  Export it from `.env.local` when starting the production server:

  ```bash
  BETTER_AUTH_SECRET="$(grep '^BETTER_AUTH_SECRET=' .env.local | cut -d= -f2- | tr -d '"')" \
    npx next start -p 3000 -H 127.0.0.1
  ```

  The signed-out `GET /` check works with or without the secret.
- **Port must be 3000.** `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` in `.env.local` are
  `http://127.0.0.1:3000`; on any other port Better Auth rejects the request with
  `ERROR [Better Auth]: Invalid origin`.
- **Postgres must be up** (`docker compose up -d`, port 5432) for the signed-in checks and for the
  full vitest suite.
- **Nothing else may be listening on 3000** when running the Playwright production variant —
  `reuseExistingServer` is true locally and would silently reuse a stale dev server.
- Use `npx next build`, not `npm run build`: the npm script also runs `scripts/migrate.mjs` and
  `scripts/deduplicate-songs.mjs` against the database, which is unnecessary here.

## Baselines at `adef622` (all re-measured for this spec)

| gate | command | result at `adef622` |
|---|---|---|
| unit | `npx vitest run` | `Test Files 29 passed (29)` / `Tests 279 passed (279)`, exit 0 |
| types | `npx tsc --noEmit` | exit 0, `TypeScript: No errors found` |
| lint | `npx eslint .` | `✖ 30 problems (12 errors, 18 warnings)`, **exit 1** — this is the accepted baseline, lint is *never* required to exit 0 |
| dead code | `npm run lint:dead` | exit 0 |
| duplication | `npm run lint:dup` | exit 0 |
| build | `npx next build` | exit 0 |
| SSR `/` | `next start` + `curl` | **HTTP 500** |
| e2e | `npx playwright test` | **exit 1, zero tests executed**: `Error: Timed out waiting 120000ms from config.webServer.` |

## E2E: before and after

The e2e situation at `adef622` is worse than "3 failing tests": `webServer.url` is
`http://127.0.0.1:3000`, the readiness probe requires a non-error response, and `/` returns 500 — so
Playwright never starts the suite at all.

| | `adef622` | with the fix |
|---|---|---|
| `npx playwright test` outcome | aborts after 120 s with `Timed out waiting 120000ms from config.webServer`; **0 of 13 tests run** | webServer becomes ready; **all 13 tests execute** |
| observed results | n/a | run A: 7 passed / 6 failed · run B: 6 passed / 7 failed |

The residual failures are **pre-existing and out of scope**, and two independent full-suite runs
produced *different* failure sets, so no exact count may be used as an acceptance criterion:

- `e2e/auth.spec.ts:52` "unauthenticated user is redirected to /login" and `:59` "redirect param is
  honoured after login" fail **deterministically** and correctly: `src/proxy.ts` now treats `/` as a
  public path (`pathname === '/'`), so a signed-out visit to `/` renders the landing page instead of
  redirecting. These assertions were made obsolete by the landing-page feature, not by RH-32.
- `e2e/songs-crud.spec.ts`, `e2e/bands-confirm.spec.ts` and `e2e/fast-view-mobile.spec.ts` fail
  intermittently on `expect(locator('dialog[open]')).toHaveCount(0)` — accumulated test-data
  pollution in the local database across repeated runs.

Acceptance therefore pins only what this fix actually controls: the webServer probe no longer times
out, and `e2e/ssr-smoke.spec.ts` passes 100 %.

## Post-merge verification (not an acceptance criterion — QA runs pre-merge)

After the Vercel deployment for this change is live:

```bash
curl -sI https://repertoire-hero.vercel.app/ | head -1     # expect: HTTP/2 200
```

Sentry should stop receiving the `Cannot read properties of null (reading 'useRef')` server event
for the `/` and `/profile` transactions.

## Expected Results

This section is the acceptance criteria, verbatim and in full. It is identical to the
`expected_results` carried on the Meridian task, which is all QA receives — there is no expanded
form kept anywhere else.

- [ ] ER1 - From /Users/heitor/workspace/repertoire_hero: grep -c '"better-auth"' next.config.ts prints exactly 0, and grep -nE '^\s*serverExternalPackages:' next.config.ts prints exactly one line, whose array is ["@better-auth/kysely-adapter", "kysely", "pg"]. The pattern is deliberately scoped to the declaration: the explanatory comment lines above it also mention serverExternalPackages and must not be counted. Baseline at adef622: the same grep -c printed 1.
- [ ] ER2 - The file src/lib/__tests__/serverExternalPackages.test.ts exists; npx vitest run src/lib/__tests__/serverExternalPackages.test.ts exits 0 and prints Test Files 1 passed (1) with at least 2 tests passed and 0 failed. Mutation check: first back up the fixed file with cp next.config.ts /tmp/rh32-next.config.bak; then hand-edit next.config.ts to re-add "better-auth" as the first element of the serverExternalPackages array and re-run the same command - it must now exit non-zero; then restore with cp /tmp/rh32-next.config.bak next.config.ts and confirm grep -c '"better-auth"' next.config.ts prints 0 again. Do NOT restore with git checkout -- next.config.ts: the fix may still be uncommitted, and that would reinstate the broken adef622 config and invalidate every later ER.
- [ ] ER3 - npx vitest run exits 0 and prints Test Files 30 passed (30) and a Tests N passed (N) line with N >= 281, with no failed and no skipped tests. Baseline at adef622: Test Files 29 passed (29) / Tests 279 passed (279).
- [ ] ER4 - npx tsc --noEmit exits 0; npm run lint:dead exits 0; npm run lint:dup exits 0; npx eslint . prints a final summary line with no more than 12 errors and no more than 18 warnings (baseline at adef622 is 30 problems (12 errors, 18 warnings)) - eslint's non-zero exit code is expected and must NOT be treated as a failure.
- [ ] ER5 - rm -rf .next && npx next build exits 0; its output contains zero occurrences of Invalid hook call and zero occurrences of Cannot read properties of null. (Lines reading [Error [BetterAuthError]: You are using the default secret... are expected and acceptable: .env.production.local sets BETTER_AUTH_SECRET="".)
- [ ] ER6 - With docker Postgres running on 5432 and nothing listening on port 3000, after ER5's build, start the server with the real secret: BETTER_AUTH_SECRET="$(grep '^BETTER_AUTH_SECRET=' .env.local | cut -d= -f2- | tr -d '"')" npx next start -p 3000 -H 127.0.0.1 > /tmp/rh32-server.log 2>&1 & then sleep 8. curl -s -o /tmp/rh32-root.html -w "%{http_code}\n" http://127.0.0.1:3000/ prints 200; grep -c '__next_error__' /tmp/rh32-root.html prints 0; grep -c 'Cannot read properties of null' /tmp/rh32-root.html prints 0; grep -c 'aria-label="Main navigation"' /tmp/rh32-root.html prints a number >= 1; grep -cE 'Invalid hook call|useRef' /tmp/rh32-server.log prints 0. Baseline at adef622: the same curl printed 500 and the body began <!DOCTYPE html><html id="__next_error__">. Port must be 3000 - on any other port Better Auth answers Invalid origin.
- [ ] ER7 - Against the same server started in ER6: curl -s -X POST http://127.0.0.1:3000/api/auth/sign-up/email -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:3000' -d '{"email":"rh32-qa@example.com","password":"E2eTestPassword1!","name":"RH32 QA"}' -o /tmp/rh32-signup.json -w "%{http_code}\n" prints 200 (on a repeat run a non-2xx whose /tmp/rh32-signup.json contains USER_ALREADY_EXISTS is equally acceptable); curl -s -X POST http://127.0.0.1:3000/api/auth/sign-in/email -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:3000' -d '{"email":"rh32-qa@example.com","password":"E2eTestPassword1!"}' -c /tmp/rh32-cookies.txt -o /dev/null -w "%{http_code}\n" prints 200; curl -s -b /tmp/rh32-cookies.txt -o /tmp/rh32-profile.html -w "%{http_code}\n" http://127.0.0.1:3000/profile prints 200; grep -c '__next_error__' /tmp/rh32-profile.html prints 0; grep -c 'aria-label="Main navigation"' /tmp/rh32-profile.html prints a number >= 1. Then stop the server with pkill -f 'next start -p 3000'. Baseline at adef622: the /profile curl printed 500.
- [ ] ER8 - The file e2e/ssr-smoke.spec.ts exists and asserts on raw HTTP responses (Playwright request fixture), not only on hydrated DOM. Its browser assertions must use strict-mode-safe locators (such as page.locator('nav[aria-label="Main navigation"]').first()), because nav[aria-label="Main navigation"] matches 2 elements in the signed-in DOM (desktop sidebar + mobile bottom bar) and a bare locator aborts with a Playwright strict mode violation. (a) With nothing listening on port 3000, npx playwright test e2e/ssr-smoke.spec.ts --project=chromium exits 0, its summary reports N passed with N >= 3 and 0 failed, and its output contains zero occurrences of Timed out waiting 120000ms from config.webServer. (b) After npx next build, BETTER_AUTH_SECRET="$(grep '^BETTER_AUTH_SECRET=' .env.local | cut -d= -f2- | tr -d '"')" PLAYWRIGHT_WEB_SERVER='npx next start -p 3000 -H 127.0.0.1' npx playwright test e2e/ssr-smoke.spec.ts --project=chromium exits 0 with the same conditions. Baseline at adef622: npx playwright test exited 1 after ~120s with Error: Timed out waiting 120000ms from config.webServer. and executed 0 of 13 tests. Do NOT require the other e2e specs to pass - e2e/auth.spec.ts:52, e2e/auth.spec.ts:59, e2e/songs-crud.spec.ts, e2e/bands-confirm.spec.ts and e2e/fast-view-mobile.spec.ts fail for pre-existing, partly non-deterministic reasons unrelated to this task.
- [ ] ER9 - git diff adef622 --stat -- src/components/landing/LandingPage.tsx src/i18n/dictionaries/en.json src/i18n/dictionaries/pt-BR.json produces empty output (Landing Page Rule: this task is a server-side bug fix restoring an HTTP status, explicitly not a selling point, so no landing copy changes in either dictionary).
- [ ] ER10 - node -p "require('./package.json').version" prints a version strictly greater than 0.1.64-202609031401 and matching the pattern 0.1.<patch>-<YYYYMMDDHHmm> (e.g. 0.1.65-202609051930); and git diff adef622 --stat -- package-lock.json produces empty output (no dependency change).
- [ ] ER11 - git diff adef622 --name-only lists only paths drawn from this whitelist and nothing else: AGENTS.md, docs/suggestions-log.md, docs/tasks/RH-32-spec.md, e2e/ssr-smoke.spec.ts, next.config.ts, package-lock.json, package.json, playwright.config.ts, src/app/layout.tsx, src/lib/__tests__/serverExternalPackages.test.ts.
- [ ] ER12 - grep -c 'serverExternalPackages' AGENTS.md prints a number >= 1 and grep -c 'RH-32' AGENTS.md prints a number >= 1; the matching text states that a package exposing React hooks (such as better-auth via better-auth/react) must never be listed in serverExternalPackages, because it would load its own React copy and break SSR.
- [ ] ER13 - grep -c 'force-dynamic' src/app/layout.tsx prints a number >= 1 (the export const dynamic = "force-dynamic" directive is retained) and grep -c 'available in the server context' src/app/layout.tsx prints 0 (the stale, incorrect root-cause comment has been replaced).

## Scope whitelist

`git diff adef622 --name-only` may list only:

```
AGENTS.md
docs/suggestions-log.md
docs/tasks/RH-32-spec.md
e2e/ssr-smoke.spec.ts
next.config.ts
package-lock.json          (only if a dependency actually changes — none is expected)
package.json
playwright.config.ts
src/app/layout.tsx
src/lib/__tests__/serverExternalPackages.test.ts
```
