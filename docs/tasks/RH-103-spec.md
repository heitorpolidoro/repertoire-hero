# RH-102 — Replace the cycling status badge with the four-note control

> Board id RH-102; this file follows the repository's `+1` filename offset.

## Scope

One status control, everywhere a status is shown: four quarter notes with the stage
name beside them, replacing the three badges that exist today — the dashboard row
badge, the playlist row badge and the Fast View `StatusDropdown`. Tapping a note sets
that stage directly in either direction; tapping the note that is already current drops
one stage, and tapping the first note while it is current returns the row to `unknown`.
Nothing cycles, so nothing wraps past `mastered` back to unassessed.

`STATUS_ORDER` becomes the four real stages with `unknown` outside it. `unknown` is zero
notes filled, and in `PlaylistSummary` it becomes the unfilled remainder of the bar
rather than a fifth coloured segment. `STATUS_CONFIG` keeps all five labels and colours
unchanged, and keeps exactly today's three consumers — the dashboard status filter, the
`SongForm` picker and `PlaylistSummary`'s bar. The note control is monochrome and reads no
colour from it. `nextStatus` and `cycleSongStatus` are removed — after this task neither
has a caller.

Everything specified here is already decided in `docs/use-cases.md`, *Set a song's
status*, and in `docs/plans/repertoire-rework.md`, *Replace the cycling status badge with
the note control*. This spec adds no decision to them; it names the files and the proof.

**Not covered:** who is allowed to write a band's status (RH-96), any change to the
`song_status` Postgres enum or any migration, the aggregate `MIN` trigger, the practice
log, and the playlist score formula (`STATUS_SCORES`, the 0–100 number and the label
nearest to it keep today's values exactly).

## Approach

### Behavior

**The control.** Four quarter-note glyphs in mastery order (`learning`, `practicing`,
`polishing`, `mastered`), followed by the current stage's label in a fixed-width slot so
the notes do not shift horizontally as the word changes length. Note *i* is filled when
the current status is at or above stage *i*; `unknown` fills none.

The control is **monochrome at every status** — this is the design the operator approved,
and no part of it is stage-coloured. Exactly three colours appear, and all three are the
repository's existing text greys:

- a **filled** note — solid notehead and stem — is the primary foreground, `text-gray-900`;
- an **unfilled** note — outlined notehead plus stem — is the muted foreground,
  `text-gray-400`;
- the **stage name** beside the notes is the secondary foreground, `text-gray-700`, and
  drops to the muted `text-gray-400` when the status is `unknown`.

The SVG paints `fill`/`stroke` from `currentColor` only, so those three classes are the
whole colour surface and nothing in the control imports from `STATUS_CONFIG`. The glyphs
are inline SVG, not a font character, because the fill/outline distinction has to be
controllable; each glyph is `aria-hidden` and the accessible name lives on its button.

**Interaction.** Each note is a button. Pressing note *i* writes stage *i*, whether that
is above or below the current status. Pressing the note that is exactly the current
status writes one stage down — from note 1 that is `unknown`. The accessible name states
the outcome, not the position: `Set status to Polishing`, `Drop status to Practicing`,
`Clear status` for the one-note-current case. Filled notes carry `aria-pressed="true"`.
The group is a `role="group"` with `aria-label="Mastery status"` (not a radiogroup —
pressing the selected option changes the value, which radio semantics do not express).

**Two sizes, one component.** A `size` prop selects the dashboard/playlist-row size
(≈17px noteheads, sharing width with cover, title and artist) or the Fast View size
(≈32px, the comfortable standing-up target the use case asks for). No third size.

**Read-only and in-flight.** The control always renders four `<button>` elements, in every
state, so the DOM never changes shape: `readOnly` and `busy` each add the `disabled`
attribute and drop the hover affordance, and nothing else. No `<span>` substitution — a
disabled button keeps its accessible name, which is the whole point of the "Set status
to …" / "Drop status to …" / "Clear status" naming, and a `<span>` around an `aria-hidden`
glyph would have none. `aria-pressed` is present on every note in every state, including
the disabled ones.

The two props are separate even though they render identically, because their causes
differ: `readOnly` is a permission (this viewer may not write this status) and `busy` is a
write in flight (the Fast View's `updating`). Either one alone disables the four buttons;
they compose without interacting. In band context the control inherits exactly the
predicate each call site already has. **RH-96 landed first**, so that predicate is now an
admin check: a band admin gets the control enabled and writes the band row, every other
member gets it read-only. This task must preserve that distinction rather than disabling
the control for everyone in band context. RH-96 also replaced the old tooltip, so there is
no "Band status is computed from all members" text left to carry over, and the band
read-only control gets no explanatory tooltip from this task. What this task removes from
RH-96's work is the `Status: <label>. Click to advance.` button: the four notes replace it,
and the admin now taps a note instead.

**`unknown` leaves `STATUS_ORDER`.** Every current consumer of `STATUS_ORDER` was checked
and each one is dealt with:

- `src/lib/songStatus.ts` — `STATUS_OPTIONS` and `SongStatusOption` existed only for the
  dropdown and go with it. `statusUpdatedMessage` stays, unchanged.
- `RepertoireDashboard`'s status filter and `SongForm`'s status radio group must keep
  offering all five values, including Unknown. They enumerate a new
  `ALL_STATUSES: SongStatus[]` export from `statusConfig.ts` — `unknown` followed by the
  four stages — rather than `STATUS_ORDER`.
- `playlistDetail.ts` — `summarisePlaylistMastery`'s `earned` reduce and
  `nearestScoreStatus` both enumerate `ALL_STATUSES`, so score 0 still reads `Unknown`
  and 100 still reads `Mastered`. The scores and the label mapping are unchanged.
- `PlaylistSummary` — the stacked bar draws segments for the four stages only, over a
  light-grey track; the unassessed share of the playlist is the part of the track no
  segment covers. The legend lists the four stages with a non-zero count as today, and
  when any song is unassessed it ends with a plain-text `N unassessed` entry carrying no
  colour swatch. `STATUS_BAR_COLORS` loses its `unknown` row.

**The two cycle helpers go.** `nextStatus` is deleted from `statusConfig.ts`.
`cycleSongStatus` in `playlistDetail.ts` becomes `setSongStatus(repertoire, songId,
status)`, returning the same `{ entry, status, updated }` shape so `usePlaylistDetail`
keeps its optimistic write and its roll-back-to-the-captured-entry behaviour verbatim.

**Landing page (AGENTS.md rule).** Not a selling point: this is the correction of a
destructive control, not a capability a musician would choose the app for. No landing copy
changes here. (The `f3Desc` "menor nível" copy belongs to the trigger-removal task, not to
this one.)

### Files touched

- `src/lib/statusConfig.ts` — `STATUS_ORDER` narrows to the four stages; new
  `ALL_STATUSES`; `nextStatus` deleted.
- `src/lib/statusNotes.ts` — **new.** The control's pure decisions: filled-note count for
  a status, the status a note index represents, the status a tap on note *i* produces from
  the current one, and that tap's accessible label.
- `src/components/ui/StatusNotes.tsx` — **new.** The control itself (cross-area, so `ui/`).
- `src/lib/songStatus.ts` — `STATUS_OPTIONS`/`SongStatusOption` removed;
  `SongStatusController` loses `isDropdownOpen`, `toggleDropdown` and `closeDropdown`.
- `src/hooks/useSongStatus.ts` — drops the dropdown open state; keeps `status`, `updating`
  and `change`.
- `src/components/fastview/StatusDropdown.tsx` — **deleted.**
- `src/components/fastview/SongIdentityHeader.tsx` — renders `StatusNotes` at the Fast
  View size, forwarding `readOnly` and the in-flight flag.
- `src/components/songs/RepertoireDashboard.tsx` — the row badge becomes `StatusNotes`;
  the filter list reads `ALL_STATUSES`.
- `src/components/songs/SongForm.tsx` — the status radio group reads `ALL_STATUSES`.
- `src/components/playlists/PlaylistSongRow.tsx` — the row badge becomes `StatusNotes`;
  `onStatusCycle` becomes `onStatusChange(songId, status)`.
- `src/hooks/usePlaylistDetail.ts` — `cycleStatus` becomes `changeStatus(songId, status)`
  over `setSongStatus`.
- `src/lib/playlistDetail.ts` — `cycleSongStatus` → `setSongStatus`; both `STATUS_ORDER`
  reads become `ALL_STATUSES`.
- `src/components/playlists/PlaylistSummary.tsx` — four-stage bar over a grey track, the
  `unassessed` legend text, `STATUS_BAR_COLORS` without `unknown`.
- `src/lib/__tests__/statusConfig.test.ts`, `src/lib/__tests__/songStatus.test.ts`,
  `src/lib/__tests__/playlistDetail.test.ts`,
  `src/components/fastview/__tests__/SongIdentityHeader.test.tsx`,
  `src/components/fastview/__tests__/offlineReadOnlyControls.test.tsx` — updated to the
  new shape.
- `src/lib/__tests__/statusNotes.test.ts`,
  `src/components/ui/__tests__/StatusNotes.test.tsx` — **new.**
- `e2e/playlist-detail.spec.ts` — the `cycles the mastery status` spec becomes a
  set-and-drop spec against the note labels.
- `eslint.config.mjs` — the ratchet entries for `RepertoireDashboard.tsx` and
  `SongForm.tsx` re-pinned to their new (smaller) worst numbers if the edits shrink them.
  The ratchet may only shrink; no new entry.
- `package.json` — version bump per the AGENTS.md rule.

### Test criteria

Unit (`vitest`, inside the coverage gate): `statusNotes.ts` covers all five statuses'
filled counts, the up/down/same-note tap outcomes for every index, and the labels.
`statusConfig.test.ts` asserts the four-stage `STATUS_ORDER`, the five-entry
`ALL_STATUSES`, that `STATUS_CONFIG` still has all five labels, and that `nextStatus` is
gone. `playlistDetail.test.ts` keeps its existing score/label expectations green with no
numeric edit, and covers `setSongStatus` both for a present and an absent entry.

DOM (`@testing-library/react`, jsdom, explicit `afterEach(cleanup)`): `StatusNotes` renders
four buttons, the right number filled for each status, the stated accessible names,
reports the right status for an upward tap, a downward tap and a tap on the current note,
still renders four buttons with their `aria-pressed` values when `readOnly` and separately
when `busy` — each time with all four `disabled` and firing no callback on click — and
carries no `STATUS_CONFIG` colour class on any note.

E2E: the playlist-detail spec sets a status upward by tapping a note, reloads to prove it
persisted, then taps the current note to drop it and reloads again — the behaviour the old
spec could not express.

Guards that must stay green without new overrides: `complexityBudget.test.ts`,
`namingConventions.test.ts`, `npm run lint:dead` (no orphan export left behind), and
`npm run test:coverage` at its current thresholds.

## Expected Results

- [ ] ER1: `src/lib/statusConfig.ts` exports `STATUS_ORDER` as exactly
      `['learning','practicing','polishing','mastered']`, exports `ALL_STATUSES` as those
      four preceded by `'unknown'`, keeps all five `STATUS_CONFIG` labels and colours, and
      exports no `nextStatus`; a repo-wide grep for `nextStatus` and for `cycleSongStatus`
      matches nothing under `src/`.
- [ ] ER2: A new `src/lib/statusNotes.ts` reports 0 filled notes for `unknown` and 1–4 for
      the four stages, and its tap function returns stage *i* for a tap on a note that is
      not current, the stage one below for a tap on the current note, and `unknown` for a
      tap on the first note while the status is `learning`.
- [ ] ER3: A new `src/components/ui/StatusNotes.tsx` renders exactly four `<button>`
      elements plus the current stage label, inside a `role="group"` named `Mastery
      status`, with the label in a fixed-width slot so the notes occupy the same horizontal
      position for every status. The four buttons are present for all five statuses and in
      every prop combination, including `readOnly` and `busy`.
- [ ] ER4: Each note button's accessible name states the outcome — `Set status to <Stage>`
      for a note that is not current, `Drop status to <Stage>` for the current note, and
      `Clear status` for the first note while the status is `learning` — and every note
      button carries `aria-pressed`, `"true"` when filled and `"false"` when not, in every
      state including `readOnly` and `busy`.
- [ ] ER5: The control is monochrome at every status: a filled note renders in
      `text-gray-900`, an unfilled note in `text-gray-400`, and the stage name in
      `text-gray-700` except for `unknown`, where it is `text-gray-400`. No note or stem
      carries any other colour in any status, `StatusNotes.tsx` and `statusNotes.ts` import
      nothing from `statusConfig.ts` other than labels and the status type, and neither file
      contains a `blue`, `yellow`, `orange`, `green` or `emerald` class or hex literal.
- [ ] ER6: `StatusNotes` accepts a size selecting the ≈17px row notes and the ≈32px Fast
      View notes, and accepts `readOnly` and `busy` as independent props: with either one
      set (and with both set), all four buttons carry the `disabled` attribute and a click
      on any of them invokes no change callback, while with neither set all four are
      enabled.
- [ ] ER7: `src/components/fastview/StatusDropdown.tsx` no longer exists;
      `SongIdentityHeader` renders `StatusNotes` at the Fast View size with `busy` bound to
      the in-flight write, and `SongStatusController`/`useSongStatus` expose no
      `isDropdownOpen`, `toggleDropdown` or `closeDropdown`.
- [ ] ER8: The dashboard row and the playlist row show the note control instead of a
      pill badge; no element in either carries the text `Click to advance` or
      `Band status is computed from all members`. In band context the control follows
      RH-96's admin predicate: for a band **admin** all four buttons are enabled and a tap
      writes the band row, for any other band member all four carry `disabled`, and in
      both cases the four buttons are present with their accessible names intact.
- [ ] ER9: `PlaylistSummary`'s stacked bar draws segments only for the four stages over a
      grey track, so a playlist of 4 songs with 1 `mastered` and 3 `unknown` shows one
      segment at 25% and no segment for the remaining 75%, and the legend ends with a
      swatch-less `3 unassessed` entry.
- [ ] ER10: The playlist score and its label are unchanged: `summarisePlaylistMastery`
      still scores an all-`unknown` playlist 0 with label `Unknown` and an all-`mastered`
      playlist 100 with label `Mastered`, and `src/lib/__tests__/playlistDetail.test.ts`
      passes with no change to any expected number.
- [ ] ER11: The dashboard status filter and the `SongForm` status picker still offer all
      five values including `Unknown`, and both still render `STATUS_CONFIG`'s per-status
      colours.
- [ ] ER12: New tests `src/lib/__tests__/statusNotes.test.ts` and
      `src/components/ui/__tests__/StatusNotes.test.tsx` pass, and the updated
      `e2e/playlist-detail.spec.ts` spec both raises a playlist song's status by tapping a
      note and drops it by tapping the current note, verifying each across a reload.
- [ ] ER13: `npm run test:coverage` passes at the configured thresholds, `npm run lint:dead`
      reports no unused export or dependency, and `complexityBudget.test.ts` passes with the
      override list no longer than before and every entry pinned to its file's current worst
      number.
- [ ] ER14: `docs/tasks/RH-103-mock.html` exists, shows the four notes at both sizes in all
      five states from zero to four filled, and paints them monochrome — grey filled notes,
      grey outlined notes, no per-stage colour anywhere in the control.
- [ ] ER15: `package.json` carries a bumped version with the `YYYYMMDDHHmm` suffix, higher
      than any version in `git log`.

## Out of Scope

- **Who may write a band's status.** RH-96 ("Drop the band status trigger and author band
  status directly") owns the admin gating, and it has already landed. This task owns only
  what the control *is*: it takes RH-96's admin predicate at each call site as given and
  binds it to `readOnly`, without widening or narrowing who may write.
- **No migration and no schema change.** `unknown` remains a value of the `song_status`
  Postgres enum; only the UI's ordering array changes. Nothing in `migrations/` is added.
- The `MIN`-across-members trigger, the RH-83 seeding workaround and the landing copy that
  advertises them — all owned by the trigger-removal task.
- The playlist score formula and `STATUS_SCORES`.
- Any i18n of the control's copy; it is written inline in English (F25).

## Open question (not blocking)

Whether an unfilled note reads well enough on stage: the outlined notehead is thin, and
two filled versus three is less obvious under stage light than on a desk. The larger Fast
View size helps; whether it is enough is not something a mockup answers. Recorded in
`docs/use-cases.md` under *Set a song's status*; ship the specified control and revisit
only if real stage use says otherwise.
