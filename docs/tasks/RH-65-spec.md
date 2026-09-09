# RH-65 — Server Components parte 5/5: tornar src/proxy.ts uma conveniencia de redirect estreita e documentada

Parent: RH-41 (F10, part 5 of 5). Depends on RH-64 (`6aa099c`, done).
Baseline for every measurement in this document: `6aa099c`
(`feat(RH-64): reduce useBandAdmin to data plus intent commands`).

## Scope

Rewrite exactly one module - `src/proxy.ts`, 55 lines - so that it stops being
an expensive, repo-wide session gate and becomes a narrow, declared redirect
convenience, and rewrite its suite `src/lib/__tests__/proxy.test.ts` against the
new behaviour. Three things change and nothing else:

1. **Session resolution.** The `fetch` to the app's own
   `/api/auth/get-session` (with an `AbortController`, a 3000 ms timeout and a
   `catch` that treats every failure as "unauthenticated") is replaced by a
   direct, synchronous read of the Better Auth session cookie through
   `getSessionCookie` from `better-auth/cookies`. No network call, no timeout,
   no failure mode.
2. **The matcher.** The single negative-lookahead pattern that matches every
   path in the application except a handful of asset extensions is replaced by
   an explicit allow-list of the twelve routes that actually need a redirect.
   The list is in `## Approach` below and is reproduced verbatim in the file.
3. **The declaration.** A top-of-file comment states that `src/proxy.ts` is not
   an authorization boundary and that no page, action or route handler may rely
   on it; AGENTS.md records the same declaration, and gains the architecture
   bullet that names the Server Component page pattern RH-62 and RH-63
   established.

One route relies on the proxy for its authorization today and therefore changes
with it: `src/app/api/spotify/search/route.ts` has no session check of its own
and is reachable only because the current matcher covers `/api/**`. It gains a
`getRequiredUserId()` prologue answering `401`, which is the concrete half of
F10's "so no action or route may rely on it".

**Behaviour is preserved for every page route, signed in and signed out.** The
complete unauthenticated HTTP table measured at `6aa099c` (see `## Audit`) must
come out byte-identical afterwards, with exactly two deliberate exceptions,
both under `/api/`: `/api/spotify/search` answers `401` instead of a `307` to
an HTML login page, and `/api/spotify/playlists` answers its own
`{"connected":false}` instead of that same `307`. For a signed-in user nothing
changes anywhere.

This is F10 and nothing else. It is not a page conversion, it does not touch
`useBandAdmin`, and it does not close any finding in
`docs/plans/code-quality-review.md`.

## Audit at 6aa099c

### `src/proxy.ts` - 55 lines

Next.js 16 renamed Middleware to Proxy; `src/proxy.ts` is that file
(`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md:15`,
"Starting with Next.js 16, Middleware is now called Proxy to better reflect its
purpose. The functionality remains the same"). `npm run build` at `6aa099c`
prints `f Proxy (Middleware)` under the route table, so it is wired.

The file holds one `PUBLIC_PATHS` array (line 3), one exported `async function
proxy` (lines 5-49) and one `config.matcher` (lines 51-55). Its shape today:

- `isPublicPath` is `pathname === '/'` or a prefix hit on `/login`, `/signup`,
  `/forgot-password`, `/reset-password`, `/api/auth/`, `/api/dev/`, `/join/`.
- `skipSession` is a prefix hit on `/api/auth/`, `/api/dev/`, `/join/` only.
  Every other matched path - including `/`, every API route under
  `/api/spotify/`, and any 404 path - performs the session round trip.
- The session round trip is `fetch(new URL('/api/auth/get-session',
  request.url), { headers: { cookie: ... }, signal })` behind a 3000 ms
  `AbortController`. Its `catch` (line 28) is what F10 calls failing open: any
  network error, any 5xx, and the 3-second timeout all resolve to `user =
  null`, and because `null` means "redirect to /login" the practical effect of
  a slow or unreachable database is that every navigation in the app becomes a
  `307` to `/login`. There is no caching of any kind, so a single navigation
  that triggers a prefetch resolves the session more than once.
- Unauthenticated and not public: `307` to `/login`, with the original query
  string preserved by `request.nextUrl.clone()` and `redirect=<pathname>`
  appended.
- Authenticated and on one of the four auth pages: `307` to `/`, again with the
  original query string preserved.
- The matcher is a single string,
  `'/((?!_next/static|_next/image|favicon.ico|pdf\\.worker\\.min\\.mjs|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'`.

### The route inventory and who redirects whom

`npm run build` at `6aa099c` reports 27 entries. The page routes and how an
unauthenticated visitor is turned away today:

| Route | Kind | Who redirects |
| --- | --- | --- |
| `/` | client page, renders `LandingPage` when signed out | nobody, and nobody may |
| `/login` `/signup` `/forgot-password` `/reset-password` | client pages | proxy, in reverse: a signed-in visitor goes to `/` |
| `/profile` `/settings` | client pages | proxy |
| `/bands/[id]` `/playlists/[id]` | client pages | proxy |
| `/songs/search` `/songs/[id]/fast-view` | page and client page | proxy |
| `/bands` `/playlists` `/admin/moderation` | async Server Components (RH-62, RH-63) | proxy first; each page also calls `redirect("/login")` as defence in depth |
| `/join/[code]` | async Server Component, deliberately anonymous | nobody |
| `/api/**` | route handlers | proxy for `/api/spotify/*`; `/api/auth/*` and `/api/dev/*` are skipped |

Measured, with a fresh `npm run build`, `export BETTER_AUTH_SECRET="$(grep
'^BETTER_AUTH_SECRET=' .env.local | cut -d= -f2-)"`, `npx next start -p 3401 -H
127.0.0.1` and no cookie sent - this is the table the change must preserve:

```
/                          200
/login                     200
/signup                    200
/bands                     307 -> /login?redirect=%2Fbands
/playlists                 307 -> /login?redirect=%2Fplaylists
/admin/moderation          307 -> /login?redirect=%2Fadmin%2Fmoderation
/profile                   307 -> /login?redirect=%2Fprofile
/settings                  307 -> /login?redirect=%2Fsettings
/songs/search              307 -> /login?redirect=%2Fsongs%2Fsearch
/songs/abc/fast-view       307 -> /login?redirect=%2Fsongs%2Fabc%2Ffast-view
/bands/abc                 307 -> /login?redirect=%2Fbands%2Fabc
/playlists/abc             307 -> /login?redirect=%2Fplaylists%2Fabc
/join/ABCDEF               200
/api/auth/get-session      200
/icon.jpg                  200
/api/spotify/search?q=x    307 -> /login?q=x&redirect=%2Fapi%2Fspotify%2Fsearch
/api/spotify/playlists     307 -> /login?redirect=%2Fapi%2Fspotify%2Fplaylists
/nope                      307 -> /login?redirect=%2Fnope
```

The same table with a syntactically invalid session cookie
(`better-auth.session_token=garbage.value`) gives `/profile` `307`, `/bands`
`307` and `/login` `200`: the current file resolves the session for real, so a
cookie that does not correspond to a live session is exactly as good as no
cookie. That is the one behaviour a presence check cannot reproduce, and
`## Approach` decides it explicitly.

### Why the three Server Component pages must stay matched

`/bands`, `/playlists` and `/admin/moderation` each call `redirect("/login")`
themselves, so it is tempting to drop them from the matcher. Measured, that is
wrong. `src/app/loading.tsx` exists, which puts a Suspense boundary above every
segment, and in a streaming context Next.js does not answer a Server Component
`redirect()` with a `307` - it flushes the loading shell and emits a client-side
meta refresh. Verified on a scratch Next.js 16 app built from this repository's
own `node_modules`, with a root `loading.tsx` and a page that awaits `headers()`
and then redirects: `curl -o /dev/null -w '%{http_code}'` prints `200`, and the
document contains

```
<meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/login?redirect=%2Fbands"/>
```

behind the `Carregando...` spinner. So removing those three from the matcher
would turn an immediate `307` into a one-second client-side bounce through a
spinner. They stay matched, their own `redirect("/login")` stays defence in
depth, and the header comments in `src/app/bands/page.tsx:20-22` and
`src/app/playlists/page.tsx:30-32` ("`src/proxy.ts` already answers an
unauthenticated request with a 307 to /login; the redirect below is defence in
depth") remain true and are not edited.

### Why `/` must stay unmatched

`/` is public today (`pathname === '/'`) and must stay public: `src/app/page.tsx`
renders `<LandingPage />` when `authClient.useSession()` has no user
(`src/app/page.tsx:635-636`), so a redirect there would delete the marketing
page. F10's objection to `/` being public was that Server Actions bound to the
dashboard POST to `/` and several actions did not resolve their own session -
F1, F2 and F7. Those are closed: every exported Server Action is proved to
resolve a session and to refuse to run without one by
`src/app/actions/__tests__/actionSessionGuard.test.ts` (which mocks `@/lib/db`
to throw, so reaching the database at all without a session fails) and
`src/app/actions/__tests__/actionAuthorizationGuard.test.ts`. Next's own
documentation makes the same point about matchers and Server Functions
(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:249-251`):
"Always verify authentication and authorization inside each Server Function
rather than relying on Proxy alone."

Keeping `/` out of the matcher is also what removes the self-`fetch` from the
landing page and the dashboard entirely, and it is load bearing for the
stale-cookie recovery described in `## Approach`.

### `better-auth/cookies` in the installed version

`better-auth` is `1.6.22`. `node_modules/better-auth/package.json` exports
`./cookies`, and `require.resolve('better-auth/cookies')` resolves to
`node_modules/better-auth/dist/cookies/index.mjs`, which exports
`getSessionCookie(request: Request | Headers, config?) => string | null`
(declared at `dist/cookies/index.d.mts:99-103`). Its implementation
(`dist/cookies/index.mjs:207-217`) reads the `cookie` header, parses it, and
returns the first hit among `__Secure-better-auth.session_token`,
`better-auth.session_token` and `better-auth-session_token`. It performs no
I/O, no signature verification and no database access.

Import-graph check: walking every relative and `@better-auth/core` import
reachable from `dist/cookies/index.mjs` reaches 28 files and **zero** Node
built-ins, so the module is runtime-agnostic. It is also moot for correctness:
`proxy.md:253` records that "Proxy defaults to using the Node.js runtime" in
Next.js 16, so the Edge-Runtime reasoning in the current file's comment
(lines 9-12) is itself stale. The reason not to import `@/lib/auth` remains
cost, not runtime: it would open a `pg` pool and hit the database on every
matched request, which is the opposite of what F10 asks for.

Behaviour verified directly against `NextRequest` from this repository's
`next/server`:

```
no cookie                                        -> null
better-auth.session_token=abc.def                -> "abc.def"
__Secure-better-auth.session_token=abc.def       -> "abc.def"
foo=bar                                          -> null
better-auth.session_token=                       -> null
```

`src/lib/auth.ts` sets no `advanced.cookiePrefix` and no custom cookie name, and
`dist/cookies/index.mjs:210` defaults the prefix to `better-auth`, so the names
`getSessionCookie` looks for are the ones this app issues. Confirmed against the
running app at `6aa099c`: `POST /api/auth/sign-in/email` answers
`set-cookie: better-auth.session_token=<token>.<signature>; Max-Age=604800;
Path=/; HttpOnly; SameSite=Lax`.
TypeScript resolves the subpath types because `tsconfig.json` sets
`moduleResolution: "bundler"`.

### `src/lib/__tests__/proxy.test.ts` - 87 lines, 7 tests

The existing suite lives at `src/lib/__tests__/proxy.test.ts` (node
environment, no jsdom preamble), imports `{ proxy as middleware }` from
`../../proxy`, and stubs `fetch` globally with `vi.stubGlobal` because the
current implementation calls the session endpoint. Its seven tests are:
`should redirect unauthenticated users to /login for private paths`, `should
allow unauthenticated users to access public paths without redirect`, `should
allow unauthenticated users to access API auth paths without redirect`, `should
redirect authenticated users on /login to root /`, `should redirect
authenticated users on /signup to root /`, `should allow authenticated users to
access private paths without redirect`, `should treat fetch failure as
unauthenticated and redirect to /login`. Every one of them is written in terms
of the mocked `fetch`, so the whole file is rewritten rather than amended.

### The other file that reads the matcher

`src/lib/__tests__/pdfWorkerAsset.test.ts:70-73` compiles each entry of
`proxyConfig.matcher` with `new RegExp('^' + matcher + '$')` and asserts, at
lines 127-137, that no pattern matches `/pdf.worker.min.mjs` and that at least
one matches `/songs/1/fast-view`. This constrains the new matcher: every entry
must still be a valid regular-expression source. The allow-list in
`## Approach` satisfies it (`^/songs/(.*)$` matches `/songs/1/fast-view`; none
of the twelve matches `/pdf.worker.min.mjs`), so **that file is not edited**,
and its continuing to pass is the cheapest available proof that the new matcher
is well formed.

### `src/app/api/spotify/search/route.ts` - the one route relying on the proxy

Of the ten route handlers, `/api/auth/[...all]` is Better Auth's own,
`/api/dev/profiles` 404s outside development, `/api/auth/spotify/*` are already
outside the proxy's session check (`skipSession` covers `/api/auth/`),
`/api/spotify/playlists` resolves `getRequiredUserId()` itself and degrades to
`{"connected":false}`, and the three `/api/spotify/playlists/[id]/*` handlers go
through `resolveSpotifyRouteAccess` in `src/lib/spotifyRouteAuth.ts`. That
leaves `src/app/api/spotify/search/route.ts`, whose `GET` (line 66) checks
`SPOTIFY_CLIENT_ID`, then the `q` parameter, then calls Spotify with a Client
Credentials token. It has no session check at all. No test imports it; the
only caller is `searchSpotify` in `src/lib/spotify.ts:23`, used by
`src/app/page.tsx:172` and `src/app/playlists/[id]/page.tsx:375`, both of which
run in a signed-in browser.

### Gates at 6aa099c

- `rtk proxy npx vitest run`: `Test Files 100 passed (100)`, `Tests 1138 passed
  (1138)`, 0 failed, 0 skipped (Postgres at
  `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations
  applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`).
- `rtk proxy npx eslint .`: `22 problems (8 errors, 14 warnings)`.
- `./node_modules/.bin/tsc --noEmit`: clean.
- `npm run lint:dead`: clean. `npm run audit`: clean.
- `npm run lint:dup`: `Found 18 clones.`, `Total:` row `18` clones,
  `231 (0.64%)` duplicated lines, `1359 (0.70%)` duplicated tokens.
- `npm run test:coverage`: statements `97.58`, branches `86.26`, functions
  `99.73`, lines `98.07` against thresholds 80 / 65 / 78 / 80. Per file,
  `src/proxy.ts` is at `96.4` statements, `75` functions, `94.4` branches - the
  missing function is the `() => controller.abort()` timeout arrow, which no
  test can reach.
- `eslint.config.mjs` holds exactly `20` `complexity-budget/override` entries,
  `MAX_OVERRIDES = 20` in `src/lib/__tests__/complexityBudget.test.ts`, and
  AGENTS.md line 94 ends on "past 20 entries". `src/proxy.ts` carries no
  override and needs none.
- `package.json` version `0.1.94-202609091542`.
- Playwright: `e2e/bands-confirm.spec.ts` (4 tests, with the known intermittent
  `Loading...` flake logged under RH-64), `e2e/server-pages.spec.ts` (4),
  `e2e/ssr-smoke.spec.ts` (4) and `e2e/auth.spec.ts --grep credentials` (2) are
  green. `e2e/songs-crud.spec.ts` and `e2e/fast-view-mobile.spec.ts` are red at
  baseline (RH-44). The two `e2e/auth.spec.ts` tests that navigate to `/` and
  wait for `/login` are red at baseline too - `/` is public and renders the
  landing page - and this task neither fixes nor touches them.

## Approach

### `src/proxy.ts`

The file becomes a declaration comment, one constant, one synchronous exported
function and the matcher. No `async`, no `await`, no `fetch`, no
`AbortController`, no `setTimeout`, no `try`/`catch` - there is nothing left
that can fail.

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'

/**
 * NOT AN AUTHORIZATION BOUNDARY (RH-65, code-quality review F10).
 *
 * This file is a redirect convenience and nothing else. It answers one
 * question, from the request headers alone: does this request carry a Better
 * Auth session cookie? It never validates that cookie, never asks the
 * database, and never talks to the app over HTTP.
 *
 * A present cookie therefore proves nothing: it may be expired, revoked or
 * signed by a different secret. A page, a Server Action or a route handler
 * that skips its own session check because "the proxy already redirects" is a
 * bug. Every Server Action resolves its own session
 * (src/app/actions/__tests__/actionSessionGuard.test.ts), every route handler
 * under src/app/api/ answers its own 401, and the three Server Component pages
 * call redirect("/login") themselves. That is where authorization lives.
 *
 * What this file buys is that a signed-out visitor who types /profile gets an
 * immediate 307 instead of a client-rendered page that would sit on a spinner.
 * The matcher below is an allow-list of exactly the routes that need that.
 * A new private page route does not inherit the redirect - add it here.
 */

const AUTH_PAGES = ['/login', '/signup', '/forgot-password', '/reset-password']

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isAuthPage = AUTH_PAGES.includes(pathname)
  const hasSessionCookie = getSessionCookie(request) !== null

  // No cookie on a gated route: send them to /login, remembering where they
  // were headed. `clone()` keeps the original query string, as before.
  if (!hasSessionCookie && !isAuthPage) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // A cookie on an auth page: they are (probably) already signed in.
  if (hasSessionCookie && isAuthPage) {
    const homeUrl = request.nextUrl.clone()
    homeUrl.pathname = '/'
    return NextResponse.redirect(homeUrl)
  }

  return NextResponse.next()
}
```

Both `clone()` calls and the `redirect=<pathname>` parameter are copied
verbatim from the current file so the `Location` headers in the audit table come
out identical, query string included.

### The narrowed matcher

```ts
export const config = {
  matcher: [
    // Auth pages: a visitor who already carries a session cookie is sent home.
    '/login',
    '/signup',
    '/forgot-password',
    '/reset-password',
    // Client-rendered private routes: nothing on the server turns a signed-out
    // visitor away, so without this they would sit on a spinner.
    '/profile',
    '/settings',
    '/bands/(.*)',
    '/playlists/(.*)',
    '/songs/(.*)',
    // Server Component routes that redirect themselves. They stay here because
    // src/app/loading.tsx makes their own redirect() a streamed meta refresh
    // (HTTP 200 behind a spinner) rather than a 307 - see the audit above.
    '/admin/(.*)',
    '/bands',
    '/playlists',
  ],
}
```

Twelve entries, every one a literal path or an anchored regular-expression
source, which is what keeps `pdfWorkerAsset.test.ts` working unchanged. Written
in the file in the order above; sorted, the list is `/admin/(.*)`, `/bands`,
`/bands/(.*)`, `/forgot-password`, `/login`, `/playlists`, `/playlists/(.*)`,
`/profile`, `/reset-password`, `/settings`, `/signup`, `/songs/(.*)`.

Deliberately **not** matched, each for a stated reason:

- `/` - public by design (landing page for signed-out visitors, dashboard for
  signed-in ones), and the one route whose render is guaranteed to call
  `/api/auth/get-session` on the client.
- `/join/(.*)` - the invite route is anonymous on purpose.
- `/api/(.*)` - a `307` to an HTML login page is not a useful answer to a
  `fetch`, and F10 says no route may rely on the proxy. Each handler already
  owns its answer; `/api/spotify/search` is made to own its answer below.
- everything else - `/_next/*`, `/icon.jpg`, `/favicon.ico`, `robots.txt`, and
  any path that is not a route at all. `/nope` stops being a `307` to `/login`
  and becomes the `404` it always was.

### What changes for a visitor, exactly

For a signed-in visitor: nothing, anywhere. For a signed-out visitor with no
cookie: nothing on any page route (the audit table is reproduced exactly), and
under `/api/` the two deliberate changes named in `## Scope`. `/nope` becomes a
`404`.

For a visitor carrying a session cookie that is not backed by a live session -
the only case a presence check cannot reproduce - the behaviour differs and the
difference is accepted:

- On a gated private route the request now passes through instead of being
  bounced. The page's own `authClient.useSession()` resolves to no user and it
  renders its signed-out state. That is the cost of the file no longer being an
  authorization boundary, and it is exactly what the declaration comment says.
- On an auth page the visitor is bounced to `/`. Because `/` is not matched, it
  renders, and `authClient.useSession()` issues `GET /api/auth/get-session`,
  which - for a cookie whose signature verifies but whose session row is gone
  or expired - answers `null` **and** sends a `Set-Cookie` that clears the stale
  token (`node_modules/better-auth/dist/api/routes/session.mjs:180-189`). This
  was measured against the real app at `6aa099c`: sign in over
  `/api/auth/sign-in/email`, delete the matching row from `session`, replay the
  same cookie against `/api/auth/get-session`, and the answer carries
  `set-cookie: better-auth.session_token=; Max-Age=0; Path=/; HttpOnly;
  SameSite=Lax`. The next click on "Sign in" therefore reaches `/login`
  normally. Keeping `/` and `/api/auth/(.*)` out of the matcher is what makes
  that recovery reachable, and matcher test 15 pins it.
- The residual case is a cookie whose signature does **not** verify at all -
  hand-crafted, or issued under a rotated `BETTER_AUTH_SECRET`. Better Auth
  does not clear that one, so the visitor is bounced off the auth pages until
  the cookie expires or is cleared by hand. This is the failure mode of the
  presence check Better Auth itself documents for Next.js middleware, and
  closing it means verifying the cookie's HMAC in the proxy. That is not in
  this task; the implementer records it in `docs/suggestions-log.md` as a
  follow-up candidate, together with the option of a `/login?signout=1` escape
  hatch.

### `src/app/api/spotify/search/route.ts`

A session prologue is added as the **first** statement of `GET`, above the
`SPOTIFY_CLIENT_ID` check, so the answer is deterministic in an environment
with no Spotify credentials:

```ts
try {
  await getRequiredUserId()
} catch {
  return NextResponse.json({ error: 'Not authenticated', code: 401 }, { status: 401 })
}
```

`getRequiredUserId` comes from `@/lib/auth-session`, the same import
`/api/spotify/playlists/route.ts` uses. The envelope shape (`error` plus `code`,
a fixed message, never the raw exception text) is convention R1 from AGENTS.md.
Nothing else in the file changes: the search itself, the token cache, the
`400` on a missing `q` and the existing `catch` are untouched.

### `src/lib/__tests__/proxy.test.ts`

Rewritten in place, staying in the node environment with no jsdom preamble and
keeping the `import { proxy as middleware } from '../../proxy'` entry point.
`vi.stubGlobal('fetch', ...)` and the `mockSession` helper are deleted; in their
place the suite installs a `vi.spyOn(globalThis, 'fetch')` purely so that one
test can assert it is never called. Requests are built as
`new NextRequest(new URL('http://localhost/profile'), { headers: { cookie: '...' } })`,
which is verified to drive `getSessionCookie` correctly.

Seventeen tests in two `describe` blocks. Session resolution:

1. `redirects a cookieless request for a private route to /login with the path in the redirect param`
2. `passes a request that carries a Better Auth session cookie straight through`
3. `accepts the __Secure- prefixed session cookie used in production`
4. `treats an empty session cookie value as no session`
5. `ignores unrelated cookies when deciding whether a session cookie is present`
6. `resolves the session without ever calling fetch`
7. `preserves the original query string when it redirects to /login`
8. `redirects a request carrying a session cookie away from /login to the root`
9. `redirects a request carrying a session cookie away from /signup to the root`
10. `leaves a cookieless request for /login untouched`
11. `leaves a cookieless request for /forgot-password and /reset-password untouched`
12. `passes a present but unvalidated session cookie through to the page, which owns the authorization decision`

Matcher:

13. `matches every client-rendered private route`
14. `matches the four auth pages`
15. `does not match /, the invite route or any route under /api`
16. `does not match static assets, the pdf worker or an unknown path`
17. `lists exactly twelve matcher entries, each a valid regular-expression source`

Tests 13-17 compile `config.matcher` the same way `pdfWorkerAsset.test.ts` does
(`new RegExp('^' + entry + '$')`) and assert against an explicit table of paths,
so the allow-list cannot be widened or narrowed without the test saying so.

### AGENTS.md

Four edits, all inside the existing text:

1. The architecture diagram line
   `├─ src/proxy.ts  (Next.js middleware — session gate on every request)`
   becomes a line saying it is a Next.js Proxy that redirects on an allow-list
   of routes and is not an authorization boundary.
2. The "Session gating" key-decision bullet is replaced by a **"Redirect
   convenience, not an authorization boundary"** bullet carrying the same
   declaration as the file header: `src/proxy.ts` checks only for the presence
   of the Better Auth session cookie, reads it directly from the request
   headers (never through a `fetch` to the app), runs on an explicit twelve-
   entry allow-list, and may not be relied on by any page, Server Action or
   route handler; a new private page route must be added to the matcher to get
   the redirect.
3. A new key-decision bullet names the Server Component page pattern that RH-62
   and RH-63 established, which parts 3 and 4 asked part 5 to settle:
   `/bands`, `/admin/moderation` and `/playlists` are async Server Components
   that read through `src/lib` directly, call `redirect("/login")` themselves,
   and inject their Server Actions into `"use client"` islands under
   `src/components/<area>/` as a typed actions object - the same
   import-direction rule (F21) that Fast View follows. New read-only page
   routes follow it. The three route names must sit on one physical line of
   the file, in the order `/bands`, `/admin/moderation`, `/playlists`, because
   ER8 greps for them that way.
4. The directory-structure line
   `└── proxy.ts                    Next.js middleware — session-gates all non-public routes`
   is updated to describe the allow-list.

Nothing else in AGENTS.md moves. If `next dev` or `next build` regenerates the
`<!-- BEGIN:nextjs-agent-rules -->` block, that regeneration is reverted before
the commit.

### Whitelist

Required:

```
AGENTS.md
docs/tasks/RH-65-spec.md
package.json
src/app/api/spotify/search/route.ts
src/lib/__tests__/proxy.test.ts
src/proxy.ts
```

Permitted but not required, and nothing else:

```
docs/suggestions-log.md
```

**Landing Page Rule decision.** This task ships no user-visible feature: it is
middleware plumbing plus a documentation declaration. It is not a selling
point, the landing copy must not change, and ER12 asserts that mechanically.

**Version.** Bump `package.json` to `0.1.95-YYYYMMDDHHmm` with a real local
timestamp (from `0.1.94-202609091542`).

## Expected Results

ER1 - `src/proxy.ts` declares in its own text that it is not an authorization boundary. `grep -c "NOT AN AUTHORIZATION BOUNDARY" src/proxy.ts` prints `1` (it printed `0` at `6aa099c`), and that string appears inside a comment block in the first 20 lines of the file: `head -20 src/proxy.ts | grep -c "NOT AN AUTHORIZATION BOUNDARY"` also prints `1`. The comment names who does own the decision: `grep -c "actionSessionGuard" src/proxy.ts` prints a number greater than or equal to `1`, and `grep -cE "never validates|proves nothing|may not be relied on|skips its own session check" src/proxy.ts` prints a number greater than or equal to `1`.

ER2 - The session is resolved from the request's own cookies, with no call back into the application and no timeout. `grep -c "better-auth/cookies" src/proxy.ts` prints `1` and `grep -c "getSessionCookie" src/proxy.ts` prints a number greater than or equal to `1`. `grep -cE "fetch\(|AbortController|setTimeout|get-session|await |async " src/proxy.ts` prints `0` (at `6aa099c` the same command prints `6`: the file fetched `/api/auth/get-session` behind a 3000 ms `AbortController` from an `async function`). `grep -c "@/lib/auth" src/proxy.ts` prints `0`, so the Postgres-backed Better Auth instance is still not imported here. `./node_modules/.bin/tsc --noEmit` exits `0` printing nothing.

ER3 - The matcher is an explicit allow-list of exactly twelve routes. Running `node -e "const s=require('fs').readFileSync('src/proxy.ts','utf8');const m=/matcher:\s*\[([\s\S]*?)\]/.exec(s);const e=[...m[1].matchAll(/'([^']+)'/g)].map(x=>x[1]).sort();console.log(e.length);console.log(e.join(' '))"` prints `12` on the first line and, on the second line, exactly `/admin/(.*) /bands /bands/(.*) /forgot-password /login /playlists /playlists/(.*) /profile /reset-password /settings /signup /songs/(.*)`. At `6aa099c` the same command prints `1` on the first line and, on the second, the single negative-lookahead pattern that begins `/((?!_next/static|_next/image|favicon.ico|`. `grep -c "PUBLIC_PATHS" src/proxy.ts` prints `0` (it printed `2` at `6aa099c`): the matcher is now the list, so the second, hand-maintained public-path list is gone.

ER4 - The rewritten suite covers the new session resolution and the new matcher. `rtk proxy npx vitest run src/lib/__tests__/proxy.test.ts` exits `0` printing `Test Files  1 passed (1)` and a `Tests  N passed (N)` line with `N` greater than or equal to `17` and `0 failed` (it printed `Tests  7 passed (7)` at `6aa099c`). The file's literal first line is not `// @vitest-environment jsdom`, and `grep -c "vi.stubGlobal" src/lib/__tests__/proxy.test.ts` prints `0` (it printed `1` at `6aa099c`, where the whole suite was written against a mocked `fetch`). Among its tests these are present with exactly these names: `redirects a cookieless request for a private route to /login with the path in the redirect param`, `passes a request that carries a Better Auth session cookie straight through`, `accepts the __Secure- prefixed session cookie used in production`, `treats an empty session cookie value as no session`, `ignores unrelated cookies when deciding whether a session cookie is present`, `resolves the session without ever calling fetch`, `preserves the original query string when it redirects to /login`, `redirects a request carrying a session cookie away from /login to the root`, `redirects a request carrying a session cookie away from /signup to the root`, `leaves a cookieless request for /login untouched`, `leaves a cookieless request for /forgot-password and /reset-password untouched`, `passes a present but unvalidated session cookie through to the page, which owns the authorization decision`, `matches every client-rendered private route`, `matches the four auth pages`, `does not match /, the invite route or any route under /api`, `does not match static assets, the pdf worker or an unknown path`, `lists exactly twelve matcher entries, each a valid regular-expression source`.

ER5 - The new matcher is still machine-readable by the guard that already reads it, and that guard was not weakened to make this task pass. `git diff 6aa099c -- src/lib/__tests__/pdfWorkerAsset.test.ts` prints nothing, and `rtk proxy npx vitest run src/lib/__tests__/pdfWorkerAsset.test.ts` exits `0` printing `Test Files  1 passed (1)` and `Tests  7 passed (7)` with `0 failed`, including the untouched test named `exempts the worker path from the session-gating middleware matcher`, which compiles every matcher entry with `new RegExp` and asserts that none of them matches `/pdf.worker.min.mjs` while at least one still matches `/songs/1/fast-view`.

ER6 - The unauthenticated HTTP behaviour of every page route is unchanged. Build once (`npm run build`), then `export BETTER_AUTH_SECRET="$(grep '^BETTER_AUTH_SECRET=' .env.local | cut -d= -f2-)"` and `export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied, and serve it with `./node_modules/.bin/next start -p 3401 -H 127.0.0.1`. With no cookie sent, `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' <url>` prints, for each url in turn: `http://127.0.0.1:3401/` prints `200`; `http://127.0.0.1:3401/login` prints `200`; `http://127.0.0.1:3401/signup` prints `200`; `http://127.0.0.1:3401/join/ABCDEF` prints `200`; `http://127.0.0.1:3401/icon.jpg` prints `200`; `http://127.0.0.1:3401/api/auth/get-session` prints `200`; `http://127.0.0.1:3401/bands` prints `307 http://127.0.0.1:3401/login?redirect=%2Fbands`; `http://127.0.0.1:3401/playlists` prints `307 http://127.0.0.1:3401/login?redirect=%2Fplaylists`; `http://127.0.0.1:3401/admin/moderation` prints `307 http://127.0.0.1:3401/login?redirect=%2Fadmin%2Fmoderation`; `http://127.0.0.1:3401/profile` prints `307 http://127.0.0.1:3401/login?redirect=%2Fprofile`; `http://127.0.0.1:3401/settings` prints `307 http://127.0.0.1:3401/login?redirect=%2Fsettings`; `http://127.0.0.1:3401/songs/search` prints `307 http://127.0.0.1:3401/login?redirect=%2Fsongs%2Fsearch`; `http://127.0.0.1:3401/songs/abc/fast-view` prints `307 http://127.0.0.1:3401/login?redirect=%2Fsongs%2Fabc%2Ffast-view`; `http://127.0.0.1:3401/bands/abc` prints `307 http://127.0.0.1:3401/login?redirect=%2Fbands%2Fabc`; `http://127.0.0.1:3401/playlists/abc` prints `307 http://127.0.0.1:3401/login?redirect=%2Fplaylists%2Fabc`. Every one of those fifteen values is the value measured at `6aa099c` with the same commands.

ER7 - The matcher really did stop covering everything, and the one route that relied on it now answers for itself. Against the same server as ER6 and with no cookie sent: `curl -sS -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3401/api/spotify/search?q=x'` prints `401` (at `6aa099c` it printed `307` with `redirect_url` `http://127.0.0.1:3401/login?q=x&redirect=%2Fapi%2Fspotify%2Fsearch`), and `curl -sS 'http://127.0.0.1:3401/api/spotify/search?q=x'` prints a JSON body containing `"code":401`. `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3401/nope` prints `404` (it printed `307` at `6aa099c`). In the source, `grep -c "getRequiredUserId" src/app/api/spotify/search/route.ts` prints a number greater than or equal to `1` (it printed `0` at `6aa099c`), and `git diff --numstat 6aa099c -- src/app/api/spotify/search/route.ts` prints exactly one line whose three tab-separated fields are a number of insertions no greater than `12`, the deletion count `0`, and the path `src/app/api/spotify/search/route.ts`, so the guard was added and nothing else in that handler was rewritten. `git diff 6aa099c -- src/app/api/spotify/playlists src/app/api/auth src/app/api/dev src/lib/spotifyRouteAuth.ts` prints nothing: no other handler is touched.

ER8 - AGENTS.md records the same declaration and settles the server-page pattern. `grep -c "not an authorization boundary" AGENTS.md` prints a number greater than or equal to `1` (it printed `0` at `6aa099c`), and the sentence that said the proxy "calls the Better Auth session endpoint via `fetch`" is gone: `grep -c "calls the Better Auth session endpoint via" AGENTS.md` prints `0` (it printed `1` at `6aa099c`). `grep -c "session gate on every request" AGENTS.md` prints `0` and `grep -c "session-gates all non-public routes" AGENTS.md` prints `0` (each printed `1` at `6aa099c`), so the architecture diagram and the directory map were corrected too. Separately, AGENTS.md now names the Server Component page pattern: a single line of AGENTS.md contains all three route names in order, so `grep -c "/bands.*/admin/moderation.*/playlists" AGENTS.md` prints a number greater than or equal to `1` (it printed `0` at `6aa099c`), and `grep -c "Server Component" AGENTS.md` prints a number greater than or equal to `3` (it printed `2` at `6aa099c`).

ER9 - Every static gate holds at its `6aa099c` value. `rtk proxy npx eslint .` prints `22 problems (8 errors, 14 warnings)`, unchanged. `rtk proxy npx eslint src/proxy.ts src/lib/__tests__/proxy.test.ts src/app/api/spotify/search/route.ts` exits `0` with no output, as it does at `6aa099c`, which for `src/proxy.ts` means it is clean under the base complexity budget with no per-file relaxation: `grep -c "src/proxy.ts" eslint.config.mjs` prints `0` and the count of lines matching `complexity-budget/override` in `eslint.config.mjs` is still `20`. `git diff 6aa099c -- eslint.config.mjs src/lib/__tests__/complexityBudget.test.ts` prints nothing, and `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` exits `0` printing `Tests  6 passed (6)`. `npm run lint:dead` exits `0` with no unused file, export or dependency reported. `npm run lint:dup` exits `0` with a `Total:` row reporting at most `18` clones and at most `0.65 %` duplicated lines (it reported `18` clones, `231` duplicated lines and `0.64 %` at `6aa099c`). `npm run audit` exits `0` with `0` high or critical advisories.

ER10 - The whole suite and the coverage gate hold, with Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (migrations applied) and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. `rtk proxy npx vitest run` exits `0` reporting `Test Files  100 passed (100)` (unchanged; this task adds no new suite), `Tests` passed greater than or equal to `1148` (was `1138`; at least ten new tests in the rewritten proxy suite), `0 failed` and `0 skipped`. `npm run test:coverage` exits `0` with all four thresholds met (statements at least `80`, branches at least `65`, functions at least `78`, lines at least `80`). Reading the per-file numbers out of the artefact this repository actually emits, `coverage/coverage-final.json` (there is no `coverage/coverage-summary.json`), the command `node -e "const c=require('./coverage/coverage-final.json');const pct=a=>a.length?Math.round(1000*a.filter(x=>x>0).length/a.length)/10:100;for (const k of Object.keys(c)) if (k.endsWith('/src/proxy.ts')) console.log(k.split('/src/').pop(), pct(Object.values(c[k].s)), pct(Object.values(c[k].f)))"` prints exactly one line, `proxy.ts` followed by a statement percentage of at least `96` and a function percentage of exactly `100`. At `6aa099c` that same one-liner prints `proxy.ts 96.4 75`, the missing function being the abort-timeout arrow that no test could reach.

ER11 - End to end, with a fresh `npm run build`, `export BETTER_AUTH_SECRET="$(grep '^BETTER_AUTH_SECRET=' .env.local | cut -d= -f2-)"`, Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied, and `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1"`: `npx playwright test e2e/server-pages.spec.ts --reporter=list` exits `0` printing `4 passed`; `npx playwright test e2e/ssr-smoke.spec.ts --reporter=list` exits `0` printing `4 passed`; `npx playwright test e2e/auth.spec.ts --grep credentials --reporter=list` exits `0` printing `2 passed`; and `npx playwright test e2e/bands-confirm.spec.ts --reporter=list --retries=1` exits `0` printing `4 passed` (this file carries a known intermittent `Loading...` failure logged under RH-64, which is why one retry is allowed and why a flaky-but-passing run satisfies this result). All four sets are green at `6aa099c` under the same commands. `git diff --name-only 6aa099c -- e2e` prints nothing: no end-to-end spec is added or edited by this task. (`e2e/songs-crud.spec.ts` and `e2e/fast-view-mobile.spec.ts` are red at `6aa099c` for reasons tracked in RH-44, and the two `e2e/auth.spec.ts` tests that navigate to `/` expecting a bounce to `/login` are red at `6aa099c` as well because `/` renders the landing page; none of them is part of this result.)

ER12 - Release hygiene. `package.json` version is `0.1.95-YYYYMMDDHHmm` with a real local timestamp, sorting above `0.1.94-202609091542`. `git diff 6aa099c -- src/components/landing src/i18n/dictionaries` prints nothing: middleware plumbing plus a documentation declaration is not something a musician would choose the app for, so the Landing Page Rule requires no copy change. `git diff 6aa099c -- docs/plans/code-quality-review.md src/app/bands src/app/playlists src/app/admin src/app/page.tsx src/app/layout.tsx src/app/loading.tsx src/hooks src/components src/store src/lib/auth.ts src/lib/auth-session.ts next.config.ts vitest.config.ts` prints nothing, so the F10 status line (owned by the RH-41 close-out), the three Server Component pages, the client pages, the hooks, the components, the stores, the Better Auth wiring and both build configs are all byte-identical. And `git diff --name-only 6aa099c | sort` lists only paths drawn from this closed set and no others: `AGENTS.md`, `docs/suggestions-log.md`, `docs/tasks/RH-65-spec.md`, `package.json`, `src/app/api/spotify/search/route.ts`, `src/lib/__tests__/proxy.test.ts`, `src/proxy.ts` - any other path fails this result.

## Out of Scope

- **The `Status:` lines for F10, F14 and F15 in
  `docs/plans/code-quality-review.md`.** RH-41's record assigns the docs-only
  close-out of all three findings to the parent, once the five parts have
  landed ("Aguarda as cinco filhas para receber uma spec nova de escopo
  reduzido, so de integracao e verificacao: conferir a tabela de rotas final de
  npx next build e fechar F10, F14 e F15"). That file must not be touched here;
  ER12 pins it.
- **Verifying the session cookie's signature, or validating the session at
  all.** The proxy checks presence and nothing else, by design and by
  declaration. The known consequence - a cookie signed under a rotated
  `BETTER_AUTH_SECRET` bounces its owner off the auth pages until it expires -
  is recorded in `docs/suggestions-log.md`, not fixed here. Adding HMAC
  verification would make the file asynchronous again and would blur the very
  statement ER1 requires it to make.
- **A request-scoped session cache.** F10 offers it as an alternative to the
  self-`fetch`; with the fetch gone there is nothing left to cache, and a cache
  would reintroduce the database dependency this task removes.
- **Converting `/profile`, `/settings`, `/bands/[id]`, `/playlists/[id]` or
  `/songs/[id]/fast-view` into Server Components**, or making them redirect
  themselves. They stay `"use client"`; the proxy keeps redirecting them, which
  is the whole reason they are in the matcher. Their remaining `useEffect` data
  loading is F15 work that RH-41's split deliberately left out.
- **Removing `/bands`, `/playlists` or `/admin/moderation` from the matcher on
  the grounds that they redirect themselves.** Measured and rejected in
  `## Audit`: with `src/app/loading.tsx` present, their own `redirect()` is a
  streamed `200` plus a one-second meta refresh, not a `307`.
- **Deleting or moving `src/app/loading.tsx`**, which is what would change that
  measurement. It is a global loading UI with its own product behaviour and its
  own review surface.
- **Changing `/api/spotify/search` beyond the session prologue** - the Client
  Credentials token cache, the `400` on a missing `q`, the response shape and
  the error handling are untouched - and **changing any other route handler**,
  all of which already answer for themselves.
- **Adding an end-to-end spec for the redirect.** ER6 and ER7 pin the same
  behaviour at the HTTP layer with `curl`, which is cheaper, exact about the
  `Location` header, and does not depend on the signed-in Playwright fixture.
- **Fixing the two red `e2e/auth.spec.ts` redirect tests** (they navigate to
  `/`, which is public and renders the landing page) or the pre-existing red
  `songs-crud` / `fast-view-mobile` specs and the 8 eslint errors and 14
  warnings that make up today's repo total. None is in a file this task owns.
- **Any AGENTS.md edit beyond the four described in `## Approach`.** The
  complexity-budget sentence, the coverage-universe paragraph and the error
  handling conventions are unchanged; the ratchet does not move, because
  `src/proxy.ts` never had an override.

## Post-merge checks (orchestrator)

After the Vercel deployment of the merge commit, a signed-out browser should
confirm that the marketing landing page still renders at `/`, that typing
`/profile` lands on `/login?redirect=%2Fprofile` and that signing in from there
returns to `/profile`; and that `/join/<a real invite code>` still renders the
invite page without a session. A signed-in browser should confirm that
navigating between `/`, `/bands`, `/playlists`, a band, a playlist and a song's
Fast View is unchanged, that typing `/login` while signed in still lands on the
dashboard, and that the Spotify search box on the dashboard still returns
tracks (the one call that now depends on the new `401` prologue answering for a
real session). Signing out and then reloading `/bands` should give the login
page. No expected result above depends on any of this.
