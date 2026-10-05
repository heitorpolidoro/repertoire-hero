# RH-96 — Drop the band status trigger and author band status directly

Spec file name follows the repository convention (board id + 1):
`docs/tasks/RH-97-spec.md` for board task **RH-96**. Verified against
`docs/tasks/RH-96-spec.md`, whose first line is `# RH-95 — Unify the two song
deduplication rules`.

Sources: `docs/plans/repertoire-rework.md` (§Work items → *Drop the band status
trigger*), `docs/use-cases.md` (*Set a song's status*, *Writing a band's rows*),
`docs/reviews/feature-review.md` (§2, F2.1 and F2.2).

Mockup: `docs/tasks/RH-97-mock.html` (the dashboard row's three badge states,
the band-mode banner before and after, and the landing f3 card in both
languages). It pairs with this spec file, matching `RH-94-spec.md` /
`RH-94-mock.html`.

## Scope

Status becomes per-owner with nothing aggregating. One deliverable, five parts
that cannot ship apart without leaving the app in a worse state than today
(trigger gone but band status frozen, or band status editable while the trigger
overwrites it):

1. **The trigger and its function are deleted** by a new migration. Existing
   band rows keep whatever the trigger last wrote — a starting value, not a
   migration problem.
2. **The RH-83 seed is removed.** `addSongToRepertoire`'s
   `seedStatusFromBandId` parameter, the `COALESCE((SELECT b.status ...))` it
   drives, the `seedStatusFromBandId` argument on `addSongAction` and the
   `assertBandMember` check guarding it, and the parameter on the two hook
   action contracts that pass it. Personal rows are born `unknown` again, by
   the column default.
3. **A band's status is authored by a band admin.** `assertBandAdmin` becomes
   exported from `src/lib/bands.ts`, and the two Server Actions that write a
   `repertoire` row's `status` authorize through it when the owner is a band.
4. **The dashboard's band badge becomes the control the personal one is**, for
   a band admin. For a non-admin member it stays read-only, with a caption that
   states the real reason. Resolving the caller's role in the active band needs
   a new read action, because the dashboard is a client island whose band comes
   from `localStorage` and the server page cannot know it.
5. **Every surface that advertises or explains the deleted rule is rewritten**
   — the landing copy in both dictionaries, two in-app captions, and the four
   prose claims in `AGENTS.md` / `spec.md`.

### Explicitly not covered

- **The four-note status control (RH-102).** This task makes the band badge
  editable and admin-gated; it reuses the existing cycling button verbatim.
  What the control looks like, that it stops wrapping past `mastered`, and that
  it replaces Fast View's dropdown, all belong there.
- **A visual admin gate on Fast View's `StatusDropdown`.** The server gate
  refuses a non-admin's band write and `useSongStatus`'s existing Toast reports
  it ("Failed to update status"). Wiring an `isBandAdmin` prop through a
  dropdown RH-102 deletes would be built to be thrown away. Accepted and named,
  not overlooked.
- **A visual admin gate on `PlaylistSongRow`.** That row already renders a band
  playlist's badge read-only for everyone and never calls the write, so there
  is nothing to gate — only its caption is wrong. Making it editable is RH-71's
  named follow-up.
- **Backfilling or clearing the band statuses the trigger wrote.** Decided
  against in the plan.
- **Band tags, lyrics, key and membership.** `updateSongTagsAction`,
  `updateLyricsAction`, `addSongAction` and `removeSongAction` stay at member
  level.

## Approach

### Behavior

**The database no longer aggregates.** After the new migration, no trigger
fires on a `repertoire` status update and no
`sync_band_repertoire_on_member_update` function exists. A member changing
their personal status for a song leaves every band row for that song untouched.
`migrations/0001_initial_schema.sql` is **not** edited — it is applied history;
a fresh database applies 0001 and then the drop, and ends in the same state as
a migrated one.

**Where the two identifiers are still allowed to appear.** `migrations/` is
excluded from the removal rule by construction: 0001 creates both objects and
the new migration must name both to drop them (`DROP TRIGGER IF EXISTS
trg_sync_band_repertoire ...`, `DROP FUNCTION IF EXISTS
sync_band_repertoire_on_member_update`). `docs/` is likewise excluded — the
plan, the use cases and this spec describe the rule being deleted. The removal
rule therefore applies to **runtime code and prose only**: `src/` and `e2e/`
must not mention either identifier (today only the RH-83 doc comment in
`src/lib/songs.ts:73` does), and `AGENTS.md` / `spec.md` must not describe the
aggregate behaviour. ER3 is scoped to exactly that, so a correct
implementation's own drop migration cannot fail it.

**Migration numbering.** The new file takes **the next number after the highest
prefix present in `migrations/` at implementation time** — `0009` is the highest
on disk today, so the expected name is
`migrations/0010_drop_band_status_trigger.sql`. A number is never skipped:
`src/lib/__tests__/migrationsSingleSource.test.ts` (the RH-17 guardrail) requires
the four-digit prefixes to be unique **and contiguous** from `0001`, and
`findNumberingViolations` fails the suite on any gap. Several approved specs were
each written expecting `0009`; whichever lands second takes the next free number
at that point and renumbers its own file. That hazard is prose only, deliberately: it
depends on the state of other unmerged branches, which no QA agent can judge.

**A new personal row is born `unknown`.** Writing a lyrics note or uploading a
tab for a song the user does not have creates their row at the column default,
in band context exactly as in personal context. The seed existed only to avoid
being the new floor of a `MIN` that no longer runs.

**Writing a band row's status requires band admin.** `updateSongStatusAction`
and `updateSongAction`, when the owner resolves to a band, throw
`Access denied: band admin required` for a member and succeed for an admin.
Both are gated because both write `repertoire.status`: `updateSong`'s second
statement sets `status`, `tags` and `personal_key` unconditionally, so gating
only the first action would leave band status writable by any member through
the song edit modal. The accepted consequence: a non-admin member can no longer
edit a *band* row through that modal at all, including its tags and key — the
inline tag editor (`updateSongTagsAction`) is unchanged and remains their path.
Personal rows are unaffected in both actions.

**The dashboard badge.** In band context the badge is the same cycling button
the personal context renders when the caller is an admin of that band, and the
existing read-only `<span>` otherwise. The role is resolved once per band
context by a new `getBandRoleAction(bandId)` — `getRequiredUserId` plus the
`assertBandMember` that already returns the role — injected into
`RepertoireDashboardActions` by `src/app/page.tsx` like the other seven
actions (F21). Until it resolves, and in the pre-hydration personal render, the
badge is read-only: the gate fails closed on the client exactly as it does on
the server.

**Copy.** `landing.f3Desc` in both dictionaries sells a band repertoire with
its own key, lyrics and readiness, authored rather than derived, and mentions
no weakest-link / "menor nível" rule. The dashboard's and `PlaylistSongRow`'s
`title="Band status is computed from all members"` becomes a statement about
authorship by a band admin. `AppLayout`'s band-mode banner drops its
`— Status is read-only, computed from all members` clause outright: the banner
cannot know the role, so any claim it makes is wrong for half its readers.

### Files touched

- `migrations/0010_drop_band_status_trigger.sql` — new (the next number after the
  highest in `migrations/`; see §Approach → *Migration numbering*).
  `DROP TRIGGER IF EXISTS` on `repertoire`,
  then `DROP FUNCTION IF EXISTS` for the function, with a comment naming this
  task and the decision.
- `src/lib/songs.ts` — `addSongToRepertoire` loses its third parameter, the
  `COALESCE` subselect and the RH-83 doc comment; the `VALUES` list drops the
  status column so the default applies.
- `src/lib/bands.ts` — `assertBandAdmin` gains `export`.
- `src/app/actions/repertoire.ts` — `addSongAction` loses
  `seedStatusFromBandId` and its `assertBandMember` guard; a band-admin owner
  resolution is added beside `resolveOwner` and used by `updateSongStatusAction`
  and `updateSongAction`.
- `src/app/actions/bands.ts` — new `getBandRoleAction`.
- `src/app/page.tsx` — adds `getBandRole` to the injected dashboard bundle.
- `src/components/songs/RepertoireDashboard.tsx` — the band branch of the status
  badge; the role read and its state; the new caption.
- `src/app/fastViewLyricsActions.ts`, `src/app/fastViewTabActions.ts`,
  `src/app/songPickerActions.ts` — the `seedFromBandId` argument disappears from
  the three `addSong` adapters.
- `src/hooks/useLyricsEditor.ts`, `src/hooks/useTabLibrary.ts` — the `addSong`
  contract loses its second parameter, and the call sites lose the band id they
  passed.
- `src/components/playlists/PlaylistSongRow.tsx` — caption only.
- `src/components/layout/AppLayout.tsx` — the banner clause is removed.
- `src/i18n/dictionaries/en.json`, `src/i18n/dictionaries/pt-BR.json` —
  `landing.f3Desc`.
- `AGENTS.md` (the band-ownership bullet, the Bands capability line, the "Band
  aggregate status" domain concept) and `spec.md` (the Aggregate Progress line)
  — the claims become the per-owner rule.
- `package.json` — version bump per the repository rule.
- Tests: `src/lib/__tests__/songs.test.ts` (the RH-83 seed test is deleted; the
  born-`unknown` assertion stays), `src/app/actions/__tests__/repertoire.test.ts`
  (the `addSongAction status seeding (RH-83 ER16)` describe block is deleted; the
  admin gate is asserted), `src/app/actions/__tests__/authzRepertoire.db.test.ts`
  (a non-admin member case for the two gated actions; the existing non-member
  matrix still passes), `src/lib/__tests__/landingCopy.test.ts` (f3 copy),
  `src/components/songs/__tests__/repertoireDashboard.test.tsx` (the three badge
  states), `src/components/playlists/__tests__/PlaylistDetailView.test.tsx`
  (the caption string in the RH-71 ER9 test).

### Test criteria

- A DB-backed test proves the trigger is gone **behaviourally**, not by reading
  `pg_trigger`: a band row at `mastered`, a member's personal row moved to
  `learning`, and the band row still `mastered` afterwards.
- A DB-backed test proves a new personal row created in band context is
  `unknown` even when the band row is `polishing`.
- Action-level tests prove the gate in both directions for both gated actions,
  and prove a refused call wrote nothing.
- A jsdom test on `RepertoireDashboard` proves the three badge states by their
  accessible names and titles: admin in band context renders
  `Status: <label>. Click to advance.`; member in band context renders the
  read-only caption and no such button; personal context is unchanged.
- `landingCopy.test.ts` proves both dictionaries' `f3Desc` describe an authored
  band repertoire and that neither mentions the deleted rule.
- `npm run test:coverage` stays above its four thresholds, and
  `npm run lint:dead` stays green — `knip` fails on the now-unused
  `seedStatusFromBandId` plumbing if any of it is left behind.

## Expected Results

- [ ] ER1 — A new migration `migrations/<nnnn>_drop_band_status_trigger.sql`
      exists, numbered one above the highest prefix otherwise present in
      `migrations/` with no gap in the sequence (expected
      `0010_drop_band_status_trigger.sql`), and drops both the trigger and the
      function; `migrations/0001_initial_schema.sql` is unchanged, and
      `src/lib/__tests__/migrationsSingleSource.test.ts` passes.
- [ ] ER2 — After `npm run db:migrate`, a member's personal status change leaves
      every band row for that song untouched, asserted by a `*.db.test.ts`.
- [ ] ER3 — Neither `sync_band_repertoire_on_member_update` nor
      `trg_sync_band_repertoire` appears anywhere under `src/` or `e2e/`
      (the RH-83 doc comment in `src/lib/songs.ts` is gone). `migrations/` and
      `docs/` are excluded by design: 0001 creates both objects and the new drop
      migration must name both to drop them.
- [ ] ER4 — `seedStatusFromBandId` appears nowhere under `src/`, and a personal
      row created in band context is born `unknown`.
- [ ] ER5 — A band member who is not an admin is refused on
      `updateSongStatusAction` and `updateSongAction` for a band row, with
      `Access denied: band admin required` and no row written; an admin
      succeeds; personal writes are unaffected.
- [ ] ER6 — `assertBandAdmin` is exported from `src/lib/bands.ts` and is the
      only admin check the two actions use.
- [ ] ER7 — `getBandRoleAction` exists in `src/app/actions/bands.ts`, resolves
      the session itself, and is reached by the dashboard only through the
      injected actions bundle (no `@/app/*` import under `src/components`).
- [ ] ER8 — On the dashboard in band context, a band admin sees a status button
      named `Status: <label>. Click to advance.` that advances the band row; a
      non-admin member sees a read-only badge and no such button; personal
      context is unchanged. Asserted by a jsdom test.
- [ ] ER9 — `Band status is computed from all members` appears nowhere under
      `src/` or `e2e/`, and the replacement caption attributes the value to a
      band admin.
- [ ] ER10 — `AppLayout`'s band-mode banner no longer claims status is read-only
      or computed from all members.
- [ ] ER11 — `landing.f3Desc` in both `en.json` and `pt-BR.json` describes a
      band repertoire with its own key, lyrics and readiness, authored rather
      than derived; neither mentions a weakest-link or "menor nível" rule, and
      `landingCopy.test.ts` pins both halves.
- [ ] ER12 — `AGENTS.md` and `spec.md` no longer describe a band aggregate or a
      "weakest member wins" calculation; they state that status is per-owner and
      that a band's is authored by a band admin.
- [ ] ER13 — `npm run test:coverage` exits 0 with all four thresholds met, and
      `npm run lint:dead` exits 0.
- [ ] ER14 — `package.json`'s version is bumped above `0.1.131-202610050735`
      following the `x.y.z-YYYYMMDDHHmm` rule.

## Out of Scope

RH-102's four-note control; a visual admin gate on Fast View's `StatusDropdown`
or on `PlaylistSongRow`; backfilling the statuses the trigger wrote; band tags,
lyrics, key and membership authorization.
