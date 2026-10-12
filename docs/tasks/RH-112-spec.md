# RH-111 — Tell the requester what happened to a correction

> Filename follows the repo convention `docs/tasks/<board id + 1>-spec.md`: this is the spec for board task **RH-111**. Mock: `docs/tasks/RH-111-mock.html`.

## Scope
When a system admin decides a correction, the person who proposed it learns the outcome **per field**, in the app, on their next visit. Three outcomes are told apart (`docs/use-cases.md`, *Suggest a correction to the catalog*): **approved**, **refused** (with the admin's reason if any), and **replaced** (`superseded` — passed over for another proposal, not judged wrong). A group can be partly decided, so a single notice may list mixed outcomes.

Built on RH-107 (landed, `migrations/0021_catalog_suggestions.sql`): per-field rows, `requested_by` index, `status` including `superseded`, `rejection_reason` per row.

**Out of scope**
- The offer to keep a refused/replaced value as a personal override (key, tuning, lyrics, map). That personal level does not exist yet; the notice must leave room for it but ships no control. A follow-up task owns it.
- Email/push delivery, a notification centre, or history beyond unseen outcomes.
- Author-only visibility of the still-pending value; the grouped admin review screen.
- Landing page: internal/operational, not a selling point (AGENTS.md Landing Page Rule), so no dictionary landing copy changes.

## Approach
**Behavior**
- A requester's `approved`, `rejected` and `superseded` rows are "unseen" until acknowledged. Pending rows never appear.
- On the signed-in repertoire home, a dismissible banner lists unseen outcomes grouped by submission: song title/artist, then one line per field with its outcome (approved; refused plus reason when present; replaced by another correction). Copy is plain-language, in both `en.json` and `pt-BR.json`.
- Dismissing (or an explicit "Got it") acknowledges exactly the listed rows; they never reappear. Rows decided after the banner loaded stay unseen.
- Only the requester ever reads their own outcomes: the read is scoped by the session user inside the library function; the Server Action takes no caller-supplied user id.
- Superseded rows are told as "replaced", never as "refused", and carry no reason.

**Files touched**
- `migrations/NNNN_catalog_suggestion_acknowledged.sql` (prefix read from `migrations/` at implementation time): nullable `acknowledged_at timestamptz` on `catalog_suggestions`; partial index on `(requested_by) WHERE acknowledged_at IS NULL AND status <> 'pending'`.
- `src/lib/catalogSuggestionSql.ts`: unseen-outcomes read and acknowledge statements.
- `src/lib/moderation.ts` (or a new sibling module if the complexity/line budget requires — never a new override): `getUnseenSuggestionOutcomes(userId)` and `acknowledgeSuggestionOutcomes(userId, ids)`; acknowledge only touches rows with `requested_by = userId`.
- `src/app/actions/moderation.ts`: two thin actions resolving the user via `getRequiredUserId`.
- `src/types/database.ts`: outcome projection type; `acknowledged_at` on `CatalogSuggestion`.
- `src/components/songs/SuggestionOutcomeBanner.tsx` (new, presentational, actions injected) and its mount in `RepertoireDashboard.tsx`; `src/app/page.tsx` injects the actions.
- `src/i18n/dictionaries/{en,pt-BR}.json`: banner copy.
- `docs/use-cases.md`: note that the notice is built and the override offer is still pending; `package.json` version bump.

**Test criteria**
- `catalogSuggestionOutcomes.db.test.ts` (live schema): each status maps to the right outcome, pending is excluded, another user's rows are invisible and cannot be acknowledged, acknowledge is idempotent, a partly decided group lists mixed outcomes.
- Component test for the banner: renders the three outcomes distinctly, dismiss calls the injected action with exactly the listed ids, renders nothing when empty.
- Existing guards (`complexityBudget`, `transactionGuard`, `migrationsSingleSource`) still pass unrelaxed; en/pt-BR dictionary key parity test passes.

## Expected Results
- [ ] A requester whose field was approved, refused or superseded sees that outcome per field on the signed-in home, with the refusal reason when one was given.
- [ ] A superseded field is shown as "replaced", never as refused, and shows no reason.
- [ ] Pending suggestions and other users' suggestions never appear in a user's notice (db test).
- [ ] Dismissing acknowledges exactly the listed rows; a reload shows no banner for them, while rows decided afterwards still appear.
- [ ] Acknowledging ids belonging to another user changes no row (db test).
- [ ] The new migration adds nullable `acknowledged_at` and the migration/single-source tests pass.
- [ ] Banner copy exists in `en.json` and `pt-BR.json` and the dictionary parity test passes.
