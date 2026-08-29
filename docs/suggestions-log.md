# Suggestions Log

Non-blocking suggestions from Meridian spec/code reviews. Trimmed to the most recent 30 entries.

## [RH-8] Permitir revogar/regenerar o link de convite da banda — 2026-08-29

- `regenerateBandInviteCode` skips the try/catch + `logger.error` + wrapped-`Error` convention used by every other exported function in `src/lib/bands.ts`; harmless functionally but a consistency gap worth a note.
- The page's existing `handleDelete`/`handleLeave`/`handleRemoveMember` already use `window.confirm(...)`, a pre-existing violation of the AGENTS.md "NO Browser Alerts" rule that the spec correctly avoids repeating for the new control — worth flagging as a separate follow-up, not this task's job.

## [RH-8] Permitir revogar/regenerar o link de convite da banda (code review) — 2026-08-29

- `page.tsx` toast `type` union includes `"error"` but only `"success"` is ever dispatched in this diff (minor YAGNI, not blocking).
- Toast state/effect/JSX block is now duplicated verbatim between `src/app/bands/[id]/page.tsx` and `src/app/songs/[id]/fast-view/page.tsx`; consider extracting a shared `useToast`/`<Toast/>` in a future task.
- `regenerateBandInviteCode` (`src/lib/bands.ts`) does the admin-role check and the `UPDATE` as two separate round-trips (check-then-act); a future hardening could fold the check into the `UPDATE ... WHERE EXISTS (...)` clause for atomicity, but not worth blocking given the bounded consequence.
