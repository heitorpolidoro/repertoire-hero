# RH-11 — Melhorar tratamento de erros no fluxo de aceite de convite

## Scope

This task fixes error handling on the invite-acceptance flow
(`/join/[code]`, `src/app/join/[code]/page.tsx` and
`src/lib/bands.server.ts`) so that **technical failures** (DB/RPC
exceptions) are no longer indistinguishable from **legitimate "this
code doesn't resolve to anything" results**:

1. **Lookup** (`getBandByInviteCodeServer`): today, both "the RPC ran
   fine and returned 0 rows" (genuinely invalid/unknown code) and "the
   RPC/DB call itself threw" (connection error, RPC missing, etc.) are
   caught and collapsed into the same `null` return value, which the
   page renders as the "Invalid invite link" card. A DB outage should
   not tell the user their link is bad.
2. **Join** (`joinBandByInviteServer`, called from the `handleAccept`
   Server Action): today, any failure — including a thrown DB/RPC
   error — is caught, logged, and the action falls through to
   `redirect("/bands")` with zero explanation. The user lands on their
   bands list with no idea whether they joined, and no way to retry.

The fix distinguishes, in both functions, "the operation completed and
legitimately found nothing" from "the operation itself failed," and
gives the `/join/[code]` page a way to render distinct, non-accusatory
feedback for the second case — without a browser `alert()`/`confirm()`
(disallowed by AGENTS.md) and without inventing new UI infrastructure.

This task does **not** change the copy of the existing "Invalid invite
link" branch (that's RH-9's concern — this task's not-found copy stays
byte-for-byte what RH-9 shipped), does not add invite-code expiration,
does not touch invite-code generation/regeneration
(`src/app/actions/bands.ts`, `regenerateBandInviteCode`), and does not
add any client-side toast infrastructure — `/join/[code]/page.tsx`
is, and remains, a Server Component.

## Approach

### 1. `src/lib/bands.server.ts` — stop swallowing technical errors

Both functions keep their existing signatures and return types
unchanged (`Promise<{...} | null>` and `Promise<string | null>`
respectively) — `null` continues to mean exactly what it already means
for the *successful-query, nothing-found* path:

- `getBandByInviteCodeServer`: `res.rowCount === 0 → return null` is
  untouched — that's a legitimate "no band has this invite code" result.
- `joinBandByInviteServer`: `res.rows[0].band_id` being `null` (the
  `join_band_by_invite` SQL function returns `NULL` when
  `p_invite_code` matches no band — see
  `migrations/0001_initial_schema.sql`) is untouched — that's a
  legitimate "code no longer valid at join time" result (e.g. revoked
  between page load and submit).

What changes is only the `catch` block in each function: instead of
`logger.error(...)` followed by `return null`, log and **re-throw**
the error. This is the pattern already established elsewhere in this
codebase — `src/lib/logger.ts`'s own doc comment says `logger.error`
should be "call[ed] ... before re-throwing so the event reaches Sentry
even when the caller swallows the exception," and every other
`src/lib/*.ts` domain function that fails a DB call propagates the
exception (verified: `src/lib/__tests__/errors.test.ts` asserts
`.rejects.toThrow()` for the equivalent failure path in
`playlists.ts`, `songs.ts`, and `bands.ts`). `bands.server.ts` is
currently the outlier.

```ts
// getBandByInviteCodeServer — catch block becomes:
} catch (error) {
  const err = error instanceof Error ? error : new Error(String(error))
  logger.error('Failed to fetch band by invite code', err)
  throw err
}

// joinBandByInviteServer — catch block becomes:
} catch (error) {
  const err = error instanceof Error ? error : new Error(String(error))
  logger.error('Failed to join band by invite', err)
  throw err
}
```

### 2. `src/app/join/[code]/page.tsx` — distinguish and render both failure modes

The page has no error boundary (`error.tsx`/`global-error.tsx`) at
any level of the `src/app` tree today (confirmed by search), so
letting the exceptions from step 1 bubble up uncaught would replace
this branded flow with a generic Next.js error page. Instead, the
page catches around the lookup call and renders its own distinct
branch, and the join Server Action redirects back to the same page
with an error signal in the query string rather than away to `/bands`.

**Lookup failure — new branch, added before the existing `if (!bandInfo)`:**

```tsx
const { code } = await params;

let bandInfo: Awaited<ReturnType<typeof getBandByInviteCodeServer>> = null;
let lookupFailed = false;
try {
  bandInfo = await getBandByInviteCodeServer(code);
} catch {
  lookupFailed = true;
}

if (lookupFailed) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm text-center space-y-4">
        <div className="text-5xl">⚠️</div>
        <h1 className="text-xl font-bold text-gray-900">Something went wrong</h1>
        <p className="text-sm text-gray-500">
          We couldn&apos;t check this invite link right now. This
          doesn&apos;t necessarily mean the link is bad — please try
          again in a moment.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link href={`/join/${code}`} className="text-sm font-medium text-emerald-600 hover:text-emerald-500">
            Try again
          </Link>
          <Link href="/" className="text-sm font-medium text-gray-500 hover:text-gray-700">
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}

if (!bandInfo) {
  // unchanged RH-9 "Invalid invite link" branch
}
```

Use a distinct icon (⚠️ vs. the existing 🔗) and heading ("Something
went wrong" vs. "Invalid invite link") so the two states are visually
and textually distinguishable — the acceptance criterion from the
task justification. Exact wording is not prescribed beyond: it must
not claim the link itself is invalid/expired/incorrect.

**Join failure — surface it on the same page instead of a silent redirect to `/bands`:**

Add a `searchParams` prop (same async-prop convention already used for
`params` in this file):

```ts
interface Props {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ error?: string }>;
}
```

Read it alongside `code`: `const { error: joinError } = await searchParams;`

Rewrite `handleAccept` so no `redirect()` call sits inside the `try`
block (Next's `redirect()` works by throwing internally — catching
around it would break it):

```ts
async function handleAccept() {
  "use server";
  const currentSession = await getSession();
  if (!currentSession?.user?.id) {
    redirect("/bands");
  }

  let joinedBandId: string | null = null;
  let joinFailed = false;
  try {
    joinedBandId = await joinBandByInviteServer(currentSession.user.id, code);
  } catch {
    joinFailed = true;
  }

  if (joinFailed) {
    redirect(`/join/${code}?error=technical`);
  }
  if (joinedBandId) {
    redirect(`/bands/${joinedBandId}`);
  }
  redirect(`/join/${code}?error=invalid`);
}
```

Render an inline banner above the "Accept invitation?" heading in the
authenticated branch, reusing the existing non-alert error-banner
convention already used on `login`, `signup`, `forgot-password`, and
`reset-password` pages (`text-sm text-red-600 bg-red-50 rounded-lg
px-3 py-2`):

```tsx
{joinError && (
  <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
    {joinError === "technical"
      ? "Something went wrong while joining. Please try again."
      : "This invite is no longer valid — it may have just been revoked by the band admin."}
  </p>
)}
```

`error=invalid` (join-time `joinedBandId === null`) is allowed to say
the link/invite is no longer valid, since that reflects a real,
successfully-determined outcome (mirrors the `getBandByInviteCodeServer`
not-found case). `error=technical` must not make any claim about the
link's validity.

Any query-string value other than `"technical"` is treated as
`"invalid"` (i.e. `joinError === "technical" ? ... : ...`, no third
branch) — this keeps the banner rendering deterministic if the param
is ever malformed.

### 3. Tests — `src/lib/__tests__/errors.test.ts`

This file already asserts `.rejects.toThrow()` for the equivalent
failure path across `playlists.ts`, `songs.ts`, and `bands.ts`, using
a mocked `@/lib/db` `query` whose default (unmatched-SQL) branch
throws `mockError`. Add a new `describe("bands.server.ts errors")`
block importing `getBandByInviteCodeServer` and
`joinBandByInviteServer` from `"../bands.server"`, with two cases:

```ts
it("getBandByInviteCodeServer throws on DB error", async () => {
  await expect(getBandByInviteCodeServer("some-code")).rejects.toThrow();
});

it("joinBandByInviteServer throws on DB error", async () => {
  await expect(
    joinBandByInviteServer("mock-user-id", "some-code")
  ).rejects.toThrow();
});
```

Both RPC calls (`get_band_by_invite_code`, `join_band_by_invite`) fall
through this mock's default branch (no SQL-matching `if` for them
exists), so no new mock wiring is needed.

### 4. Existing integration test — `src/lib/__tests__/bands.test.ts`

`getBandByInviteCodeServer(oldCode)` / `(newCode)` in the
`skipIf`-gated integration test continue to assert `toBeNull()` /
`not.toBeNull()` against real "0 rows found" outcomes from a live
Supabase RPC call — that code path is untouched by this task, so no
change is required there.

## Expected Results

- [ ] `getBandByInviteCodeServer` (`src/lib/bands.server.ts`) still returns `null` when the RPC succeeds with 0 rows, but re-throws (after `logger.error`) when the underlying `query()` call itself throws.
- [ ] `joinBandByInviteServer` (`src/lib/bands.server.ts`) still returns `null` when the RPC succeeds with a `null` `band_id`, but re-throws (after `logger.error`) when the underlying `query()` call itself throws.
- [ ] `/join/[code]/page.tsx`, when `getBandByInviteCodeServer` throws, renders a new "Something went wrong" branch (distinct icon/heading from the existing "Invalid invite link" branch) that does not claim the link is invalid, incorrect, or expired.
- [ ] The existing "Invalid invite link" branch (`!bandInfo`, RH-9's copy) is unchanged and still renders when the lookup legitimately finds no matching band.
- [ ] Submitting `handleAccept` when `joinBandByInviteServer` throws redirects back to `/join/[code]?error=technical` (not `/bands`), and the page renders an inline red error banner reading a message that does not accuse the invite link of being invalid.
- [ ] Submitting `handleAccept` when `joinBandByInviteServer` resolves to `null` (invite became invalid between page load and submit) redirects to `/join/[code]?error=invalid`, and the page renders an inline red error banner distinct in wording from the `error=technical` case.
- [ ] Submitting `handleAccept` on success still redirects to `/bands/[joinedBandId]` exactly as before — no behavior change on the happy path.
- [ ] The error banner reuses the existing inline-banner styling convention (`text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2`, matching `login`/`signup`/`forgot-password`/`reset-password` pages) — no `alert()`/`confirm()`, no new toast component.
- [ ] `src/lib/__tests__/errors.test.ts` gains passing `getBandByInviteCodeServer throws on DB error` and `joinBandByInviteServer throws on DB error` test cases.
- [ ] `src/lib/__tests__/bands.test.ts`'s existing `getBandByInviteCodeServer` assertions (`toBeNull()` / `not.toBeNull()` around invite-code regeneration) still pass unmodified.
- [ ] `npm run lint` and `npm test` (or the project's configured `vitest` script) pass with no new failures.
- [ ] Manual/QA check: temporarily forcing `query()` to throw (e.g. via env-based DB misconfiguration in a local run) for a valid invite code shows the "Something went wrong" lookup-failure branch, not "Invalid invite link".

## Out of Scope

- Any change to the "Invalid invite link" copy itself (owned by RH-9; this task only adds a sibling branch, it does not edit that branch's text).
- Invite-code expiration or any other new invite-code lifecycle mechanism.
- Changes to invite-code generation/regeneration (`src/app/actions/bands.ts`, `regenerateBandInviteCode`, `src/lib/bands.ts`).
- Adding a global `error.tsx`/`global-error.tsx` error boundary, or any client-side toast/banner infrastructure reusable outside this page.
- Localization/i18n of the new strings (tracked separately under the i18n effort, RH-14).
- Handling of the pre-existing edge case where `handleAccept` is invoked with no active session (`redirect("/bands")`) — that path is unrelated to the DB/RPC error-masking bug this task fixes and is left as-is.
