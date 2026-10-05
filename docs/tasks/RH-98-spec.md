# RH-97 — Stop discarding song edits silently

> Board id RH-97; spec filename follows the project's board-id-plus-one convention.
> Source decisions: `docs/plans/repertoire-rework.md` § *Stop discarding song edits
> silently*, `docs/use-cases.md` § *Suggest a correction to the catalog*,
> `docs/reviews/feature-review.md` § 1 (F1.2, F1.3).

## Scope

An edit a musician makes to a shared catalog field must never be accepted by the
form and then thrown away by the database. Today `updateSong` writes all seven
mutable `global_songs` columns as `CASE WHEN <empty> THEN $n ELSE <current> END`,
so a corrected artist saves "successfully" and snaps back, and `links` — empty
only when exactly `[]` — can never gain a second entry through this path. The
in-code comment claims the correction mechanism is "not yet built" while
`CorrectionModal` is sitting in the same component tree, unreachable from any
refused edit.

This task covers the song edit path only: `updateSong`, the edit mode of
`SongForm`, and `CorrectionModal` as the destination of a shared-field change.

It runs on the current schema — `global_songs` as it is today, `global_song_edits`
as the queue, `parseGlobalSongEditPayload` as the validator. The restructure into
`songs`/`albums`/`song_versions` (RH-105) and the replacement of the queue with
`catalog_suggestions` (RH-107) are not pulled in, and neither is the reply loop
F1.4 describes.

## Approach

### The shape chosen, and why

The work item allows two shapes: mark the shared fields read-only and offer the
correction path in place, or report what was dropped. **This spec implements the
first as the primary behaviour and the second as a backstop**, which is what
`docs/use-cases.md` points at: *nothing global is written directly; a change to a
shared value is a suggestion*.

Read-only is primary because it removes the defect structurally rather than
narrating it. A refusal that cannot be triggered needs no message. But a form is
rendered from a snapshot taken when it opened, so a shared value can become
populated between open and save; that race is the one case the read-only shape
cannot close, and it is exactly where the reporting shape earns its place.

One carve-out, and it is the point of the design: **a shared field that is
currently empty stays directly editable.** Filling a blank in a wiki adds
information and overwrites nobody, and it is the one shared write today's SQL
already accepts. The result is that the form becomes a truthful rendering of what
the database will take, instead of hiding that rule inside a `CASE WHEN`.

`standard_key` is deliberately exempt from refusal reporting. The form's key input
writes `repertoire.personal_key`, which always succeeds; the catalog key is a
separate, read-only value beside it. Reporting a "refused" catalog key for an edit
that was in fact saved personally would be a false alarm.

### Behavior

**`updateSong` stops guessing in SQL and reports.** Inside the existing
`withTransaction`, read the catalog row `FOR UPDATE`, compare the proposed values
against it, and build the `UPDATE global_songs` SET list from only the columns that
are currently empty. Return `{ refused }` instead of `void`: one entry per column
that is populated and whose proposed value differs from the stored one, carrying
the column name, the current value and the proposed value. Equal values are never
refusals — comparison is on trimmed strings, integer duration, and the ordered
`{label,url}` list for `links`. Emptiness keeps today's definition per column
(`NULL`/`''` for text, `NULL` for `duration_seconds`, `NULL`/`[]` for `links`).
Six columns can be refused: `title`, `artist`, `album`, `cover_url`,
`duration_seconds`, `links`. `standard_key` remains fill-when-empty and is never
refused. The owner-local write (`status`, `tags`, `personal_key`) is unchanged and
stays in the same transaction, so atomicity is preserved. The stale comment goes;
its replacement names `CorrectionModal` and points at
`docs/use-cases.md` § *Suggest a correction to the catalog*.

**`SongForm` edit mode no longer offers a direct edit of a populated shared
field.** Each such field renders its catalog value read-only with a visible
"Suggest a correction" control; each shared field the catalog has left empty stays
an editable input. The links fieldset follows the rule as a unit, matching the
database's all-or-nothing guard. Owner-local fields — status, tags, and the key
input, which is personal — are always editable. Create mode is untouched: there is
no catalog row to protect yet.

**"Suggest a correction" opens `CorrectionModal`**, pre-filled from the current
catalog values and scrolled/focused to the field that was clicked. The modal grows
the three shared fields it lacks — `cover_url`, `duration_seconds`, `links` — so
every value the form shows read-only has a route, and it submits **only the fields
the user actually changed**, plus `reason`. Submission is blocked with an inline
message when nothing changed, since `parseGlobalSongEditPayload` requires at least
one known column. Payload keys stay exactly the `global_songs` column names the
parser accepts; the parser itself does not change. Sending only changed fields also
anticipates RH-107's one-row-per-field queue without implementing it.

**The backstop.** When a save returns a non-empty `refused`, the form does not
report plain success. It renders an alert naming each refused column with its
current and proposed value, states that the owner-local part was saved, and offers
one control that opens `CorrectionModal` pre-filled with those proposed values.

### Files touched

- `src/lib/catalogFields.ts` *(new)* — pure comparison: the shared-column list,
  the per-column emptiness test, and the function splitting a proposed update into
  the columns to fill and the refusals. No DB access, so it is unit-testable
  without Postgres and costs `src/lib/songs.ts` only one import line.
- `src/types/database.ts` — `RefusedCatalogField` and the `updateSong` result type.
  Public vocabulary: it crosses a Server Action boundary into a component, so it
  does not belong in `src/lib/dbRows.ts`.
- `src/lib/songs.ts` — `updateSong`: the `FOR UPDATE` read, the built SET list, the
  new return value, the replaced comment. The `FOR UPDATE` projection is typed as
  the existing `GlobalSong` domain type, so no new `dbRows.ts` interface is added.
- `src/app/actions/repertoire.ts` — `updateSongAction`'s return type widens; it
  already returns the delegate's value, so no body change beyond the signature.
- `src/components/songs/SongLinksEditor.tsx` *(new)* — the link rows editor,
  extracted from `SongForm` and reused by `CorrectionModal`. Extraction, not a
  copy: `jscpd` runs at `minTokens: 50` / `minLines: 8` and a duplicated editor
  would trip it.
- `src/components/songs/SharedCatalogField.tsx` *(new)* — one populated shared
  value rendered read-only with its "Suggest a correction" control.
- `src/components/songs/CorrectionModal.tsx` — the three added fields, the
  changed-fields-only payload, the blocked empty submit, the focus target prop.
- `src/components/songs/SongForm.tsx` — read-only rendering of populated shared
  fields, the refusal alert, wiring the modal pre-fill. Shrinks through the two
  extractions.
- `eslint.config.mjs` — the two complexity-budget overrides touched below.
- Tests listed under **Test criteria**.

**No migration.** Nothing about this task needs a schema change: the queue table,
the catalog columns and the payload validator all already exist. If an
implementation nonetheless finds it needs one, note that two other approved specs
already claim `0009` (RH-95) and `0010` (RH-96) while `migrations/` still ends at
`0008_sync_profile_email.sql` — re-read the directory and the two specs rather than
trusting any number literal in this document.

### The ratchet is a hard constraint here

Both primary files sit **exactly at** their pinned ceiling:
`src/lib/songs.ts` at `max-lines: 473`, `src/components/songs/SongForm.tsx` at
`max-lines: 612` / `max-lines-per-function: 459` / `complexity: 17`. The override
list in `eslint.config.mjs` may only shrink, and
`src/lib/__tests__/complexityBudget.test.ts` fails when an override is not exactly
the file's current worst number. So neither file may grow by a line, no new entry
may be added for the new files, and every extraction above must be followed by
lowering the corresponding override to the new exact number. This is why the new
logic lands in new modules rather than in the two files being fixed.

## Expected Results

- [ ] ER1 — A populated shared field is never overwritten and the refusal is
  returned: for a catalog row with a non-empty `artist`, `updateSong` with a
  different artist leaves `global_songs.artist` unchanged and returns `refused`
  containing exactly one entry naming `artist` with its current and proposed
  value. A DB-backed test under `src/lib/__tests__/` asserts both halves.
- [ ] ER2 — Fill-when-empty is preserved: for a row with `album IS NULL`, the same
  call writes the proposed album and returns an empty `refused`.
- [ ] ER3 — No false refusals: a call whose shared values equal the stored ones
  (after trimming, and by ordered `{label,url}` comparison for `links`) returns an
  empty `refused`, and `status`, `tags` and `personal_key` are written.
- [ ] ER4 — `links` is no longer all-or-nothing in its failure mode: a row holding
  one link, given two, leaves `links` unchanged and reports a `links` refusal; a
  row holding `[]` receives both links with no refusal.
- [ ] ER5 — `standard_key` is never reported refused: given a populated
  `standard_key` and a different key, `global_songs.standard_key` is unchanged,
  `repertoire.personal_key` holds the new value, and `refused` is empty.
- [ ] ER6 — In `SongForm` edit mode, every shared field the catalog has populated
  renders read-only — no enabled input bound to it — and carries a "Suggest a
  correction" control, while every shared field the catalog leaves empty renders an
  editable input. A component test asserts both cases on one song.
- [ ] ER7 — Activating "Suggest a correction" opens `CorrectionModal` pre-filled
  with the current catalog values; submitting after changing one field sends a
  payload containing only that field plus `reason`, and submitting with nothing
  changed is blocked with a visible message and makes no call.
- [ ] ER8 — `CorrectionModal` offers `cover_url`, `duration_seconds` and `links`
  in addition to title, artist, album and standard key, and a test feeds its
  emitted payload to the unmodified `parseGlobalSongEditPayload`, which accepts it.
- [ ] ER9 — A non-empty `refused` is never reported as plain success:
  `SongForm` renders a `role="alert"` notice naming each refused column with its
  current and proposed value, says the owner's own changes were saved, and exposes
  a control that opens `CorrectionModal` pre-filled with those proposed values.
- [ ] ER10 — The stale claim is gone: `src/lib/songs.ts` contains no occurrence of
  "not yet built", and its replacement comment names `CorrectionModal`.
- [ ] ER11 — The complexity ratchet holds:
  `src/lib/__tests__/complexityBudget.test.ts` passes; the overrides for
  `src/lib/songs.ts` and `src/components/songs/SongForm.tsx` are each at most their
  pre-task numbers (473; 612/459/17) and exactly the files' new worst numbers; the
  override list has gained no entry and none of the new files appears in it.
- [ ] ER12 — `npm run test:coverage`, `npm run lint`, `npm run lint:dead` and
  `npm run lint:dup` all pass.

## Test criteria

- DB-backed, in the existing `src/lib/__tests__` style gated on `RUN_DB_TESTS`:
  ER1–ER5 against a real `global_songs` + `repertoire` pair.
- Pure unit tests for `src/lib/catalogFields.ts`: emptiness per column type, the
  equality rules (trim, integer, ordered link list), and the fill/refuse split.
- Component tests (`src/components/songs/__tests__/`): ER6, ER7, ER9 in
  `SongForm.test.tsx`; ER8 in `CorrectionModal.test.tsx`, feeding the emitted
  payload through the real parser rather than a stub.
- Grep assertion for ER10 may live in the existing `SongForm`/`songs` test files or
  a naming/convention test; a comment is not worth a new test file.

## Open Question for the Operator

How the read-only shared fields should look. Rendered side by side in
`docs/tasks/RH-98-mock.html` § *Read-only shared fields*. The spec currently picks
**A** because it reads as a fact about the catalog rather than a box someone forgot
to enable. One letter is enough.

## Out of Scope

- F1.1 (deduplication ignores the artist), F1.5 (search cannot use its indexes),
  F1.6 (`/songs/search` stub), F1.7 (`global_songs` has no `updated_at`).
- F1.4 — the queue still never tells the requester what happened. The suggestion
  now reaches the queue; the reply loop is separate work.
- RH-105's restructure and RH-107's `catalog_suggestions`. In particular, this
  task keeps one queue row per submission; one row per field arrives with RH-107.
- The admin moderation screen and `parseGlobalSongEditPayload` are unchanged.
- The Spotify import path, which writes the catalog through
  `createAndAddSong`, not `updateSong`.
