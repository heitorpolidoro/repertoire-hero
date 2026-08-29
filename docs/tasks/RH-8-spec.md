# RH-8 — Permitir revogar/regenerar o link de convite da banda

## Scope

This task adds a way for a band admin to **regenerate** a band's `invite_code`,
immediately invalidating the previous invite link, without deleting the band.

It includes:
- A `regenerateBandInviteCode` domain function (`src/lib/bands.ts`) that
  server-side verifies the caller is an `admin` member of the band, then
  replaces `bands.invite_code` with a freshly generated code.
- A Server Action wrapper (`src/app/actions/bands.ts`) exposing it to the UI.
- A "Regenerate link" control in the existing "Invite link" section of
  `src/app/bands/[id]/page.tsx`, visible only to band admins, gated behind an
  inline (non-browser) confirmation, since regenerating immediately breaks the
  old link for anyone who still has it.
- Unit tests in `src/lib/__tests__/bands.test.ts` covering authorization and
  the invalidation behavior.

Explicitly **not** included in this task (see Out of Scope):
- Real invite-code expiration (TTL) support.
- A "disable joining" toggle that revokes without immediately generating a
  replacement code.
- Rate-limiting or auditing/history of past invite codes.

## Approach

### 1. Domain logic — `src/lib/bands.ts`

Add:

```ts
export const regenerateBandInviteCode = async (
  bandId: string,
  userId: string,
): Promise<string> => {
  // 1. Verify caller is an admin member of this band.
  const memberRes = await query(
    `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2`,
    [bandId, userId],
  )
  if (memberRes.rowCount === 0 || memberRes.rows[0].role !== 'admin') {
    throw new Error('Only band admins can regenerate the invite link')
  }

  // 2. Generate a new code using the same format as the column's own
  //    DEFAULT (substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  //    retrying on the (astronomically unlikely) unique_violation.
  const MAX_ATTEMPTS = 3
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await query(
        `UPDATE bands
         SET invite_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
             updated_at = now()
         WHERE id = $1
         RETURNING invite_code`,
        [bandId],
      )
      if (res.rowCount === 0) throw new Error('Band not found')
      return res.rows[0].invite_code as string
    } catch (error) {
      const err = error as { code?: string }
      if (err.code === '23505' && attempt < MAX_ATTEMPTS - 1) continue // unique_violation, retry
      throw error
    }
  }
  throw new Error('Failed to regenerate invite code')
}
```

No new migration is required: `bands.invite_code` is already `text UNIQUE NOT
NULL`, and the UPDATE reuses the exact generation expression from the
column's own `DEFAULT` (see `supabase/migrations/20260707000000_initial_schema.sql:139`
and `migrations/0001_initial_schema.sql`), so the new code has the same shape
(12 lowercase hex chars) as codes minted at band creation.

The old code stops resolving immediately and implicitly: `join_band_by_invite`
and `get_band_by_invite_code` (both in `0001_initial_schema.sql`) look up the
band by exact `invite_code` match, so once the column value changes, the old
code returns zero rows — no separate "revocation" bookkeeping is needed.

### 2. Server Action — `src/app/actions/bands.ts`

```ts
export async function regenerateBandInviteCodeAction(bandId: string): Promise<string> {
  const userId = await getRequiredUserId()
  return regenerateBandInviteCode(bandId, userId)
}
```

Follows the existing throw-on-error convention used by `deleteBandAction`,
`leaveBandAction`, and `removeBandMemberAction` (caller wraps in try/catch and
sets an error state) rather than the `{ error }`-object convention used only
by `uploadBandCoverAction`.

### 3. UI — `src/app/bands/[id]/page.tsx`

Within the existing "Invite link" `<section>` (around lines 286–305):

- Add a "Regenerate" button next to the existing "Invite link" heading,
  rendered **only when `isAdmin`** — matching the existing admin-gating
  pattern already used for the Edit/Delete icons in the header
  (`{isAdmin && (...)}` around line 259).
- Clicking it does **not** call `regenerateBandInviteCodeAction` directly.
  Per the project's "NO Browser Alerts" rule (no `window.confirm`/`alert`),
  it instead sets a local `confirmingRegenerate` boolean that reveals an
  inline warning row inside the same section (e.g. "This will invalidate the
  current link immediately. Anyone with the old link won't be able to join."
  + "Regenerate" / "Cancel" buttons).
- Confirming calls the new action, and on success:
  - Updates local `band` state's `invite_code` so `inviteUrl` re-derives
    immediately (no page reload/refetch).
  - Resets the existing `copied` state to `false`.
  - Shows a transient success toast/inline confirmation (add a small local
    `toast` state to this page, matching the pattern already used in
    `src/app/songs/[id]/fast-view/page.tsx`, since this page currently only
    has a persistent error banner, not a success one).
  - Collapses the inline confirmation row.
- On failure (e.g. a non-admin somehow triggers it, or a network error),
  reuses the page's existing `error` state banner.
- A `regenerating` boolean disables the Regenerate/Confirm buttons while the
  action is in flight.

### 4. Tests — `src/lib/__tests__/bands.test.ts`

Add cases for `regenerateBandInviteCode`:
- Admin member: `invite_code` changes and the returned value differs from the
  band's prior code.
- Non-admin member (`role: 'member'`) and non-member user: call rejects with
  an error, and `invite_code` in the DB is unchanged.
- After regeneration, `getBandByInviteCodeServer` (or the underlying
  `get_band_by_invite_code` query) called with the **old** code returns
  `null`/no rows.

## Expected Results

- [ ] `regenerateBandInviteCode(bandId, userId)` exists in `src/lib/bands.ts`, updates `bands.invite_code` to a new 12-character lowercase-hex value, and returns it.
- [ ] Calling `regenerateBandInviteCode` with a `userId` that is not an `admin` member of the band (including a non-member) throws/rejects and leaves `bands.invite_code` unchanged — verified by a unit test asserting no DB mutation occurred.
- [ ] After a successful regeneration, looking up the **previous** `invite_code` via `getBandByInviteCodeServer` (and by extension `GET /join/[code]` for that old code) returns `null` / renders the "Invalid invite link" page.
- [ ] `regenerateBandInviteCodeAction(bandId)` exists in `src/app/actions/bands.ts`, resolves the caller's `userId` via `getRequiredUserId()`, and delegates to `regenerateBandInviteCode`.
- [ ] The band detail page (`/bands/[id]`) shows a "Regenerate" control inside the "Invite link" section, visible only when the signed-in user is a band admin (same `isAdmin` gate used elsewhere on the page); non-admin members do not see it.
- [ ] Clicking "Regenerate" does not immediately mutate anything — it reveals an inline confirmation UI (no `window.confirm`/`alert`) explaining the old link will stop working.
- [ ] Confirming triggers the action; on success the displayed invite URL and input value update to the new link without a full page reload, and a success toast/inline message is shown.
- [ ] On failure, the page's existing error banner displays a message and no invite code change is shown.
- [ ] Regenerate/Confirm buttons are disabled while the request is in flight (no double-submit).
- [ ] Unit tests for `regenerateBandInviteCode` (admin success, non-admin/non-member rejection, old-code invalidation) pass in `src/lib/__tests__/bands.test.ts`.
- [ ] `npm run lint` and the existing Vitest suite pass with no new failures.

## Out of Scope

- Real time-based invite-code expiration (`invite_code_expires_at` or similar) — the `invite_code` column and lookup functions are unchanged in shape; this would need its own migration and a check in `join_band_by_invite`/`get_band_by_invite_code`, tracked as a possible follow-up task.
- A "disable/revoke without replacing" mode that removes the ability to join entirely rather than issuing a new code.
- Rate limiting how often a band admin can regenerate, or keeping a history/audit log of prior invite codes.
- Changing authorization on the pre-existing `updateBandAction`/`deleteBandAction`/etc. — those remain UI-gated only, as today; this task only adds a *new* server-side admin check scoped to the new regenerate action.
