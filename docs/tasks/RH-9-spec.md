# RH-9 — Corrigir mensagem enganosa de convite "expirado"

## Scope

This task fixes the copy shown on the "Invalid invite link" state of
`/join/[code]` (`src/app/join/[code]/page.tsx`), which currently claims the
link "has expired." Invite codes never expire on a timer, so that claim is
false. This is a pure copy/message change to the existing invalid-link
branch — no new expiration mechanism, no new database columns, no new UI
states, and no change to `getBandByInviteCodeServer` or any other lookup
logic.

An invite link can currently be invalid for three underlying reasons, all of
which collapse to the same `getBandByInviteCodeServer` → `null` result and
render the same branch:
1. The code never existed (typo, malformed, copy-paste error).
2. The band it pointed to was deleted.
3. The code was regenerated/revoked by a band admin (`regenerateBandInviteCode`,
   shipped in RH-8) — the old code stops resolving immediately.

The fixed copy must be accurate for all three without distinguishing between
them (the page has no way to tell them apart today, and adding that
distinction is out of scope).

## Approach

In `src/app/join/[code]/page.tsx`, within the `if (!bandInfo)` branch
(current lines 20–40):

- Replace the body copy:
  ```
  This invite link is invalid or has expired.
  ```
  with copy that does not use the word "expired" and does not imply a
  time-based mechanism. E.g.:
  ```
  This invite link is no longer valid. It may be incorrect, or the band
  admin may have generated a new one.
  ```
- Leave the heading ("Invalid invite link"), the 🔗 icon, and the "Go home"
  link unchanged — only the descriptive `<p>` text changes.
- No other files change. `getBandByInviteCodeServer` in
  `src/lib/bands.server.ts` is unchanged — it already correctly returns
  `null` for all three cases; this task only changes how that `null` is
  described to the user.

Exact wording is not prescribed beyond the constraint below — pick copy
consistent with the existing tone of the page (short, plain sentence,
sentence case, no exclamation marks, matching neighboring strings like
"Accept invitation?" / "Sign in to accept").

## Expected Results

- [ ] The invalid-invite-link message in `src/app/join/[code]/page.tsx` no longer contains the word "expired" or otherwise implies a time-based expiration.
- [ ] The replacement copy remains accurate when the cause is a never-existed/mistyped code, a deleted band, or a regenerated/revoked code (i.e., it describes the link as no longer valid without asserting a specific single cause).
- [ ] The heading text ("Invalid invite link"), the 🔗 icon, and the "Go home" link/behavior in that branch are unchanged.
- [ ] No changes to `src/lib/bands.server.ts`, `getBandByInviteCodeServer`, or any invite-code lookup/generation logic.
- [ ] `npm run lint` passes with no new failures.
- [ ] Manual/QA check: visiting `/join/<a-code-that-was-just-regenerated-away>` and `/join/<a-code-that-never-existed>` both render the same updated copy (confirming the wording doesn't falsely claim one specific cause).

## Out of Scope

- Implementing real time-based invite-code expiration (tracked separately, e.g. as noted in RH-8's Out of Scope).
- Distinguishing in the UI between "code never existed," "band deleted," and "code regenerated" — all three continue to render one generic invalid-link message.
- Any change to invite-code generation, lookup, or revocation logic (`src/lib/bands.ts`, `src/lib/bands.server.ts`, `src/app/actions/bands.ts`).
- Localization/i18n of this string (tracked under the separate i18n effort, RH-14).
