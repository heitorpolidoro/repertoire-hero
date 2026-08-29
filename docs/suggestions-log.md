# Suggestions Log

Non-blocking suggestions from Meridian spec/code reviews. Trimmed to the most recent 30 entries.

## [RH-8] Permitir revogar/regenerar o link de convite da banda — 2026-08-29

- `regenerateBandInviteCode` skips the try/catch + `logger.error` + wrapped-`Error` convention used by every other exported function in `src/lib/bands.ts`; harmless functionally but a consistency gap worth a note.
- The page's existing `handleDelete`/`handleLeave`/`handleRemoveMember` already use `window.confirm(...)`, a pre-existing violation of the AGENTS.md "NO Browser Alerts" rule that the spec correctly avoids repeating for the new control — worth flagging as a separate follow-up, not this task's job.

## [RH-8] Permitir revogar/regenerar o link de convite da banda (code review) — 2026-08-29

- `page.tsx` toast `type` union includes `"error"` but only `"success"` is ever dispatched in this diff (minor YAGNI, not blocking).
- Toast state/effect/JSX block is now duplicated verbatim between `src/app/bands/[id]/page.tsx` and `src/app/songs/[id]/fast-view/page.tsx`; consider extracting a shared `useToast`/`<Toast/>` in a future task.
- `regenerateBandInviteCode` (`src/lib/bands.ts`) does the admin-role check and the `UPDATE` as two separate round-trips (check-then-act); a future hardening could fold the check into the `UPDATE ... WHERE EXISTS (...)` clause for atomicity, but not worth blocking given the bounded consequence.

## [RH-11] Melhorar tratamento de erros no fluxo de aceite de convite — 2026-08-29

- The spec's new catch blocks re-throw the raw `Error` unmodified, unlike the wrapped `"Failed to X: ..."` message pattern used elsewhere in `src/lib/*.ts` (playlists.ts, songs.ts, bands.ts) that the spec itself cites as precedent. Not blocking since the new tests only assert `.rejects.toThrow()` with no message check, but a wrapped message would improve Sentry/debuggability consistency.
- The "Manual/QA check" expected result (page renders "Something went wrong" on a forced query() throw) has no automated test coverage — consistent with this codebase's existing conventions (no e2e/component-render test infra exists for any page), so not a new gap, but worth flagging if a future task wants explicit component-level render tests.

## [RH-12] Adicionar aviso de 'você já é membro' ao reabrir um convite — 2026-08-29

- Consider a separate, unrelated cleanup task to reconcile supabase/migrations/ with the numbered migrations/ directory (it's currently missing an equivalent of 0002_add_tabs_and_lyrics.sql and uses a differently-named consolidated base-schema file). Pre-existing gap, unrelated to RH-12's own dual-mirror requirement, not a reason to block that spec.

## [RH-12] Adicionar aviso de 'você já é membro' ao reabrir um convite (code review) — 2026-08-29

- src/lib/__tests__/bands.server.test.ts only mocks @/lib/db's query, so the DB function's actual pre-check/no-op-on-repeat behavior is never exercised by an automated real-DB test (deferred to the spec's manual/QA checklist). Consider a follow-up real-DB assertion in bands.test.ts that calls joinBandByInviteClient twice without an intervening leaveBand to lock in already_member semantics.
