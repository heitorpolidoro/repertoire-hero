# RH-107 — Replace `global_song_edits` with `catalog_suggestions`

> Filename follows the repo convention `docs/tasks/<board id + 1>-spec.md`. This
> is the spec for board task **RH-107**. The id `RH-108` is a different task
> ("Merge the catalog and Spotify search results into one list", spec
> `docs/tasks/RH-109-spec.md`); the collision is expected under that convention
> and this file belongs to RH-107 alone.
>
> Written against HEAD `5d602f7`. Every line number below was read at that
> commit, except where this spec cites RH-136's in-flight code in
> `src/lib/moderation.ts` (the `UPDATE songs` construction in *Submitting and
> reviewing*), which was read from the working tree. **RH-136 is in flight in this checkout and edits
> `src/lib/moderation.ts`**, so that file's line citations will move; read it by
> symbol name (`submitSongEdit`, `getPendingSongEdits`, `reviewSongEdit`) rather
> than by line, and re-derive any count this spec asks you to compare against.

## The recorded decision this task discharges

`src/lib/moderation.ts:11-17` carries a deliberate comment: `global_song_edits`
keeps its name because "the plan replaces it wholesale with a differently shaped
`catalog_suggestions` — one row per proposed field instead of a jsonb of several
— so renaming it to `song_edits` now would be churn that part deletes." The same
decision is recorded three more times:
`migrations/0013_rename_global_songs_to_songs.sql:49-51`,
`migrations/0014_add_albums_and_song_versions.sql:346-347`, and
`src/lib/songEditPayload.ts:38-41`.

**This task is that part.** Nothing in the decision is contradicted and nothing
about it changed: the decision was *not* "the name is fine", it was "the rename
is deferred because the replacement deletes the table". So this task does not
rename anything — it replaces the table, and the name question disappears with
it. A spec that renamed `global_song_edits` to `song_edits` would be the churn
that comment refuses; a spec that left the shape alone would not be this task.

Concretely: **a table replacement with a data migration, plus a shape change
(one row per proposed column), plus a generalised safety property** (the closed
column allowlist that makes identifier interpolation safe must survive being
keyed by table as well as column). It is not a type rename and not a behaviour
change to what a musician can submit.

**Only the two `src/` comments are rewritten.** `src/lib/moderation.ts`'s
comment above the submit SQL is deleted and
`src/lib/songEditPayload.ts:1-14`/`:38-41` are rewritten, because both describe
live code whose premise has changed. The two migration comments —
`migrations/0013_rename_global_songs_to_songs.sql:49-51` and
`migrations/0014_add_albums_and_song_versions.sql:346-347` — **stay exactly as
applied history and must not be edited**, which is what ER12 says and what
§*Files touched* enforces by omitting both files. A migration already run
against every database records what that migration did; the fact that a later
part discharged its deferral is recorded by this task's own migration, not by
rewriting an applied one.

## Scope

**In scope**

1. One new migration, prefix read off `migrations/` at implementation time
   (ends at `0018` today), suffix **`_catalog_suggestions.sql`** — the replay
   suite resolves it by suffix, never by prefix
   (`src/lib/__tests__/test-helpers.ts:241` `migrationSqlBySuffix`). It creates
   `catalog_suggestions`, backfills it from `global_song_edits`, and
   `DROP TABLE global_song_edits` in the same file.
2. `src/lib/moderation.ts` — `submitSongEdit` / `getPendingSongEdits` /
   `reviewSongEdit` move onto the new table and the new shape, keeping
   `checkSystemAdmin` as the only gate on the queue.
3. `src/lib/songEditPayload.ts` — moves to
   `src/lib/catalogSuggestionPayload.ts` and grows **two** new exports: the
   per-`(table, column)` validator that ER5 drives, and the allowlist it
   consults, `CATALOG_SUGGESTION_COLUMNS`, as a **runtime** value (see *The
   allowlist is a runtime value*). The seven normalisers (`parseTitle` at `:45`
   through `parseLinks` at `:98`) are kept exactly as they are, including
   RH-122's title split — but the module's `PREFIX` (`:29`) changes text, see
   *One error prefix, not two*. `AGENTS.md:413` names
   `SongEditPayload` as the `<Subject>Payload` convention example and moves
   with it. Every renamed identifier is listed in *The new names* below —
   that table, not the implementer's taste, is the contract.
4. `src/types/database.ts:137` — `SongEdit` becomes `CatalogSuggestion`;
   `EditStatus` (`:135`) gains `superseded`.
5. `src/app/actions/moderation.ts`, `src/app/admin/moderation/page.tsx`,
   `src/components/admin/{ModerationQueue,PendingEditCard,PendingEditDiff}.tsx`,
   `src/app/page.tsx`, `src/components/songs/{CorrectionModal,SongForm,RepertoireDashboard}.tsx`
   — carried onto the new vocabulary. **No visual change** (see *The admin queue
   keeps its shape*), which is why this task ships no mockup.
6. `src/lib/songs.ts:223` (`applySongLinkUpdate`'s submit call) and six stale
   `src/` sites that name the legacy table or the legacy model. **Four carry
   the table literal** and ER12's first grep counts them:
   `src/lib/catalogFields.ts:28` (routes a refused column to "the
   `global_song_edits` queue"), `src/lib/catalogFields.ts:259-260` (names
   "RH-107's one-row-per-field model" as future work — it has arrived),
   `src/lib/__tests__/test-helpers.ts:183` (carries the literal inside a prose
   `LOCK TABLE songs, global_song_edits` example), and
   `src/lib/songEditPayload.ts:5`. **Two more name the model in prose**, which
   no literal grep for `global_song_edits` or `SongEdit` reaches — so ER12
   gains a second grep, for the spaced and hyphenated forms:
   `src/components/songs/CorrectionModal.tsx:46` ("The injected
   global-song-edit Server Action") and
   `src/components/admin/ModerationQueue.tsx:120` (the admin empty-state
   sentence "There are no pending global song edit proposals to review right
   now."). **That grep must be case-insensitive (`grep -roiE`)**, because two of
   the occurrences are capitalised and a case-sensitive form leaves them
   invisible to every ER in this spec. Measured in the working tree,
   `grep -roiE` finds **12** non-test occurrences against `grep -roE`'s **10**:
   those two component strings, the `PREFIX` at
   `src/lib/songEditPayload.ts:29`, and **nine** in `src/lib/moderation.ts` —
   six log and wrapper messages (`:74`, `:75`, `:128`, `:129`, `:229`, `:234`),
   the catch filter's prefix arm (`:223`), and the capitalised not-found pair,
   `throw new Error('Global song edit not found')` at `:148` and the
   `err.message === 'Global song edit not found'` filter arm at `:224`. All
   twelve move to the new vocabulary; ER12 counts them case-insensitively and
   ER23 pins the not-found literal and its filter arm by name.
7. The test files that name the legacy table or type, including
   `src/lib/__tests__/test-helpers.ts:556` (the frozen legacy DDL used by the
   0014 replay suites — it must keep creating the legacy table, under an
   assembled name).

**Out of scope** — boundaries, with the owner named

- **The grouped review screen.** `docs/use-cases.md:704-723` decides two-level
  grouping (by target column, then by value), identical proposals collapsing to
  one option carrying its count and its requesters, and choosing an option
  closing the others. This task installs the *model* those need — the
  per-column row, the `(target_table, target_id, target_column)` index, and the
  `superseded` status — and leaves the screen itself unbuilt. A follow-up task
  must be filed for it; it is a UI deliverable of its own and needs a mockup.
- **Telling the requester — RH-111.** No notice, no per-field outcome message,
  no offer to keep a refused value as a personal override
  (`docs/use-cases.md:716-721`). This task's contribution to RH-111 is exactly
  what RH-111 needs and cannot invent: a stable per-field suggestion id, a
  per-field `status`, a `requested_by` index, `rejection_reason` preserved per
  field, and `superseded` as distinct from `rejected` — because
  `docs/use-cases.md:719` requires the requester be told which happened.
- **Per-link-row corrections — RH-138.** `links` stays one proposable `songs`
  column whose approved value is applied as a whole set. This task does not
  touch `CATALOG_COLUMNS`, `RefusableCatalogColumn` or `usableLinks` in
  `src/lib/catalogFields.ts`; RH-138 owns that enumerated retype.
- **Targets other than `songs`.** The row *shape* is
  `(target_table, target_id, target_column, value)` as the plan requires
  (`docs/plans/repertoire-rework.md:48`), and the allowlist is keyed by the
  pair — but `albums`, `song_versions` and `song_links` are **not** admitted
  yet, because no surface submits a correction to them and an allowlist entry
  no writer can reach is unverifiable. Widening the allowlist is one `ALTER
  … CHECK` plus a TS entry, and belongs to the task that builds the surface.
- The admin catalog screen, merge/split/delete (RH-117), and orphan cleanup
  (see *No foreign key on the target*).

## Approach

### The new names

ER14 requires the string `SongEdit` to be absent from `src/`. Measured at
`5d602f7`, `git grep -hoE '[A-Za-z_]*SongEdit[A-Za-z_]*' -- 'src/*.ts'
'src/*.tsx' | sort | uniq -c` prints exactly nine identifiers (188 occurrences
in total). Three of them are library functions, three are Server Actions and
two are types, all consumed across module boundaries — `src/app/page.tsx`,
`RepertoireDashboard`, `SongForm`, `CorrectionModal` and six test files take the
actions as **injected props**. So the replacement name is specified here rather
than chosen per call site:

| occurrences | today | becomes | where |
|---|---|---|---|
| 30 | `SongEdit` | `CatalogSuggestion` | `src/types/database.ts` |
| 7 | `SongEditPayload` | `CatalogSuggestionPayload` | `src/lib/catalogSuggestionPayload.ts` |
| 45 | `parseSongEditPayload` | `parseCatalogSuggestionPayload` | same module |
| 31 | `submitSongEdit` | `submitCatalogSuggestion` | `src/lib/moderation.ts` |
| 15 | `getPendingSongEdits` | `getPendingCatalogSuggestions` | `src/lib/moderation.ts` |
| 31 | `reviewSongEdit` | `reviewCatalogSuggestionGroup` | `src/lib/moderation.ts` |
| 9 | `submitSongEditAction` | `submitCatalogSuggestionAction` | `src/app/actions/moderation.ts` |
| 7 | `getPendingSongEditsAction` | `getPendingCatalogSuggestionsAction` | `src/app/actions/moderation.ts` |
| 13 | `reviewSongEditAction` | `reviewCatalogSuggestionGroupAction` | `src/app/actions/moderation.ts` |

Two names in the table's target column are **new rather than renamed**, and
belong to it for the same reason: `CATALOG_SUGGESTION_COLUMNS` (the exported
runtime allowlist, *The allowlist is a runtime value*) and
`PendingCatalogSuggestionGroup` (the grouped projection the admin components
take, *The row type and the card type*). ER14's loop pins the first; `tsc` and
ER20 pin the second.

The module `src/lib/songEditPayload.ts` is renamed
`src/lib/catalogSuggestionPayload.ts`, matching its exported type per
`AGENTS.md:413`. **Every prop name takes the name of the action it carries** —
a component whose prop is `submitSongEditAction` today receives
`submitCatalogSuggestionAction`, so the grep and the wiring agree. The
signatures are unchanged except `reviewCatalogSuggestionGroup`, whose first
argument becomes a `group_id` instead of an edit id.

**Names that deliberately do not move**, to bound the rename: `EditStatus`
(which gains `superseded`), `ModerationQueue`, `PendingEditCard`,
`PendingEditDiff`, `checkSystemAdmin` and the seven private normalisers. None
contains the banned literal and renaming them is churn this task does not buy.

### Two validators, because they refuse different things

The payload module exports **two** functions after this task, and the
difference between them is the whole of ER5:

- `parseCatalogSuggestionPayload(data)` — the submit-time group narrower,
  behaviourally identical to today's `parseSongEditPayload`. It **ignores**
  keys that are not `songs` columns, because `CorrectionModal` sends a `reason`
  alongside the proposed columns (`src/lib/songEditPayload.ts:11-14`) and the
  admin queue renders it. It throws only when the payload is not a plain
  object, proposes no known column, or carries a known column whose value the
  catalog cannot store.
- `parseCatalogSuggestionValue(targetTable, targetColumn, value)` — **new**, and
  the one place a caller-supplied identifier is admitted. It **rejects** rather
  than ignores: a pair outside the allowlist throws
  ``Invalid catalog suggestion: `<table>.<column>` is not an allowlisted catalog
  column``. It is called once per row on the submit fan-out and once per row on
  approval, immediately before the identifier is interpolated into
  `UPDATE songs SET ${col} = $1`, and it returns the normalised value through
  the same seven normalisers.

That split is why the ignore-vs-reject asymmetry is safe: the only function that
ever sees a column *name* refuses an unknown one, and the only function that
tolerates stray keys never produces a name. It is also why ER5 is reachable at
all — `parseCatalogSuggestionValue` takes the table and the column from its
caller, so a non-existent table and a real-but-forbidden column
(`id`, `created_at`, `updated_at`) are both drivable through an exported
function with no raw SQL. Neither is drivable through
`submitCatalogSuggestion(userId, songId, data)`, which takes no table argument
and whose payload narrower would silently drop `created_at`; that asymmetry is
measured, not assumed, and it is why ER5 names the validator rather than the
submit entry point.

### The allowlist is a runtime value, and the payload type is derived from it

`CatalogSuggestionPayload` is a TypeScript **interface**, and a TS interface has
**no runtime keys** — nothing can enumerate its members at test time, so an ER
written against "each key of the type" is not writable without hardcoding the
list. The module therefore exports the allowlist itself as a **runtime
constant**, `CATALOG_SUGGESTION_COLUMNS`: keyed by `target_table`, then by
`target_column`, each entry carrying the normaliser that column already uses
(`parseTitle`, `parseArtist`, `parseAlbum`, `parseStandardKey`, `parseCoverUrl`,
`parseDurationSeconds`, `parseLinks`). `CatalogSuggestionPayload` is then
**derived from that constant** — a mapped type over
`typeof CATALOG_SUGGESTION_COLUMNS['songs']`, every member optional, each
member's type the return type of its normaliser — rather than declared
independently.

Three things follow, and all three are the point. The type and the allowlist
cannot drift, because one is computed from the other. The constant is the single
source every consumer reads: `parseCatalogSuggestionValue` looks the pair up in
it, `parseCatalogSuggestionPayload` iterates it instead of repeating seven `if
(source.x !== undefined)` lines, and the migration's row-wise CHECK mirrors the
same pairs in SQL. And ER5's second test can iterate
`Object.keys(CATALOG_SUGGESTION_COLUMNS.songs)` — a real array at runtime —
instead of a list this spec would otherwise have to dictate.

### One error prefix, not two

The module's refusal messages keep one prefix, and it changes text with the
model: `PREFIX` (`src/lib/songEditPayload.ts:29`) becomes
`Invalid catalog suggestion`. Leaving it at `Invalid global song edit` while the
new validator throws `Invalid catalog suggestion` would split the prefix in two,
and **the consequence is not cosmetic**: `reviewSongEdit`'s catch filter
(`src/lib/moderation.ts`, the `err.message.startsWith('Invalid global song
edit')` arm) re-throws a validation refusal verbatim and wraps everything else,
per the L1a convention — so a refusal carrying the other prefix would be
wrapped as `Failed to review …` and the UI would show the wrong message.

**Nine occurrences in `src/lib/moderation.ts` move, and the count matters
because two of them are capitalised** and so invisible to a case-sensitive
grep (which is why ER12's second grep is `grep -roiE`):

| site | today | becomes |
|---|---|---|
| `:74` log, `:75` wrapper | `Failed to submit global song edit` | `Failed to submit a catalog suggestion` |
| `:128` log, `:129` wrapper | `Failed to fetch pending global song edits` | `Failed to fetch pending catalog suggestions` |
| `:229` log, `:234` wrapper | `Failed to review global song edit` | `Failed to review a catalog suggestion group` |
| `:223` catch filter arm | `startsWith('Invalid global song edit')` | `startsWith('Invalid catalog suggestion')` |
| `:148` thrown not-found | `Global song edit not found` | `Catalog suggestion group not found` |
| `:224` catch filter arm | `err.message === 'Global song edit not found'` | `err.message === 'Catalog suggestion group not found'` |

The last two are **one change, not two**, and splitting them is a live
regression rather than a cosmetic miss: `:224` is the arm that makes the
not-found error propagate verbatim instead of being wrapped as
`Failed to review a catalog suggestion group: …`. Change `:148` without `:224`
(or the reverse) and the admin sees the wrapped message on a not-found group.
`src/lib/__tests__/moderation.test.ts:165` asserts that literal and moves with
it. ER23 pins the prefix constant, **both** filter arms and the new not-found
literal, and pins the propagation behaviourally.

### The row type and the card type

`src/types/database.ts` carries **two** shapes after this task, not one, because
the table is per-column while the queue is per-group. The shape change is the
task, so the members are enumerated here rather than left to taste:

- `CatalogSuggestion` replaces `SongEdit` with the table's own columns: `id`,
  `group_id`, `target_table`, `target_id`, `target_column`, `value: unknown`,
  `reason: string | null`, `requested_by`, `status: EditStatus`,
  `reviewed_by: string | null`, `rejection_reason: string | null`, `created_at`,
  `updated_at`, plus the two optional joins `SongEdit` already carries,
  `song?: Song` and `requester?: Profile`. `song_id` and `proposed_data` are
  **gone**: `target_id` carries the first, and no row carries the second.
- `PendingCatalogSuggestionGroup` is **new** — what the grouped read returns and
  what the admin components take: `group_id`, `song_id`,
  `proposed_data: Record<string, unknown>` (the `jsonb_object_agg` of the
  group's pending rows), `suggestion_ids: Record<string, string>` (the per-field
  ids RH-111 needs), `reason: string | null`, `requested_by`, `created_at`,
  `song?: Song`, `requester?: Profile`. It carries no `status`, because only
  `pending` rows are aggregated. `ModerationQueue`, `PendingEditCard` and
  `PendingEditDiff` move from `SongEdit[]` onto this type and read the same
  members they read today — `proposed_data`, `song`, `requester`,
  `requested_by`, `created_at` — with `group_id` where they read `edit.id`
  (`PendingEditCard.tsx:40`, `ModerationQueue.tsx:47`). That substitution is
  what ER20 asserts and what keeps the render unchanged.
- `EditStatus` gains `superseded` and keeps its name (see *The new names*).

### The table, as measured

Measured on the dev database (Postgres 16.15, container
`repertoire-hero-postgres-1`, port 54322) by applying `migrations/0001`–`0018`
to a scratch database and then applying the draft migration over the seeded
legacy rows ER13 enumerates. The reviewer of this spec rebuilt the table, the
three indexes, the row-wise CHECK and the backfill from the text below and
replicated every number in it against a production-shaped scratch database.

Columns: `id`, `group_id`, `target_table`, `target_id`, **`target_column`**,
`value jsonb NOT NULL`, `reason`, `requested_by`, `status`, `reviewed_by`,
`rejection_reason`, `created_at`, `updated_at`.

**`requested_by` and `reviewed_by` keep the foreign keys the legacy table gave
them** — `requested_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE`
and `reviewed_by uuid REFERENCES profiles(id)`, exactly as
`migrations/0006_add_system_admin_and_moderation.sql:9,12` declares them.
Only `target_id` loses its FK, because only `target_id` is polymorphic (see
*No foreign key on the target*); dropping the requester FK would be an
unrequested loss of referential integrity and would orphan RH-111's read.
Measured on the scratch database: an INSERT naming a `requested_by` with no
`profiles` row raises **23503**
`violates foreign key constraint "catalog_suggestions_requested_by_fkey"`.
**The practical consequence is for any test or `psql` session that writes a
row by hand**: `profiles.id` itself references `"user"(id)`
(`migrations/0001_initial_schema.sql:84`), so a seed row needs the chain
`"user"` → `profiles` → the suggestion. ER4 spells that chain out.

Four facts that fix those choices, each measured rather than reasoned:

- **`column` cannot be the column name.** `CREATE TABLE t (id int, column text)`
  is a syntax error — `column` is a **reserved** keyword
  (`pg_get_keywords()` catcode `R`), while `value` is unreserved (`U`). The plan
  writes `column` at `docs/plans/repertoire-rework.md:48`; the implementation
  must read `target_column`, or every statement in the codebase has to quote it.
- **`value jsonb NOT NULL` can still express a proposed SQL NULL.**
  `jsonb_typeof('null'::jsonb)` is `null` and `'null'::jsonb IS NULL` is false,
  so a correction setting `album` to nothing is a storable row and is
  distinguishable from "no value proposed". This matters: four of the seven
  columns are nullable and `parseAlbum` (`src/lib/songEditPayload.ts:64`)
  accepts `null`.
- **The allowlist is also a CHECK constraint**, row-wise over the pair:
  `CHECK ((target_table, target_column) IN (('songs','title'), …))` for the
  seven columns `parseSongEditPayload` admits today (`:123-131`). Measured: an
  INSERT naming `target_column = 'id'`, `'updated_at'`, or
  `target_table = 'albums'` each raise **23514**, reported against the
  table-level constraint `catalog_suggestions_check`. This is defence in depth, not
  the primary gate — the TS allowlist is, because that is where the identifier
  is interpolated — but it is what makes "a suggestion naming a column the
  catalog does not accept cannot exist" checkable without running the app.
- **`status` admits four values**: `pending`, `approved`, `rejected`,
  `superseded`. Measured: the CHECK rejects a fifth with **23514**, against
  `catalog_suggestions_status_check` — **but only when a row exists to update**.
  A row-level CHECK is not evaluated for an UPDATE that matches no row:
  measured, `UPDATE catalog_suggestions SET status = 'closed'` on the empty
  table prints `UPDATE 0` and raises nothing. That is why ER4 seeds a valid
  `('songs','title')` row before it tries the fifth status, and why the
  constraint is given a name — an unnamed one would be
  `catalog_suggestions_check1` and indistinguishable from the pair CHECK in the
  error text.

Indexes: partial on `(created_at) WHERE status = 'pending'` (the queue read),
`(target_table, target_id)` (the future grouped screen and any merge
re-pointing), `(requested_by)` (RH-111's read).

`group_id` is what ties the rows of one submission together, so that a
multi-field correction is still one card and still carries one `reason`. The
backfill sets it to the legacy edit's own `id`, which makes the conversion
traceable row by row.

### The backfill, as measured

`INSERT … SELECT` from `global_song_edits CROSS JOIN LATERAL jsonb_each(…)`,
filtered to the seven allowlisted keys. Replayed over the legacy row shapes
ER13 enumerates, the per-shape row counts are the contract — ER13 asserts each
one, so a fixture gaining a shape does not falsify an ER — and **no total is
stated here**. The total is a property of the fixture set, not of the migration:
a reviewer rebuilding ER13's seven shapes from this section measured
`INSERT 0 6` (2+1+1+1+0+0+1) where an earlier draft of this spec reported 7.
Every per-shape count replicated; the total did not, so it is not a number this
spec asserts. Three guards are mandatory and each was measured
failing without them:

- `WHERE jsonb_typeof(proposed_data) = 'object'`. `proposed_data` is
  `jsonb NOT NULL` with no shape constraint
  (`migrations/0006_add_system_admin_and_moderation.sql:10`), so a directly
  written `'[1,2]'` is legal. Without the guard the whole migration dies with
  **22023** `cannot call jsonb_each on a non-object`.
- `COALESCE(created_at, now())` and `COALESCE(updated_at, now())`. Both legacy
  columns are **nullable** (`0006:14-15`; `migrations/0011`'s comment at `:12`
  calls out exactly this), and the new columns are NOT NULL. Without the
  coalesce: **23502**.
- The key filter. `reason` is a non-column key the correction modal sends
  (`src/lib/songEditPayload.ts:11-14`), and it must land in the `reason`
  **column**, never as a `target_column` — a `target_column = 'reason'` row
  would be an identifier interpolated into `UPDATE songs`. Other non-column
  keys are dropped.

Two consequences to state rather than hide: a legacy row whose
`proposed_data` holds no allowlisted key at all produces **zero** suggestion
rows and is lost — measured, and it cannot be produced through the app, because
`parseSongEditPayload` (`:133-137`) refuses a payload proposing no known column.
And a stored value validation would refuse (`{"duration_seconds":"abc"}`, the
case `src/lib/__tests__/moderationPayload.db.test.ts:73-88` deliberately
plants) is carried across **verbatim** and still fails at approval with the row
left `pending` — the backfill does not validate, exactly as the old table did
not.

The dev database currently holds **0** `global_song_edits` rows, so the backfill
has nothing live to convert and cannot be observed on a migrated database. It is
therefore verified the way `migrations/0014`'s backfill is: a replay suite in a
throwaway schema (`src/lib/__tests__/catalogVersionsMigration.db.test.ts`,
`legacyCatalogReplayDdl` at `test-helpers.ts:541`), which takes no lock on
anything in `public`.

### Submitting and reviewing

- **Submit** writes N rows in one statement, one per proposed column, sharing a
  `group_id` and the submitted `reason`. Validation runs before the INSERT and
  per column, as today.
- **Read** projects the pending rows back into one card per `group_id`, with
  `jsonb_object_agg(target_column, value)` as `proposed_data` and
  `jsonb_object_agg(target_column, id)` as the per-field suggestion ids —
  measured, and it is what keeps `PendingEditDiff` unchanged. Only `pending`
  rows are aggregated, so a partially reviewed group shows only what is left.
  `checkSystemAdmin` stays the first statement.
- **Approve a group** is one `withTransaction` unit, as today
  (`withTransaction` in `src/lib/moderation.ts`): every pending row of the group
  is validated first, the validated values are then applied — by the single
  catalog write described in the next bullet, plus the `song_links` replace-set
  for a `links` row — and every row is flipped, all in the same transaction, so
  an invalid field aborts the whole group and applies nothing. **No savepoints** —
  `src/lib/__tests__/transactionGuard.test.ts:27` bans a transaction-control
  literal reaching `query(` anywhere under `src/`.
- **One `UPDATE songs` statement in this file, and only one — built the way
  RH-136 leaves it.** `src/lib/__tests__/catalogTimestampGuard.test.ts:74` pins
  `EXPECTED_CATALOG_WRITERS = 4` as an exact count and scans textually from
  `UPDATE songs` to the next `WHERE` for a literal `updated_at = now()`. RH-136
  lands first and rewrites this statement into an **inline-array
  construction** — `` `UPDATE songs SET ${[...setClauses, 'updated_at =
  now()'].join(', ')} WHERE id = $${n}` ``, which is in `src/lib/moderation.ts`
  in this checkout now — precisely because the clause list may go **empty** once
  `links` is partitioned out of it, and the shape RH-136 removes
  (`SET ${setClauses.join(', ')}, updated_at = now()`) then renders
  `UPDATE songs SET , updated_at = now()` and raises **42601** (measured on a
  scratch database: `ERROR: syntax error at or near ","`).
  **This task carries that construction forward unchanged, and must not
  re-specialise it to a single column:** a single-column template
  (`SET ${col} = $1, updated_at = now()`) cannot be instantiated at all for a
  row whose `target_column` is `links`, because after RH-136 there is no `songs`
  column for it to name.

  So the apply is **one statement per approved group, not one per row**: every
  pending row of the group is validated, each non-`links` row contributes one
  `${col} = $n` clause, and the collected clauses go into that single template.
  Measured renderings — with two clauses,
  `UPDATE songs SET title = $1, album = $2, updated_at = now() WHERE id = $3`;
  with **none**, `UPDATE songs SET updated_at = now() WHERE id = $1`, which is
  valid SQL that advances the column (measured: `UPDATE 1`, and the row's
  `updated_at` moved from a day old to `now()`). The template's source text run
  through the guard's own detector reports `writers = 1, violations = []`,
  because the literal lies between `UPDATE songs` and `WHERE` in the source
  text whether it sits inside the interpolation or after it.
- **An approved `links` row writes `song_links`, never `songs.links`, and the
  group still bumps the timestamp.** RH-136 takes `links` out of the `songs`
  write entirely — `docs/tasks/RH-137-spec.md:260-263` records that the four
  `songs.links` statements it owns "all stop writing the column, so the trigger
  never fires for them and there is no dual write" — so a row whose
  `target_column` is `links` contributes **no clause** to the statement above,
  and its approved value is applied by RH-136's `DELETE`-then-upsert replace-set
  against `song_links`, carried forward verbatim including
  `position = EXCLUDED.position`. **A group whose only approved column is
  `links` contributes zero clauses and still issues the statement**, which
  renders as the bare timestamp bump — so `songs.updated_at` advances, as RH-136
  requires ("the timestamp bump must still happen",
  `docs/tasks/RH-137-spec.md:558-564`), without reintroducing the `songs.links`
  write and without firing RH-136's bridge trigger. **ER22 is the test that
  discriminates the two wrong readings**: writing `songs.links` for that row, or
  issuing no `UPDATE songs` for the group and leaving the timestamp where it
  was. Neither is visible to ER7, whose fixture is `title` + `album`.
- **Superseding is a separate statement and must run after the approve**, not
  before: `UPDATE catalog_suggestions SET status='superseded', … WHERE
  target_table=$1 AND target_id=$2 AND target_column=$3 AND status='pending'`.
  Measured: run after the approve it closes only the competitors (1 approved,
  1 superseded); run before, it would close the row being approved. This is the
  cheap half of `docs/use-cases.md:709-712` and it removes the stale approval
  structurally; the screen that *shows* the competing options is deferred.
  **The statement carries no `group_id <> $n` term, deliberately**: supersession
  keys on the target column, not on the submission. So another group proposing
  the *same* column is superseded (ER9) and another group proposing a
  *different* column is untouched (ER7) — the two ERs test the two halves of
  one statement and must not be read as describing the same fixture.
- **Reject** records `rejection_reason` per row and touches no catalog row.

### The already-reviewed group keeps its own message

`src/lib/moderation.ts` throws `'Edit request is already reviewed'` when the row
it read is not `pending` (`:176` in this tree), and the catch filter re-raises
it verbatim (`:250`). That is a **third** arm of the same filter
§*One error prefix, not two* reworks, and no grep in this spec reached it.

**It survives, reworded to `Catalog suggestion group is already reviewed`, and
the review path keeps reading the group regardless of status.** The tempting
simplification — have the review read only `pending` rows, so an
already-reviewed group falls through as not-found — is rejected: it collapses
two answers an admin needs to tell apart ("someone already handled this" versus
"this group does not exist"), and it would silently change today's behaviour
while passing every expected result. The grouped *queue* read still aggregates
only `pending` rows, as §*The admin queue keeps its shape* requires; this is the
review path only.

So `reviewCatalogSuggestionGroup` selects the group's rows by `group_id` with no
status filter, throws `Catalog suggestion group not found` when none exist, and
throws `Catalog suggestion group is already reviewed` when rows exist but none
is `pending`. Both literals are pinned by ER23, and the filter carries three
arms, not two.

### The admin queue keeps its shape

`ModerationQueue` / `PendingEditCard` / `PendingEditDiff` keep rendering one
card per submitted correction with a field-by-field diff, because the grouped
projection hands them the same `proposed_data`-shaped object they read today.
The action's argument changes from an edit id to a `group_id`. **One
human-visible string moves and only one**: the admin empty-state sentence at
`ModerationQueue.tsx:120` ("There are no pending global song edit proposals to
review right now.") is reworded onto the new vocabulary — "no pending catalog
corrections" — because ER12's prose grep reaches it. It is an admin-only empty
state, names no table (ER11), and is the only copy change in the task; no
musician-facing surface moves. Per-field accept/reject buttons are the deferred screen's, not
this task's — which is why there is no `docs/tasks/RH-108-mock.html` and no open
visual question.

### No foreign key on the target

`target_id` is polymorphic, so it carries no FK, and the legacy
`ON DELETE CASCADE` on `song_id` (`0006:8`) is lost. Consequences to record in
the migration comment: deleting a catalog row (admin-master only, and the
screen for it does not exist yet) leaves orphan suggestions, which the queue's
`JOIN songs` hides from the admin exactly as it does today; and any future merge
path must re-point `target_id WHERE target_table = 'songs'`, which is what
`migrations/0014:346-348` does for the legacy table. Cleanup belongs to RH-117.

**One persisted routine keeps a dangling reference to the dropped table, and it
is latent rather than live.** `migrate_catalog_to_versions()` is a
`CREATE OR REPLACE FUNCTION … LANGUAGE plpgsql` (`migrations/0014:216-217`), so
it survives in the catalog of every migrated database — confirmed on the dev
database via `pg_proc.prosrc LIKE '%global_song_edits%'` — and its body at
`0014:348` holds `UPDATE global_song_edits SET song_id = v_keep WHERE song_id =
v_loser`. A plpgsql body is not parsed until the statement executes, so
`DROP TABLE global_song_edits` neither fails nor invalidates it. Measured:
calling the function after the drop returns cleanly, because that `UPDATE` sits
inside a `HAVING count(*) > 1` duplicate-collapse loop that `uq_songs_artist_title`
makes unenterable. **This task therefore does not touch the routine** — editing
an applied migration is forbidden (see §*The recorded decision*) and replacing
the routine from a new migration would be an unrequested behaviour change to a
one-shot backfill. It is recorded here so the next person to revive that
collapse loop — RH-117 owns merge/split — knows the statement needs re-pointing
at `catalog_suggestions` before it can run, and knows it is dead today rather
than broken.

### The landing page is not touched, and that is the decision

`AGENTS.md:526` requires every spec to decide whether its feature is a selling
point. **This one is not, and the rule's own text says so**: it names
"moderation queues" among the internal and operational features that "must not
be added to the landing page". Nothing a musician sees changes here — the
correction modal and the admin queue render exactly what they render today (see
*The admin queue keeps its shape*) — so no landing copy in
`src/i18n/dictionaries/en.json` or `pt-BR.json` moves, and no ER covers it.

### Security invariants, restated because this task sits on them

Nothing proposed is visible to anyone but a system admin before approval: every
exported reader of `catalog_suggestions` calls `checkSystemAdmin` first, and no
catalog read path joins the table — ER11 makes that structural. Nothing here
relaxes admin-master-only catalog deletion, band-admin-only band writes, or
offline read-only. `src/app/actions/moderation.ts` keeps resolving the user via
`getRequiredUserId` and must not grow an exported helper taking a
caller-supplied `userId` — the file begins with `'use server'`.

### Ordering against the links work

- **RH-136 must land first. Hard.** Its spec (`docs/tasks/RH-137-spec.md`) is
  approved and owns `src/lib/moderation.ts:61` (`'links', s.links` in the queue
  projection) and `reviewSongEdit` at `:91-180`, where it replaces the generated
  `links` SET clause with a `DELETE`-then-upsert replace-set against
  `song_links`, and rewrites the comment at `:146-148`. If RH-107 landed first,
  that approved spec would be written against a function that no longer exists
  and would have to be re-specced. Landing RH-136 first costs RH-107 only this:
  the approved-`links` branch of the per-column apply is **RH-136's replace-set,
  carried forward verbatim** — including `position = EXCLUDED.position`, which
  RH-136 identifies as its likeliest silent failure — and the `UPDATE songs`
  statement is RH-136's inline-array construction, also carried forward
  verbatim. See *Submitting and reviewing* for both, and for why a links-only
  group still advances `songs.updated_at`. RH-136 keeps the `songs.links`
  column (it does not drop it), so `links` remains a valid `target_column`
  either way — but **nothing in this task writes that column**.

  **Caveat, and it bounds what "verbatim" may mean here: RH-136 is `in_progress`
  and under revision in this very checkout.** Its own code review returned a
  blocking defect (an unresolved push-route regression) and its spec premise
  about deferring the `DROP` is known false, so the replace-set at
  `src/lib/moderation.ts:176-186`, `:205` and `:43` is **not yet an approved
  shape**. RH-107 therefore depends on RH-136's *contract* — `links` is applied
  against `song_links` and not against `songs.links`, and the group still bumps
  `songs.updated_at` — and not on the current text of those lines. Carry
  forward whatever replace-set RH-136 lands with; if it changes shape before it
  lands, nothing in this spec needs re-speccing, because ER22 asserts the
  observable outcome (the ordered `song_links` rows and the advanced timestamp)
  rather than the statement. If RH-136 is still `in_progress` when this task is
  picked up, the implementer blocks rather than branching off an unapproved
  implementation.
- **RH-137 is independent.** It edits only
  `src/app/api/spotify/playlists/[id]/sync/route.ts` and
  `src/lib/spotifyPlaylistSync.ts`; it names no moderation file. Either order.
- **RH-138 should land before this task, and the board already requires it**
  (RH-107 is `blockedBy` RH-110, which is `blockedBy` RH-136/137/138). If it
  has, `links` is gone from the correction model and this task's allowlist
  simply has six `songs` entries instead of seven, and the per-link suggestion
  target RH-138 introduces is admitted in place of it. If it has not, `links`
  is the seventh entry as described above. **`CATALOG_SUGGESTION_COLUMNS` is therefore
  written at implementation time from the columns the payload module actually
  normalises at that HEAD, not copied from this spec**, and
  `CatalogSuggestionPayload` is derived from the constant rather than the other
  way round (see *The allowlist is a runtime value*) — so the type, the
  validator and the migration's CHECK all follow one list. ER5 proves that list
  refuses rather than merely declares.

### Files touched

| path | what changes |
|---|---|
| `migrations/NNNN_catalog_suggestions.sql` | new: create, backfill, drop the legacy table |
| `src/lib/moderation.ts` | the three functions are renamed per *The new names* and move onto the new table and shape; the `UPDATE songs` statement keeps RH-136's inline-array construction (*Submitting and reviewing*); the **nine** legacy-model strings enumerated in *One error prefix, not two* move — six log/wrapper messages, **both** catch filter arms (the `Invalid catalog suggestion` prefix arm and the `Catalog suggestion group not found` equality arm) and the thrown not-found literal; the comment above the submit SQL is deleted |
| `src/lib/songEditPayload.ts` → `src/lib/catalogSuggestionPayload.ts` | renamed; gains two exports, `parseCatalogSuggestionValue` and the runtime constant `CATALOG_SUGGESTION_COLUMNS`, with `CatalogSuggestionPayload` derived from the latter; `PREFIX` becomes `Invalid catalog suggestion`; the `:5` and `:38-41` comments rewritten **without naming the new table** (ER11) |
| `src/types/database.ts` | `SongEdit` → `CatalogSuggestion` with the members enumerated in *The row type and the card type*; new `PendingCatalogSuggestionGroup` for the grouped read; `EditStatus` gains `superseded`; the new doc comments describe "the moderation queue", never the table name (ER11) |
| `src/app/actions/moderation.ts` | the three action names per *The new names*; `reviewCatalogSuggestionGroupAction` takes a `group_id`; `getRequiredUserId` unchanged |
| `src/app/admin/moderation/page.tsx` | reads the grouped projection |
| `src/components/admin/ModerationQueue.tsx` | reviews a `group_id`; takes `PendingCatalogSuggestionGroup[]`; the `:120` empty-state sentence reworded off the legacy model name (ER12's prose grep) |
| `src/components/admin/PendingEditCard.tsx`, `PendingEditDiff.tsx` | onto `PendingCatalogSuggestionGroup`, same members read, `group_id` where `edit.id` was |
| `src/app/page.tsx`, `src/components/songs/{RepertoireDashboard,SongForm}.tsx` | injected action rename only |
| `src/components/songs/CorrectionModal.tsx` | injected action rename, and the `:46` prop comment reworded off "global-song-edit" (ER12's prose grep) |
| `src/lib/songs.ts` | the `submitSongEdit` call at `:223` |
| `src/lib/catalogFields.ts` | the stale comments at `:28` and `:259-260`; the imported payload type name. `CATALOG_COLUMNS` / `RefusableCatalogColumn` / `usableLinks` untouched (RH-138 owns them) |
| `src/lib/__tests__/test-helpers.ts` | legacy name assembled as its own constant `LEGACY_EDITS_TABLE` — **not** the existing `LEGACY_CATALOG_TABLE`, which names `global_songs` and is only cited by ER12 as the assembly precedent — used by the frozen DDL (re-derive its line; `:556` at the time of writing, `:569` after RH-136's edits); the prose `LOCK TABLE` example at `:183` reworded off the literal; new replay DDL for the legacy queue table |
| `src/i18n/dictionaries/{en,pt-BR}.json` | **not touched** — see *The landing page is not touched* |
| `migrations/0013_…sql`, `migrations/0014_…sql` | **not touched** — applied history, including their deferral comments and `migrate_catalog_to_versions()` |
| `src/lib/__tests__/catalogSuggestionsMigration.db.test.ts` | new: the backfill replayed |
| `src/lib/__tests__/catalogSuggestions.db.test.ts` | new: submit / approve / reject / supersede / allowlist against the live schema |
| `src/lib/__tests__/songEditPayload.test.ts` → `catalogSuggestionPayload.test.ts` | renamed with its subject; gains the `parseCatalogSuggestionValue` refusal tests ER5 names |
| `src/lib/__tests__/moderation.test.ts` (including the not-found literal it asserts at `:165`), `moderationPayload.db.test.ts`, `transactionAtomicity.db.test.ts`, `catalogRename.db.test.ts`, `catalogVersionsMigration.db.test.ts`, `songIdentity.db.test.ts`, `songs.test.ts` | carried onto the new table and type |
| `src/lib/__tests__/songLinksTable.db.test.ts` | RH-136 added it in this tree and it writes and reads `global_song_edits` directly (two sites); dropping the legacy table breaks this suite outright, not merely a grep, so it must be carried. ER12 and ER19 force it either way — this row exists so it is not discovered at ER19 |
| `src/app/actions/__tests__/{thinActions,actionSessionGuard}.test.ts`, `authzRepertoire.db.test.ts` | action names and the queue table |
| `src/components/admin/__tests__/ModerationQueue.test.tsx`, `src/components/songs/__tests__/{SongForm,CorrectionModal}.test.tsx` | prop and payload names, and the mocked error strings (`:136`, `:143`, `:151`, `:154`) onto the new wrapper messages |
| `docs/use-cases.md:742` | the `global_song_edits` paragraph, now history |
| `AGENTS.md:413` | the `SongEditPayload` convention example |
| `package.json` | `version` bump (AGENTS.md:523) |

### Test criteria

Behaviour against the live schema in `src/lib/__tests__/catalogSuggestions.db.test.ts`
(submit fan-out with non-column keys dropped, per-field approve with a
different-column bystander left pending, a **links-only** approval writing
`song_links` and still bumping `songs.updated_at` (ER22), group atomicity, a
validation refusal and a not-found group each propagating verbatim rather
than wrapped (ER23), reject,
supersede, non-admin refusal); the `(table, column)` refusal as a pure unit test in
`src/lib/__tests__/catalogSuggestionPayload.test.ts`, which is where a
caller-supplied identifier is actually reachable; the row-wise CHECK by direct
`psql` (ER4); the conversion in
`src/lib/__tests__/catalogSuggestionsMigration.db.test.ts` (the migration file
resolved by suffix, replayed in a throwaway `rh107_<token>` schema over the
seven legacy row shapes ER13 enumerates); unchanged unit coverage of the seven
normalisers and of the admin components; and the four standing guards — `complexityBudget`,
`catalogTimestampGuard`, `transactionGuard`, `migrationsSingleSource` — still
passing without a relaxed pin. `src/lib/moderation.ts` must stay inside the
**base** budget (complexity 15, max-depth 4, max-lines-per-function 200,
max-lines 400): it has no override today and the override list may only shrink,
so helper extraction, not a new override, is the remedy. **Budget the lines
before writing them, and re-measure first — RH-136 is still editing this file,
so any number written here is stale by the time it is read.** `src/lib/moderation.ts`
was **180** lines at `5d602f7` and **261** lines when this spec was last
reviewed, so the 400-line ceiling leaves on the order of **140** lines for
everything this task adds to that file: the
submit fan-out, the grouped `jsonb_object_agg` projection, the per-row
validation loop, the collected-clause `UPDATE songs`, and the supersede
statement. That is not comfortable. Extract the grouped projection's SQL and
the per-row validation into helpers — `src/lib/playlistSql.ts` and
`src/lib/songLinksSql.ts` are the established pattern for moving a statement
out of a behaviour module — rather than discovering the ceiling at ER16. If the
SQL moves, it moves into `src/lib/catalogSuggestionSql.ts`, which ER11 admits
by name. **If it still does not fit, the answer is a further non-SQL helper,
never a new override**: the override list may only shrink.

## Expected Results

ER numbering is the contract; every command runs from
`/Users/heitor/workspace/repertoire_hero` unless stated.

- [ ] **ER1 — the migration exists exactly once and keeps the prefix rule.**
      `ls migrations/*_catalog_suggestions.sql | wc -l | tr -d '[:space:]'`
      prints `1`, and
      `npx vitest run src/lib/__tests__/migrationsSingleSource.test.ts` exits 0
      reporting 0 failed and 0 skipped.
- [ ] **ER2 — a freshly migrated database carries the table with the measured
      shape.** Run:
      `psql "postgresql://postgres:postgres@localhost:54322/postgres" -c 'DROP DATABASE IF EXISTS rh107_er2;' -c 'CREATE DATABASE rh107_er2;'`
      then
      `DATABASE_URL="postgresql://postgres:postgres@localhost:54322/rh107_er2" node scripts/migrate.mjs`
      (last line `All migrations executed successfully`), then
      `psql "postgresql://postgres:postgres@localhost:54322/rh107_er2" -tAc "SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='catalog_suggestions';"`
      prints exactly
      `id,group_id,target_table,target_id,target_column,value,reason,requested_by,status,reviewed_by,rejection_reason,created_at,updated_at`.
      No column is named `column`. **Keep this database — ER3 and ER4 run
      against it, and ER4 drops it at the end.**
- [ ] **ER3 — the legacy table is gone from a migrated database.** On the ER2
      database (`postgresql://postgres:postgres@localhost:54322/rh107_er2`),
      `psql "$URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='global_song_edits';"`
      prints `0`.
- [ ] **ER4 — the four storage facts hold where the code relies on them.** On
      the ER2 database
      (`postgresql://postgres:postgres@localhost:54322/rh107_er2`), run `psql`
      with `\set VERBOSITY verbose` so each SQLSTATE is printed.
      First, `-tAc "SELECT jsonb_typeof('null'::jsonb) || '/' || ('null'::jsonb IS NULL)::text;"`
      prints `null/false`.
      **Then seed one valid row, because the `status` case below needs a row to
      update and because `requested_by` carries a foreign key.** `requested_by`
      is `NOT NULL REFERENCES profiles(id)` and `profiles.id` is in turn
      `REFERENCES "user"(id)`, so the seed is a three-step chain against the
      freshly migrated (and therefore empty) database — measured, all three
      INSERTs print `INSERT 0 1`:

      ```sql
      INSERT INTO "user" (id, name, email) VALUES ('11111111-1111-1111-1111-111111111111','QA','qa@example.com');
      INSERT INTO profiles (id, email) VALUES ('11111111-1111-1111-1111-111111111111','qa@example.com');
      INSERT INTO songs (id, title, artist) VALUES ('22222222-2222-2222-2222-222222222222','T','A');
      INSERT INTO catalog_suggestions (group_id, target_table, target_id, target_column, value, requested_by)
      VALUES ('33333333-3333-3333-3333-333333333333','songs','22222222-2222-2222-2222-222222222222','title','"New"'::jsonb,'11111111-1111-1111-1111-111111111111');
      ```

      With that row present, each of the following four statements must fail
      with SQLSTATE **23514** (measured, in exactly these forms, with the
      constraint names shown — the first three against
      `catalog_suggestions_check`, the fourth against
      `catalog_suggestions_status_check`): an INSERT copying the seed row but
      with `target_column = 'id'`; the same with `target_column = 'updated_at'`;
      the same with `target_table = 'albums'`; and
      `UPDATE catalog_suggestions SET status = 'closed';`.
      **Run each statement in its own `psql` invocation**, so one failure does
      not abort the others.
      *Why the seed is not optional:* measured against the empty table, that
      same `UPDATE` prints **`UPDATE 0` and raises nothing** — a row-level CHECK
      is not evaluated for an UPDATE matching no row — so without the seed this
      ER fails against a perfectly correct implementation. Measured with the
      seed present, it raises 23514. A fifth measurement confirms the FK is
      live: an INSERT naming a `requested_by` with no `profiles` row raises
      **23503** `violates foreign key constraint
      "catalog_suggestions_requested_by_fkey"`.
      **Drop the ER2 database last** —
      `psql "postgresql://postgres:postgres@localhost:54322/postgres" -c 'DROP DATABASE rh107_er2;'`
      must print `DROP DATABASE` — and show that output. ER2 and ER3 need it
      alive, so this is the only ER that drops it.
- [ ] **ER5 — the TS allowlist refuses an unknown `(table, column)` pair, in
      the function that interpolates the identifier.**
      `npx vitest run src/lib/__tests__/catalogSuggestionPayload.test.ts` exits
      0 reporting 0 failed and 0 skipped, and its output names a passing test
      `refuses a (target_table, target_column) pair outside the allowlist`
      which calls the exported
      `parseCatalogSuggestionValue(targetTable, targetColumn, value)` from
      `src/lib/catalogSuggestionPayload.ts` **directly, with no SQL**, once per
      case for `('songs', 'id')`, `('songs', 'created_at')`,
      `('songs', 'updated_at')`, `('albums', 'title')` and
      `('no_such_table', 'title')`, each rejecting with a message containing
      `is not an allowlisted catalog column` — **not** the "at least one of
      title, artist, …" message, which belongs to a payload proposing nothing
      and would be the wrong refusal. The same suite names a passing test
      `admits every column the submit payload can propose`, which reads the
      allowlisted column names **at runtime** from the exported constant —
      `Object.keys(CATALOG_SUGGESTION_COLUMNS.songs)`, imported from
      `src/lib/catalogSuggestionPayload.ts` — and calls
      `parseCatalogSuggestionValue('songs', c, v)` once per name with a valid
      sample value, getting no throw. The sample values live in a fixture map
      local to the test, and the test asserts that map's key set **equals**
      `Object.keys(CATALOG_SUGGESTION_COLUMNS.songs)`, so a column admitted to
      the allowlist without a fixture fails the suite instead of being silently
      skipped. **That equality assertion is vacuous on its own** — an empty
      `CATALOG_SUGGESTION_COLUMNS.songs` satisfies it against an empty fixture
      map while the admit loop runs zero times — so the same test must also
      assert that `Object.keys(CATALOG_SUGGESTION_COLUMNS.songs)` is
      **non-empty and contains at least `title`**, plus `links` unless RH-138
      has already removed it (see *Ordering against the links work*). With that
      clause the ER stands alone; without it, it leans on ER14's `tsc` and
      ER6's three-column submit to catch an empty allowlist.
      The names are read off the exported constant, never hardcoded and
      never copied from this spec — and **not** off the type:
      `CatalogSuggestionPayload` is a TypeScript interface and has no runtime
      keys to enumerate, which is why the constant exists (see *The allowlist is
      a runtime value*).
      *Positive control:* delete the allowlist check from
      `parseCatalogSuggestionValue` and the first test must fail; revert it.
- [ ] **ER6 — a multi-field correction becomes one row per field with one
      group, and the non-column keys are filtered rather than stored.**
      `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/catalogSuggestions.db.test.ts`
      exits 0 reporting 0 failed and **0 skipped** (this is the suite ER7–ER10,
      ER22 and ER23 call "the same suite"), and its output names a passing test
      `submits one suggestion row per proposed column, dropping non-column keys`,
      asserting that `submitCatalogSuggestion` called with **three allowlisted
      columns plus a `reason` plus one key that is not a `songs` column at all**
      (`{ nonsense: 1 }`) **resolves** rather than rejecting, and that it leaves
      exactly 3 rows sharing one `group_id`, each carrying the submitted
      `reason` text in the `reason` **column**. The filter is what makes this
      observable: without it the INSERT would name `target_column = 'reason'`
      and `'nonsense'`, the row-wise CHECK would raise `23514`, and the call
      would reject — so the assertion to write is `await expect(...).resolves`
      plus the row count, **not** `WHERE target_column = 'reason'` returning
      nothing, which the CHECK makes true whatever the filter does (ER4 already
      proves the CHECK).
- [ ] **ER7 — approving a group applies every field and flips exactly its own
      rows.** Same suite, passing test
      `approves a group: the catalog row carries every approved value and songs.updated_at advances`,
      asserting the `songs` row holds each proposed value, `updated_at >
      created_at`, and every row of the group is `approved` with `reviewed_by`
      set. **The bystander fixture is fixed, not free:** the approved group
      proposes `title` and `album`, and a second pending group for the **same
      song** proposes `standard_key` — a column the approved group does not
      touch — and that row must still be `pending`. Do **not** build the
      bystander proposing a column the approved group also proposes: supersession
      keys on `(target_table, target_id, target_column)` and is group-agnostic
      by design, so such a row is correctly left `superseded`. ER9 covers that
      case.
- [ ] **ER8 — a group approval is atomic over an invalid stored value.** Same
      suite, passing test
      `leaves the catalog and every row of the group untouched when one stored value is invalid`:
      with a group of two rows one of which holds
      `{"duration_seconds": "abc"}`-equivalent `value`, the approve rejects, the
      `songs` row is byte-identical to before (including `updated_at`), and
      **both** rows are still `pending`.
- [ ] **ER9 — approving closes the competitors and says so.** Same suite,
      passing test
      `supersedes the other pending suggestions for the same target column`:
      with exactly two pending `title` suggestions from different requesters in
      different groups for one song and **no other suggestion row for that
      song**, approving one leaves, counted over that song's rows, exactly 1
      `approved` and 1 `superseded` and **0** `pending`; the closed row's
      `status` is `superseded`, not `rejected`, and its `rejection_reason` is
      NULL.
- [ ] **ER10 — the queue is admin-only and rejection is recorded per field.**
      Same suite, passing tests
      `refuses to read the queue for a non-admin` (rejects with a message
      starting `Access denied`) and
      `rejects a group: records rejection_reason on every row and writes no catalog row`
      (the `songs` row's `updated_at` is unchanged).
- [ ] **ER11 — the queue table is reachable from exactly one production
      module.**
      `grep -rlF 'catalog_suggestions' src --include='*.ts' --include='*.tsx' | grep -v '__tests__' | sort | tr '\n' ' '`
      prints either exactly `src/lib/moderation.ts ` or exactly
      `src/lib/catalogSuggestionSql.ts src/lib/moderation.ts ` — nothing else.
      **One named SQL module is admitted on purpose**, because *Test criteria*
      below tells the implementer to extract the grouped projection's SQL and
      `src/lib/playlistSql.ts` / `src/lib/songLinksSql.ts` are the established
      pattern; a SQL helper necessarily carries the table literal, so a
      single-path form would make the recommended remedy fail this ER. The
      security intent is unaffected: an inert SQL-string module holds no
      authorisation decision, which is what "one production module" is
      protecting. If the extraction is taken, the module must be exactly
      `src/lib/catalogSuggestionSql.ts`, must contain no `'use server'`
      directive, must live under `src/lib` and not under `src/app/actions`, and
      must export only SQL strings and pure row-shaping functions — no function
      taking a caller-supplied `userId`. **The grep is textual, so this
      bans the literal in prose too, not only in SQL** — measured at `5d602f7`
      the same command against `global_song_edits` prints three non-test paths
      (`src/lib/catalogFields.ts src/lib/moderation.ts src/lib/songEditPayload.ts`),
      two of them from comments alone. So `src/types/database.ts`'s
      `CatalogSuggestion` doc comment, `catalogSuggestionPayload.ts`'s rewritten
      header and `catalogFields.ts`'s rewritten `:28` comment must say "the
      moderation queue" and not name the table. *Positive control:* append the
      literal `catalog_suggestions` inside a comment in
      `src/lib/playlistSql.ts`, re-run, and the command must now print that path
      too; revert it.
- [ ] **ER12 — the legacy table name is gone from the source tree.**
      `grep -roF 'global_song_edits' src | wc -l | tr -d '[:space:]'` prints
      `0`. (The literal survives only in the historical migration files
      `0006`, `0009`, `0011`, `0013`, `0014`, which are history and must not be
      edited; test helpers that need the legacy shape assemble the name, as
      `LEGACY_CATALOG_TABLE` already does at
      `src/lib/__tests__/test-helpers.ts:20`.) *Positive control:* add a line
      containing that literal to `src/lib/moderation.ts`, re-run, and the
      command must print a number greater than `0`; revert it.
      **The model's prose name escapes that grep** in both its spaced and its
      hyphenated form, and in both cases, so also:
      `grep -roiE 'global[ -]song[ -]edit' src --include='*.ts' --include='*.tsx' | grep -v '__tests__' | wc -l | tr -d '[:space:]'`
      prints `0`.
      **The `-i` is load-bearing and must not be dropped.** Measured in the
      working tree **before** this task, the case-sensitive form prints `10`
      and this case-insensitive form prints **12**. The two extra hits are
      capitalised and no other ER in this spec reaches them:
      `src/lib/moderation.ts:148`
      `throw new Error('Global song edit not found')` and
      `src/lib/moderation.ts:224` `err.message === 'Global song edit not
      found'`. Both must become `Catalog suggestion group not found` (ER23 pins
      that literal and that filter arm). The full pre-task twelve: one in
      `CorrectionModal.tsx:46`, one in `ModerationQueue.tsx:120`, the `PREFIX`
      at `songEditPayload.ts:29`, and nine in `src/lib/moderation.ts` (`:74`,
      `:75`, `:128`, `:129`, `:223`, `:229`, `:234`, plus the capitalised
      `:148` and `:224`). So the post-task requirement is **12 → 0**, the check
      is not vacuous, and that pre-task measurement is its own positive
      control. `__tests__` is excluded on purpose: the 0014 replay suites
      legitimately describe the legacy queue in prose.
- [ ] **ER13 — the conversion is executed, not argued.**
      `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/catalogSuggestionsMigration.db.test.ts`
      exits 0 reporting 0 failed and **0 skipped**, with passing tests covering,
      over legacy rows seeded in a throwaway schema: a 2-field row plus a
      `reason` yielding 2 rows with the reason in the `reason` column and
      `group_id` equal to the legacy row's `id`; a proposed `null` stored with
      `jsonb_typeof(value) = 'null'`; a `rejected` legacy row keeping its
      `status`, `reviewed_by` and `rejection_reason`; a legacy row with NULL
      `created_at`/`updated_at` landing with both NOT NULL and no `23502`; a
      `proposed_data` of `'[1,2]'::jsonb` skipped with no `22023`; a row whose
      only keys are non-columns producing 0 rows; and
      `{"duration_seconds":"abc"}` carried across verbatim. The suite resolves
      the migration by name **suffix** (`migrationSqlBySuffix`), and **no
      four-digit prefix is hardcoded anywhere in it** — the check must be
      prefix-agnostic, because this task's own prefix is not knowable from this
      spec: `migrations/` ends at `0018` at `5d602f7`, and RH-136 — which must land
      first — has already written `migrations/0019_song_links.sql` in this
      checkout (observed **staged**, `git status --porcelain` reports `AM`), so
      RH-107 lands at `0020` or later and a grep for
      `0019` would pass while suffix resolution was broken. Run instead:
      `grep -coE '[0-9]{4}_catalog_suggestions' src/lib/__tests__/catalogSuggestionsMigration.db.test.ts | tr -d '[:space:]'`
      prints `0`. (Measured: that form prints `0` against a file naming only the
      suffix, and `1` against a line containing
      `migrations/0020_catalog_suggestions.sql`. `grep -c` counts lines and
      exits 1 on no match, which the `tr` absorbs.)
- [ ] **ER14 — types compile and the old type is gone.** `npx tsc --noEmit`
      exits 0 with no output, and
      `grep -roF 'SongEdit' src --include='*.ts' --include='*.tsx' | wc -l | tr -d '[:space:]'`
      prints `0`. (Calibration only, and it drifts: `188` at `5d602f7`, `197`
      in the working tree while RH-136 is in flight — over exactly nine distinct
      identifiers either way. Do not compare against a literal; `0` is the
      assertion.) The new names are **named**, not left to taste, and each must
      exist **in the file the rename table assigns it**, as a whole identifier.
      A plain-substring grep cannot check either half of that: `grep -F` is
      satisfied by a longer sibling — measured, in a two-line file holding only
      `submitCatalogSuggestionAction` and `parseCatalogSuggestionValue`,
      `grep -cF 'CatalogSuggestion'` prints `2` and
      `grep -cF 'submitCatalogSuggestion'` prints `1`, though neither identifier
      is present — and `grep -rl` counts a hit anywhere under `src`. So each
      name is matched with non-identifier boundaries on both sides, in its own
      file, which also rules out a name being satisfied as the mere prefix of
      another listed name. Run exactly this (strip the leading indentation; the
      heredoc lines are read as `name path`):

      ```sh
      while read -r n f; do printf '%s %s %s\n' "$n" "$f" \
        "$(grep -oE "(^|[^A-Za-z0-9_])$n([^A-Za-z0-9_]|$)" "$f" 2>/dev/null | wc -l | tr -d '[:space:]')"; done <<'EOF'
      CatalogSuggestion src/types/database.ts
      CatalogSuggestionPayload src/lib/catalogSuggestionPayload.ts
      parseCatalogSuggestionPayload src/lib/catalogSuggestionPayload.ts
      parseCatalogSuggestionValue src/lib/catalogSuggestionPayload.ts
      CATALOG_SUGGESTION_COLUMNS src/lib/catalogSuggestionPayload.ts
      submitCatalogSuggestion src/lib/moderation.ts
      getPendingCatalogSuggestions src/lib/moderation.ts
      reviewCatalogSuggestionGroup src/lib/moderation.ts
      submitCatalogSuggestionAction src/app/actions/moderation.ts
      getPendingCatalogSuggestionsAction src/app/actions/moderation.ts
      reviewCatalogSuggestionGroupAction src/app/actions/moderation.ts
      EOF
      ```

      Every one of the **eleven** lines must end in a number greater than `0`.
      The eleventh is the runtime allowlist ER5 iterates;
      `PendingCatalogSuggestionGroup` is deliberately absent, because `tsc` and
      ER20 already force it.
      *Negative controls, both measured.* Against this repository as it stands
      — none of the new names written yet — the loop prints `0` on all eleven
      lines. Against a tree holding **only** the three Server Action names plus
      deliberately misnamed siblings (`submitCatalogSuggestionRow`,
      `getPendingCatalogSuggestionsList`, `reviewCatalogSuggestionGroupRows`,
      `parseCatalogSuggestionPayloadX`, `parseSuggestionValue`, and no bare
      `CatalogSuggestion` type) it prints `0` on eight of the eleven lines and
      `1` only on the three names genuinely present — while the `grep -rlF`
      form this replaces printed a number greater than `0` on nine of its ten
      lines in that same tree.
      *Positive control:* add `// SongEdit` to `src/types/database.ts`, re-run
      the first grep, and it must print a number greater than `0`; revert it.
- [ ] **ER15 — the catalog-writer guard is untouched and still passes.**
      `npx vitest run src/lib/__tests__/catalogTimestampGuard.test.ts` exits 0
      with 0 failed and 0 skipped, and
      `grep -oF 'EXPECTED_CATALOG_WRITERS = 4' src/lib/__tests__/catalogTimestampGuard.test.ts | wc -l | tr -d '[:space:]'`
      prints `1`. *Positive control:* change the `4` to `5` and the vitest run
      must fail; revert it.
- [ ] **ER16 — no transaction-control literal and no new complexity override.**
      `npx vitest run src/lib/__tests__/transactionGuard.test.ts src/lib/__tests__/complexityBudget.test.ts`
      exits 0 with 0 failed and 0 skipped;
      `grep -oF 'complexity-budget/override' eslint.config.mjs | wc -l | tr -d '[:space:]'`
      prints a number **not greater than 14**, and
      `grep -oF 'src/lib/moderation.ts' eslint.config.mjs | wc -l | tr -d '[:space:]'`
      prints `0` (measured `0` at `5d602f7`: the file has no override today).
      **The base commit is pinned explicitly, and `git merge-base` must not be
      used here:** this repo commits directly on `master`, so
      `git rev-parse HEAD` and `git merge-base HEAD master` print the same SHA
      (measured, both `5d602f780c0bcfad0af780a80ef67d4055eb77c6`) — after the
      implementer commits, the "base" would be their own commit and any grown
      list would pass. The floor is derived once, from a fixed commit:
      `git show 04a399a:eslint.config.mjs | grep -oF 'complexity-budget/override' | wc -l | tr -d '[:space:]'`
      prints `14` (measured; `grep -coF` on the working tree also prints `14`).
      **The enforced direction is shrink-only**: the list may lose entries and
      may never gain one, and `complexityBudget.test.ts` clause (e) (`:19-21`)
      requires each surviving ceiling to **equal** its file's current worst
      number — so if a sibling task simplifies a file that still has an
      override, that ceiling must be *lowered*, not left where it was. A grown
      list and a stale ceiling are both failures of this ER.
- [ ] **ER17 — lint is clean, measured unwrapped.**
      `/bin/zsh -f -c 'cd /Users/heitor/workspace/repertoire_hero && /usr/bin/env npm run lint'`
      exits 0 and prints no `error`/`warning` line. Run exactly that form: an
      output-filtering wrapper masks the exit code.
- [ ] **ER18 — the full non-DB suite and the coverage gate pass.**
      `npm run test:coverage` exits 0, its summary reports 0 failed, and its
      output contains no line matching `does not meet global threshold`
      (a threshold breach is reported as an exit code, not a failed test).
      Do not pin the skipped count: every `*.db.test.ts` suite skips here, and
      `src/lib/__tests__/pwaShell.test.ts` skips 1 or 3 depending on whether the
      gitignored `public/sw.js` exists.
- [ ] **ER19 — every database-backed suite in the repo still passes together,
      with none skipped.**
      `RUN_DB_TESTS=1 npx vitest run $(ls src/lib/__tests__/*.db.test.ts src/app/actions/__tests__/*.db.test.ts)`
      exits 0 reporting 0 failed and **0 skipped**, and the number of files it
      reports equals the number printed by
      `ls src/lib/__tests__/*.db.test.ts src/app/actions/__tests__/*.db.test.ts | wc -l | tr -d '[:space:]'`
      **re-run at the implementing HEAD**. Derive that number, do not pin it:
      the repo grows. For calibration only, `git ls-tree -r --name-only
      04a399a | grep -cE '\.db\.test\.ts$'` prints `23` and the same command at
      `5d602f7` prints `24` (RH-135 added one); RH-136 adds **three** of its own
      in this working tree (`songLinksBridge.db.test.ts`,
      `songLinksMigration.db.test.ts`, `songLinksTable.db.test.ts`), which is
      why the `ls` above prints **27** today against the tracked 24; and this
      task adds two more. No literal is correct for long, which is why this ER
      derives the number instead of pinning it.
      **Why an exported `DATABASE_URL` does not reach the suites:**
      `vitest.config.ts:22`, inside `loadEnv`, does
      `process.env[key] = val` **unconditionally** for every key the
      `.env.local` file names, and `.env.local` here does name `DATABASE_URL`
      (measured: `grep -c '^DATABASE_URL' .env.local` prints `1`), so the file's
      value wins over the environment. The later assignment at
      `vitest.config.ts:35-36` is **conditional** (`if (!process.env.DATABASE_URL)`)
      and is only the no-`.env.local` fallback. Either way the port must be
      54322 and that database must be migrated.
- [ ] **ER20 — the admin queue still renders a multi-field correction as one
      card.**
      `npx vitest run src/components/admin/__tests__/ModerationQueue.test.tsx src/components/songs/__tests__/CorrectionModal.test.tsx`
      exits 0 with 0 failed and 0 skipped, and the `ModerationQueue` output
      names a passing test asserting that a correction proposing two columns
      renders **one** card showing both field diffs and that approving it calls
      the injected review action once with that card's group id.
- [ ] **ER21 — the version is bumped.** `node -p "require('./package.json').version"`
      matches `^[0-9]+\.[0-9]+\.[0-9]+-[0-9]{12}$` and is strictly greater than
      every version reachable in history — derive the floor, do not pin it:
      `git log -p --all -- package.json | grep -oE '"version": "[^"]+"' | sort -u`.
- [ ] **ER22 — approving a group whose only column is `links` writes
      `song_links` and still advances `songs.updated_at`.** Same suite as ER6,
      passing test
      `approves a links-only group: song_links carries the replace-set and songs.updated_at advances`:
      for a song whose links are `[uA, uB, uC]`, seed exactly one pending row
      with `target_column = 'links'` and `value` `[uC, uA]`, read
      `songs.updated_at` **before** approving, approve the group, then assert
      (a) that song's `song_links` rows are exactly `uC` then `uA` in canonical
      read order, (b) `songs.updated_at` is **strictly greater** than the value
      read before, and (c) the suggestion row is `approved`. Both wrong readings
      of the apply pass every other ER in this spec — writing `songs.links` for
      that row (which RH-136's bridge trigger then dual-writes) and issuing no
      `UPDATE songs` for the group (which leaves the timestamp where it was) are
      both invisible to ER7, whose fixture is `title` + `album`, and to
      `src/lib/__tests__/catalogTimestamp.db.test.ts`, which covers
      `applySongLinkUpdate` and not an approval. *Positive control:* make the
      apply skip the `UPDATE songs` statement when the clause list is empty and
      assertion (b) must fail; revert it.
- [ ] **ER23 — one error prefix, and every arm of the catch filter matches the
      new vocabulary.** Three legacy messages are involved, not one: the
      validation prefix, the not-found message and the already-reviewed
      message. All three are thrown by `reviewCatalogSuggestionGroup` and all
      three must propagate verbatim rather than wrapped.
      **Textually**, five checks:
      (a) `grep -oF 'Invalid catalog suggestion' src/lib/catalogSuggestionPayload.ts | wc -l | tr -d '[:space:]'`
      prints `1` (the single `PREFIX` constant).
      (b) `grep -oE "startsWith\((CATALOG_SUGGESTION_PREFIX|'Invalid catalog suggestion')\)" src/lib/moderation.ts | wc -l | tr -d '[:space:]'`
      prints `1`. **Either form is accepted on purpose** — the inline literal
      or an imported `CATALOG_SUGGESTION_PREFIX` constant, which is the better
      code since it removes the duplicated string. Measured: that alternation
      prints `1` against `startsWith('Invalid catalog suggestion')`, `1`
      against `startsWith(CATALOG_SUGGESTION_PREFIX)`, and `0` against both
      `startsWith('Invalid global song edit')` and an unrelated constant.
      (c) `grep -roF 'Invalid global song edit' src | wc -l | tr -d '[:space:]'`
      prints `0` (measured `17` in the working tree before the task, across the
      payload module, `src/lib/moderation.ts` and three test files, so the
      check is not vacuous).
      (d) `grep -roF 'Global song edit not found' src | wc -l | tr -d '[:space:]'`
      prints `0`, and
      `grep -roF 'Catalog suggestion group not found' src | wc -l | tr -d '[:space:]'`
      prints a number **greater than 0**. (Measured before the task: the first
      prints `3` — `src/lib/moderation.ts:148` where it is thrown,
      `src/lib/moderation.ts:224` where the catch filter compares against it,
      and `src/lib/__tests__/moderation.test.ts:165` — and the second prints
      `0`. `src/lib/moderation.ts:148`/`:224` are **capitalised**, so a
      case-sensitive prose grep misses them; ER12's grep is `grep -roiE` for
      this reason.) The threshold is "greater than 0" rather than an exact count
      because extracting the literal into a shared constant is permitted.
      **Behaviourally**, the ER6 suite
      (`RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/catalogSuggestions.db.test.ts`,
      0 failed and 0 skipped) names **two** passing tests:
      `propagates a validation refusal verbatim instead of wrapping it` — with
      ER8's fixture, the rejected approval's message **starts with**
      `Invalid catalog suggestion` and does **not** start with `Failed to`; and
      `propagates a not-found group verbatim instead of wrapping it` — calling
      `reviewCatalogSuggestionGroup` as a system admin with a `group_id` that
      matches no row rejects with a message **exactly equal** to
      `Catalog suggestion group not found`, and therefore not starting with
      `Failed to`. That second test is what makes changing only one of the two
      not-found sites a failure: leave `:148` alone and the message is the
      legacy literal; change `:148` but not the `:224` filter arm and the
      message comes back as
      `Failed to review a catalog suggestion group: Catalog suggestion group not found`.
      (e) `grep -roF 'Edit request is already reviewed' src | wc -l | tr -d '[:space:]'`
      prints `0` (measured `2` before the task — `src/lib/moderation.ts:176`
      where it is thrown and `:250` where the filter compares against it), and
      `grep -roF 'Catalog suggestion group is already reviewed' src | wc -l | tr -d '[:space:]'`
      prints a number **greater than 0**.
      A **third** behavioural test in the same suite,
      `propagates an already-reviewed group verbatim instead of wrapping it`,
      approves a group twice as a system admin and asserts the second call
      rejects with a message **exactly equal** to
      `Catalog suggestion group is already reviewed`. That test is also what
      proves the review path reads the group **without** a status filter: a
      `pending`-only read answers `Catalog suggestion group not found` instead,
      and the equality fails.
      *Positive controls, run one at a time and reverted:* remove the
      `Invalid catalog suggestion` arm from the catch filter and the first test
      must fail; remove the `Catalog suggestion group not found` arm and the
      second must fail; remove the already-reviewed arm and the third must
      fail.

## Out of Scope

Listed above under *Scope*. Restated as the three follow-ups this task
deliberately enables without doing:

1. The two-level grouped review screen with value collapse and counts
   (`docs/use-cases.md:704-718`) — needs a mockup; not filed yet.
2. RH-111, telling the requester what happened per field, including the offer to
   keep a refused value as a personal override.
3. RH-138, per-link-row corrections, and the widening of the allowlist to
   `albums`, `song_versions` and `song_links` when a surface submits them.
