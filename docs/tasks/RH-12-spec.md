# RH-12 — Adicionar aviso de "você já é membro" ao reabrir um convite

## Scope

Today, reopening/re-submitting an invite link (`/join/[code]`) for a band
the signed-in user already belongs to succeeds silently: the
`join_band_by_invite` Postgres function does `INSERT ... ON CONFLICT
(band_id, user_id) DO NOTHING` and returns the same `band_id` it would
return for a brand-new join, so `handleAccept`
(`src/app/join/[code]/page.tsx`) redirects straight to
`/bands/[bandId]` with no indication the "join" was actually a no-op.

This task makes that outcome explicit end-to-end:

1. **DB level**: `join_band_by_invite` (defined in
   `migrations/0001_initial_schema.sql`, mirrored in
   `supabase/migrations/20260707000000_initial_schema.sql`) is changed
   to also report whether the caller was already a member *before* the
   insert, via a new migration (`migrations/0004_...sql` +
   `supabase/migrations/0004_...sql`).
2. **Wrapper level**: `joinBandByInviteServer`
   (`src/lib/bands.server.ts`) surfaces that flag to its caller.
3. **UI level**: `/join/[code]/page.tsx` reads a new searchParam and
   renders a distinct "You're already a member" interstitial instead
   of redirecting straight past it — following the exact
   redirect-with-searchParam / page-branches-on-searchParam pattern
   RH-11 just established in this same file for the `error=` states.

This task does **not** touch the "Invalid invite link" (`!bandInfo`)
or "Something went wrong" (`lookupFailed`) branches from RH-9/RH-11,
does not change `error=technical` / `error=invalid` handling, does not
add invite-code expiration, and does not add new global toast/error
infrastructure. It also does not add "already a member" messaging to
`src/lib/bands.ts`'s `joinBandByInviteClient` /
`joinBandByInviteAction` path — that path has no caller anywhere in
`src/app` today (confirmed: `joinBandByInviteAction` is referenced
only from its own definition and from tests), so it is dead code from
a UX perspective. It still needs a small compatibility fix (below)
because it queries the same RPC and must not break when the RPC's
return shape changes, but no new "already a member" behavior is added
to it.

## Approach

### 1. DB migration — `join_band_by_invite` reports `already_member`

**Why a pre-check instead of an `xmax = 0` / `ON CONFLICT DO UPDATE
... RETURNING` trick:** `ON CONFLICT (...) DO NOTHING` produces **no
row** in a `RETURNING` clause on conflict, so the common `xmax = 0`
idiom only works if the conflict branch is rewritten to `DO UPDATE SET
... RETURNING (xmax = 0) AS inserted` — a no-op update that still
writes a new row version and relies on interpreting an internal system
column. That's correct but subtle, and turns a case of purely
*informational* UI copy into a change of the write path itself (a
no-op `UPDATE` where today there's truly `DO NOTHING`). Since this
flag is presentation-only (not used for authorization or billing) and
the only realistic race is two near-simultaneous submits of the same
invite link by the same signed-in user in the same browser session (a
cosmetic word-choice risk, not a correctness risk — the membership
insert itself is still atomically `ON CONFLICT DO NOTHING`), a plain
pre-check `SELECT EXISTS(...)` immediately before the `INSERT`, in the
same function invocation, is simpler, more readable, and sufficient.

`migrations/0004_join_band_by_invite_already_member.sql` (mirrored
byte-for-byte at
`supabase/migrations/0004_join_band_by_invite_already_member.sql`,
matching how `0003_add_band_color.sql` already exists identically in
both directories):

```sql
-- Migration 0004: join_band_by_invite reports whether the caller was
-- already a member, so the UI can distinguish a fresh join from a
-- silent no-op re-accept.

-- CREATE OR REPLACE cannot change a function's return type, so the
-- existing scalar-uuid version must be dropped first.
DROP FUNCTION IF EXISTS join_band_by_invite(text, uuid);

CREATE FUNCTION join_band_by_invite(
    p_invite_code text,
    p_user_id     uuid DEFAULT NULL
)
RETURNS TABLE(band_id uuid, already_member boolean)
LANGUAGE plpgsql AS $$
DECLARE
    v_band_id uuid;
    v_already_member boolean;
BEGIN
    IF p_user_id IS NULL THEN RAISE EXCEPTION 'p_user_id is required'; END IF;

    SELECT id INTO v_band_id FROM bands WHERE invite_code = p_invite_code;
    IF v_band_id IS NULL THEN
        RETURN QUERY SELECT NULL::uuid, NULL::boolean;
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM band_members bm
        WHERE bm.band_id = v_band_id AND bm.user_id = p_user_id
    ) INTO v_already_member;

    INSERT INTO band_members (band_id, user_id, role)
    VALUES (v_band_id, p_user_id, 'member')
    ON CONFLICT (band_id, user_id) DO NOTHING;

    RETURN QUERY SELECT v_band_id, v_already_member;
END;
$$;
```

Contract for callers, unchanged/changed as follows:
- Invite code doesn't resolve to any band → one row, `band_id IS NULL`
  (the `already_member` value is irrelevant/`NULL` in that case —
  callers must key off `band_id`, exactly as they do today).
- Invite code resolves → one row, `band_id` set, `already_member =
  true` iff the caller was already in `band_members` for that band
  *before* this call (regardless of whether the `INSERT` actually ran).

No `GRANT`/`SECURITY DEFINER` changes are needed: neither this
function nor `get_band_by_invite_code` currently has an explicit
`GRANT` or `SECURITY DEFINER` clause in
`migrations/0001_initial_schema.sql` (both rely on the default
`EXECUTE` privilege Postgres grants to `PUBLIC` for new functions), so
dropping and recreating does not change who can call it.

### 2. `src/lib/bands.server.ts` — surface the flag

```ts
export interface JoinBandResult {
  bandId: string
  alreadyMember: boolean
}

export async function joinBandByInviteServer(
  userId: string,
  inviteCode: string,
): Promise<JoinBandResult | null> {
  try {
    const res = await query('SELECT * FROM join_band_by_invite($1, $2)', [inviteCode, userId])
    const row = res.rows[0]
    if (!row || row.band_id === null) return null
    return { bandId: row.band_id as string, alreadyMember: Boolean(row.already_member) }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to join band by invite', err)
    throw err
  }
}
```

The `null`-on-"code doesn't resolve"/`throw`-on-DB-error contract
established by RH-11 is preserved exactly — only the success shape
changes, from `string` to `{ bandId, alreadyMember }`.

### 3. `src/lib/bands.ts` — compatibility fix for `joinBandByInviteClient` (no UX change)

This function calls the same RPC with the old scalar-call syntax
(`SELECT join_band_by_invite($1, $2) as band_id`), which breaks once
the function returns a `TABLE(...)` instead of a bare `uuid`. Update
only the query text to match the new call shape, keep the existing
public signature (`Promise<string | null>`) and behavior unchanged:

```ts
export const joinBandByInviteClient = async (
  userId: string,
  inviteCode: string,
): Promise<string | null> => {
  try {
    const res = await query('SELECT * FROM join_band_by_invite($1, $2)', [inviteCode, userId])
    const row = res.rows[0]
    return row ? (row.band_id as string | null) : null
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error("Failed to join band", err)
    throw new Error(`Failed to join band: ${err.message}`)
  }
}
```

This is required purely so the migration doesn't break this
(currently UI-unreachable) code path and its existing tests
(`joinBandByInviteClient` assertions in
`src/lib/__tests__/bands.test.ts` and
`src/lib/__tests__/errors.test.ts`) — it is not where the new "already
a member" UX lives.

### 4. `src/app/join/[code]/page.tsx` — new searchParam + interstitial

Follow the RH-11 pattern exactly: `handleAccept` redirects with an
outcome in the query string, the page (a Server Component) reads it
and branches.

**New searchParam**, added alongside `error`:

```ts
interface Props {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ error?: string; joined?: string }>;
}
```

```ts
const { error: joinError, joined } = await searchParams;
const alreadyMember = joined === "already";
```

**`handleAccept`** — branch on the new `alreadyMember` flag from
`joinBandByInviteServer`'s result before the success redirect:

```ts
async function handleAccept() {
  "use server";
  const currentSession = await getSession();
  if (!currentSession?.user?.id) {
    redirect("/bands");
  }

  let joinResult: Awaited<ReturnType<typeof joinBandByInviteServer>> = null;
  let joinFailed = false;
  try {
    joinResult = await joinBandByInviteServer(currentSession.user.id, code);
  } catch {
    joinFailed = true;
  }

  if (joinFailed) {
    redirect(`/join/${code}?error=technical`);
  }
  if (joinResult) {
    if (joinResult.alreadyMember) {
      redirect(`/join/${code}?joined=already`);
    }
    redirect(`/bands/${joinResult.bandId}`);
  }
  redirect(`/join/${code}?error=invalid`);
}
```

(As in RH-11: no `redirect()` call sits inside the `try` block, since
`redirect()` works by throwing internally.)

**Rendering** — why an interstitial on `/join/[code]` rather than a
banner/toast on `/bands/[bandId]`: the target design constraint from
the task ("redirect to the band with a query param that shows a toast
on the band page" **or** "an interstitial on `/join/[code]` before the
final redirect") is resolved in favor of the interstitial because:
- `/join/[code]/page.tsx` already has everything needed to render
  it — `bandInfo` (including `id` and `name`) is already fetched via
  `getBandByInviteCodeServer(code)` earlier in the same request, so no
  extra data fetch or param (like `?alreadyMember=1&bandName=...`)
  needs to be threaded through the redirect.
- It reuses the exact mechanism RH-11 just built on this same page
  (redirect-with-searchParam, Server Component branches on it) instead
  of introducing a second, different mechanism (client-side toast) on
  a different page.
- `/bands/[id]/page.tsx` is a Client Component. Reading a one-shot
  "just joined" query param there would require `useSearchParams()`
  wrapped in a `<Suspense>` boundary (a Next.js App Router
  requirement for that hook) purely to show a message that has
  nothing to do with that page's steady-state concerns — avoidable
  complexity for this fix.
- It keeps the fix contained to the one file RH-9/RH-11 already
  touched, per the "smallest correct fix" framing of the task.

Replace the existing `{user ? ( ... ) : ( ... )}` ternary's
authenticated branch with a nested branch on `alreadyMember`:

```tsx
{user ? (
  alreadyMember ? (
    <div className="space-y-4 text-center">
      <div className="text-3xl">🎸</div>
      <h3 className="text-base font-bold text-gray-900">
        You&apos;re already a member!
      </h3>
      <p className="text-xs text-gray-500">
        You&apos;re already part of {bandInfo.name} — no need to accept
        again.
      </p>
      <Link
        href={`/bands/${bandInfo.id}`}
        className="block w-full rounded-xl bg-emerald-600 px-4 py-3 text-center text-sm font-bold text-white hover:bg-emerald-700 shadow-md shadow-emerald-950/20 transition-all"
      >
        Go to {bandInfo.name}
      </Link>
    </div>
  ) : (
    <div className="space-y-4">
      {joinError && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {joinError === "technical"
            ? "Something went wrong while joining. Please try again."
            : "This invite is no longer valid — it may have just been revoked by the band admin."}
        </p>
      )}
      {/* ...existing "Accept invitation?" card, unchanged... */}
    </div>
  )
) : (
  /* ...existing unauthenticated branch, unchanged... */
)}
```

Notes on this rendering:
- Uses the app's existing primary-button style (same classes as
  "Accept Invitation & Join") rather than the red error-banner style —
  this is not an error, so it must not look like one.
- `joined` values other than `"already"` are ignored (treated as
  `alreadyMember === false`), mirroring RH-11's "any value other than
  the recognized ones falls through to a deterministic default"
  convention for the `error` param.
- If `joined=already` is present but `user` is falsy (e.g. a signed-out
  visitor loads a stale/bookmarked URL), the branch is skipped
  entirely and the normal sign-in/sign-up card renders — `handleAccept`
  can only ever produce this redirect for an authenticated session, so
  this is a defensive fallback, not a designed entry point.

### 5. Tests

**New unit test file `src/lib/__tests__/bands.server.test.ts`**
(mocking `@/lib/db`'s `query`, following the mocking convention used
throughout `errors.test.ts`), asserting the new parsing logic in
`joinBandByInviteServer` directly (this is new application logic that
`errors.test.ts`'s throw-path coverage doesn't exercise):

```ts
it("returns alreadyMember: false on a fresh join", async () => {
  vi.mocked(query).mockResolvedValueOnce({
    rows: [{ band_id: "band-1", already_member: false }],
  } as any);
  await expect(joinBandByInviteServer("user-1", "code")).resolves.toEqual({
    bandId: "band-1",
    alreadyMember: false,
  });
});

it("returns alreadyMember: true when the user already belonged to the band", async () => {
  vi.mocked(query).mockResolvedValueOnce({
    rows: [{ band_id: "band-1", already_member: true }],
  } as any);
  await expect(joinBandByInviteServer("user-1", "code")).resolves.toEqual({
    bandId: "band-1",
    alreadyMember: true,
  });
});

it("returns null when the invite code doesn't resolve to a band", async () => {
  vi.mocked(query).mockResolvedValueOnce({
    rows: [{ band_id: null, already_member: null }],
  } as any);
  await expect(joinBandByInviteServer("user-1", "code")).resolves.toBeNull();
});
```

**`src/lib/__tests__/errors.test.ts`**: no change required — its
`joinBandByInviteServer throws on DB error` case (added by RH-11)
relies on the mock's default (unmatched-SQL) branch throwing
`mockError`, which the new query text
(`SELECT * FROM join_band_by_invite($1, $2)`) still falls through to
unmatched, exactly as the old query text did. Verified by reading the
mock's `mockImplementation` — it string-matches specific substrings
(`"from playlists"`, `"from repertoire"`, etc.) and has no branch for
`join_band_by_invite`, ending in an unconditional `throw mockError`.

**`src/lib/__tests__/bands.test.ts`** (gated integration test, real
DB): no change required. Its `joinBandByInviteClient` assertions
(`expect(joinedBandId).toBe(bandId)`) exercise only the compatibility
fix from step 3, whose public return shape (`string | null`) is
unchanged.

## Expected Results

- [ ] `migrations/0004_join_band_by_invite_already_member.sql` exists, drops and recreates `join_band_by_invite(text, uuid)` to `RETURNS TABLE(band_id uuid, already_member boolean)`, computing `already_member` via a pre-`INSERT` `SELECT EXISTS(...)` membership check, and is mirrored byte-for-byte at `supabase/migrations/0004_join_band_by_invite_already_member.sql`.
- [ ] Calling `join_band_by_invite('bad-code', <uuid>)` still returns one row with `band_id IS NULL` (unresolved-code contract unchanged).
- [ ] Calling `join_band_by_invite(<valid code>, <uuid of a brand-new user>)` returns `already_member = false` and the user ends up in `band_members` for that band.
- [ ] Calling `join_band_by_invite(<valid code>, <uuid of an existing member>)` returns `already_member = true`, `band_id` set to the band's id, and does not create a duplicate `band_members` row (still `ON CONFLICT DO NOTHING`).
- [ ] `joinBandByInviteServer` (`src/lib/bands.server.ts`) returns `{ bandId, alreadyMember }` on success, `null` when the code doesn't resolve, and still re-throws (after `logger.error`, per RH-11) on a DB/RPC error.
- [ ] `joinBandByInviteClient` (`src/lib/bands.ts`) still returns a plain `string | null` band id and its existing behavior/tests (`bands.test.ts`, `errors.test.ts`) are unaffected by the RPC signature change.
- [ ] `/join/[code]/page.tsx` reads a new `joined` searchParam alongside the existing `error` one.
- [ ] Submitting `handleAccept` when `joinBandByInviteServer` resolves with `alreadyMember: true` redirects to `/join/[code]?joined=already` (not straight to `/bands/[bandId]`).
- [ ] `/join/[code]?joined=already`, viewed while signed in, renders a distinct "You're already a member!" interstitial (non-error styling, referencing the band by name) with a primary CTA linking to `/bands/[bandId]` — and does **not** render the "Accept invitation?" form in that state.
- [ ] Submitting `handleAccept` when `joinBandByInviteServer` resolves with `alreadyMember: false` (fresh join) still redirects straight to `/bands/[bandId]` — no behavior change on the happy path.
- [ ] `/join/[code]?joined=already`, viewed while signed out, does **not** show the interstitial — it falls through to the normal sign-in/sign-up card.
- [ ] The `error=technical` and `error=invalid` branches from RH-11, and the `!bandInfo` / `lookupFailed` branches from RH-9/RH-11, are unchanged.
- [ ] `src/lib/__tests__/bands.server.test.ts` (new file) has passing tests covering `alreadyMember: true`, `alreadyMember: false`, and the unresolved-code `null` case for `joinBandByInviteServer`.
- [ ] `src/lib/__tests__/errors.test.ts`'s existing `joinBandByInviteServer throws on DB error` and `joinBandByInviteClient throws on DB error` cases still pass unmodified.
- [ ] `src/lib/__tests__/bands.test.ts`'s existing `joinBandByInviteClient` integration assertions still pass unmodified.
- [ ] `npm run lint` and the project's `vitest` test script pass with no new failures.
- [ ] Manual/QA check: create a band, join it as a second user via its invite link (fresh join → lands on `/bands/[id]` directly), then revisit the same invite link and accept again as that same user → lands on `/join/[code]?joined=already` showing the new interstitial, and clicking through reaches `/bands/[id]` with membership unchanged (still exactly one `band_members` row for that user/band pair).

## Out of Scope

- Any change to `error=technical` / `error=invalid` handling or copy (RH-11's concern, untouched here).
- Any change to the "Invalid invite link" (RH-9) or "Something went wrong" (RH-11) branches.
- Adding "already a member" messaging to the `joinBandByInviteClient` / `joinBandByInviteAction` path — it has no caller in the current UI (`joinBandByInviteAction` is unreferenced outside its own definition and tests) and only receives the minimal compatibility fix needed to not break under the new RPC return shape.
- Invite-code expiration or any other new invite-code lifecycle mechanism.
- Localization/i18n of the new strings (tracked separately under the i18n effort, RH-14).
- Any new client-side toast/banner component — the interstitial reuses this page's existing card layout and button/text styling conventions only.
- Concurrency-hardening beyond the pre-check (e.g. row locking) for the `already_member` flag — acceptable given it is presentation-only, as justified in the Approach section.
