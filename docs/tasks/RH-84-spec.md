# RH-84 — Let the musician choose the band or personal lyrics version when editing

> **Filename mapping.** This is the spec for Meridian board task **RH-83**. Spec
> filenames in this repository run one ahead of the board id, so board `RH-83`
> is documented at `docs/tasks/RH-84-spec.md` and its mockup at
> `docs/tasks/RH-84-mock.html`. Measured at HEAD `376b3a2`.

## Scope

Fast View's Lyrics section, in **band context only**, gains three things:

1. **Reading** resolves to the musician's own (personal) lyrics whenever that
   text is non-empty, and to the band's otherwise — the same "personal wins"
   philosophy the tab library already applies when it merges band and personal
   tabs.
2. **Writing** always asks. Tapping *Edit* / *Add* on a band entry opens a
   choice — edit the band's version (every member sees it) or my own — and the
   dialog is shown every time, including once a personal version exists.
3. **An indicator** in the Lyrics section header names the version currently
   being read, online and offline.

Plus the three consequences that fall out of it: how a personal version is
seeded, how it is discarded, and what happens when the musician has no personal
`repertoire` row for the song at all.

**Not covered:** no new table and no new column — the personal lyrics are the
`lyrics` column on the musician's own `repertoire` row. No change to personal
context (outside a band nothing about this feature appears). No change to tabs,
links, tags or playlists, and no band/personal choice for status — the only
status-related change is the seeding fix of §3(d), which exists so that this
feature (and the tab upload that already ships) cannot move the band's status
at all. No editing offline. No band-vs-personal choice
anywhere other than the lyrics editor.

## Approach

### 1. Resolution and the indicator (behavior)

`src/lib/lyricsEditor.ts` gains the version vocabulary and the decisions, pure
and unit-testable in the default `node` environment:

- `LyricsVersion = 'band' | 'personal'`.
- `resolveLyricsVersion(entry, personalEntry)` → `'personal'` only when the
  entry is a band entry *and* the personal row's `lyrics` is non-empty after
  trimming; `'band'` otherwise (including the whole of personal context).
- `selectDisplayedLyrics` is re-expressed in terms of a `LyricsVersion` rather
  than today's `showPersonalLyrics` boolean.
- `hasPersonalVersion(entry, personalEntry)` replaces
  `hasDifferentPersonalLyrics` as the switcher-banner condition: the banner is
  offered whenever a band entry's musician has a non-empty personal version,
  differing or not, because seeing the band's text is how they decide whether
  to keep theirs.
- `seedLyricsDraft(version, entry, personalEntry)` — see §3(a).
- `resolveLyricsSaveTarget` keeps its shape but takes the chosen
  `LyricsVersion` instead of `showPersonalLyrics`.

`src/hooks/useLyricsEditor.ts` replaces the `showPersonalLyrics` boolean with an
explicit **override** (`LyricsVersion | null`): the displayed version is
`override ?? resolveLyricsVersion(entry, personalEntry)`. `toggleVersion` sets
the override; a successful save sets it to the version just saved; a discard
clears it. The controller exposes `activeVersion: LyricsVersion` and
`hasPersonalVersion` in place of `showPersonalLyrics` /
`hasDifferentPersonalLyrics`.

`src/components/fastview/LyricsSection.tsx` renders the badge from
`activeVersion` — `👥 Band` / `👤 My version` — in band context only, and
renders it even when the resolved lyrics are empty (the badge answers "which
version am I looking at", which is a question with an answer before any text
exists).

### 2. The choice dialog (behavior)

A new presentational component
`src/components/fastview/LyricsDestinationModal.tsx`, modelled on the existing
`TabDestinationModal.tsx` (same overlay shape, same two-option layout, rendered
at the page's root fragment, never `window.confirm`). Copy is English (F25):

- **👥 Band lyrics** — "Everyone in the band sees this."
- **👤 My version** — "Private to you. Starts as a copy of the band's lyrics."
  plus, when the musician has no personal row for this song yet, the line
  "Adds this song to your personal repertoire when you save."
- Cancel.

`useLyricsEditor.startEditing` becomes: in personal context, open the editor
directly (unchanged); in band context, open the dialog and open the editor only
once a choice is made. The chosen version is held as a separate
**edit target** so it cannot be confused with the displayed version.

### 3. The three open questions, settled

**(a) Seeding — from the band's text.** Choosing "My version" with no personal
lyrics yet seeds the draft with the band's current text; with personal lyrics
already there it seeds those. Choosing "Band lyrics" always seeds the band's
text, even while the personal version is on screen. Rationale: the dominant
real use of a personal version is "the band's chart with my cues, my
transposition, my cut verse". Starting empty forces the musician to re-paste
text that is one tap away, and clearing a seeded draft is a single
select-all-delete; the reverse is not.

**(b) Discarding — write an empty personal `lyrics`.** Because the resolution
rule treats an empty personal `lyrics` as "no personal version", discarding is
exactly that write. The editor panel shows a **Discard my version** control only
while the edit target is `personal` *and* a non-empty personal version exists;
it asks for confirmation through the existing `ConfirmPanel` pattern (never a
browser dialog), then issues `updateLyrics(personalRepertoireId, '', null)`,
clears the override, and reading falls back to the band's text. The personal
`repertoire` **row is not deleted** — it also carries the musician's status,
tags and tabs for the song. A personal draft that is empty or whitespace-only is
normalized to `''` on save, so "select all, delete, Save" is the same discard.

**(c) No personal `repertoire` row — create it, lazily, on save, seeded with the
band's status, and say so.** The personal lyrics have no other home: the task
forbids a new table or column, so the text must live on the musician's own row
for that song, and if there is no such row it has to be created. This is not new
machinery — `useLyricsEditor.save` already calls `addSong(entry.song_id)` when
`personalRepertoireId` is `null`; what changes is that the choice dialog makes
that path reachable deliberately instead of only after a version toggle.

The rules that make it defensible:

- The row is created **only when the musician presses Save** — never when the
  dialog opens, never on Cancel, never on discard. Browsing the dialog costs
  nothing.
- The **user-visible consequence is stated plainly in the dialog** ("Adds this
  song to your personal repertoire when you save."), not buried here. That line
  is rendered exactly when there is no personal row yet (ER15).
- **The new row is created with the band row's current status, not `unknown`**
  — see §3(d), which is where the one remaining consequence is removed rather
  than merely disclosed.

**(d) Creating the personal row must not drag the band's status to Unknown
(fixes a latent bug that exists today).**

Measured at HEAD: `song_status` is `ENUM ('unknown','learning','practicing',
'polishing','mastered')` (`migrations/0001_initial_schema.sql:20-22`), so
`unknown` is the **floor** of `MIN`. `sync_band_repertoire_on_member_update`
(`:278-303`) recomputes the band row as `MIN(member_rep.status)` over **all**
band members' personal rows for that song, with no filter, and fires from
`trg_sync_band_repertoire` `AFTER UPDATE OF status`. `addSongToRepertoire`
(`src/lib/songs.ts:73-74`) inserts a literal `'unknown'`. The INSERT itself does
not fire the trigger, but the next status change by *any* member recomputes the
band row, now including the freshly inserted `unknown` row, and sets the band's
displayed status for that song to **Unknown**. A musician writing a lyric note
would drag their band's mastery to Unknown.

**This is not hypothetical and not introduced by this task**: the personal
tab-upload path already reaches the same branch in production
(`src/hooks/useTabLibrary.ts:185-189` calls `actions.addSong(songId)` when
`resolveUploadTarget` returns a null personal id). The fix below therefore
**closes a latent bug that ships today via tab uploads**; it is deliberate
scope, not incidental.

The fix goes **at the origin**, so both callers get it:

- `addSongToRepertoire(owner, songId, seedStatusFromBandId: string | null =
  null)` in `src/lib/songs.ts`. The inserted status stops being the literal
  `'unknown'` and becomes
  `COALESCE((SELECT b.status FROM repertoire b WHERE b.band_id = $4 AND
  b.song_id = $1), 'unknown')`, with `$4` the new nullable parameter. **This is
  where the condition lives, and it is conditional by construction**: when `$4`
  is `NULL` (personal context, the song picker, the dashboard) the subselect
  matches no row and the value is `'unknown'` — byte-for-byte today's behaviour.
  Same result when the band genuinely has no row for that song. The parameter is
  ignored when `owner` is a band (`'bandId' in owner`), because band rows are
  never seeded from themselves.
- `addSongAction(songId, bandId?, seedStatusFromBandId?)` in
  `src/app/actions/repertoire.ts` passes it through, and — because the value
  arrives from the client — calls `assertBandMember(seedStatusFromBandId,
  userId)` before using it, exactly as `resolveOwner` does. A band the caller is
  not a member of throws; no status of a stranger's band is ever read.
- The two Fast View composition roots adapt the shape so a hook can never
  confuse "seed from this band" with "own this row":
  `src/app/fastViewLyricsActions.ts` and `src/app/fastViewTabActions.ts` wire
  `addSong: (songId, seedFromBandId) => addSongAction(songId, null,
  seedFromBandId)`. `useLyricsEditor` passes `entry.band_id`; `useTabLibrary`
  passes `entryBandId`. Both are already `string | null`, so the
  personal-context case passes `null` and nothing changes there.

Why this removes the consequence rather than disclosing it: the new row's status
equals the band row's current status, and the band row's status is already the
`MIN` over its members, so adding one row equal to that value cannot lower the
`MIN`. The band's displayed status is unchanged by the insert and unchanged by
the next recompute.

`RepertoireDashboard.tsx:212` and `useSongPicker.ts:180` keep calling
`addSong`/`addToRepertoire` with one argument and are not touched.

### 4. Authorization — the choice is a pair of arguments, not a trusted flag

No new Server Action, no new parameter, and nothing on the wire that says "the
user chose band". The client's choice only selects **which existing call** is
made:

- Band → `updateLyricsAction(entry.id, draft, entry.band_id)`. The action
  resolves `resolveOwner(bandId)`, which runs `assertBandMember(bandId,
  userId)` and throws for a non-member, and the SQL matches
  `WHERE id = $2 AND band_id = $3`.
- Personal → `updateLyricsAction(personalRepertoireId, draft, null)`. The owner
  is the session's own `userId` and the SQL matches
  `WHERE id = $2 AND user_id = $3`.

So a forged `bandId` fails in `assertBandMember`, and a mismatched
`(repertoireId, bandId)` pair matches no row. One gap must be closed for that to
*fail closed* rather than fail silently: `updateLyrics` in `src/lib/songs.ts`
ignores `rowCount`, so a write that matched nothing currently reports success
and the musician sees "Lyrics saved successfully!". It must throw
`Lyrics entry not found or not editable` when `rowCount` is 0 — raised after the
wrapping `try/catch` so the message survives verbatim to the UI (L1a).

**Ratchet constraint:** `src/lib/songs.ts` is pinned at `max-lines: 529` and is
exactly 529 lines. The override list may only shrink, so this change — both the
`updateLyrics` row-count check and the §3(d) seed — must not grow the file:
reclaim the lines from `updateLyrics`'s now-false seven-line doc comment
(`:406-412`, "Deliberately no `RETURNING id` row-count check") and its SQL
literal, and, if the file ends shorter, update the pin to the file's new exact
line count. Never add an override entry; the list stays at 17 with
`MAX_OVERRIDES = 17`.

### 5. Offline (read-only; RH-78/79/80)

Offline stays read-only: the Edit/Add button is already `readOnly`-disabled, so
no dialog can open and no write is attempted. What must change is that the
**snapshot knows about the personal version**, or the indicator lies offline.

- `OfflineSongSnapshot` gains `personalRepertoire: Repertoire | null` — the
  musician's own row for that song, captured at download time. RH-80's
  deliberate "the personal row is not captured" note is revised here, on
  purpose, and the doc comments in `offlineSnapshot.ts` / `offlineFirst.ts` must
  be updated rather than left contradicting the code.
- `useOfflinePlaylist` adds `getPersonalEntryForSong` to its injected
  `OfflineDownloadActions` and calls it once per song **only when `bandId` is
  set**. The action already catches and returns `null`, so the read is
  fail-soft and cannot break a download.
- `offlineFirst`'s `getPersonalEntryForSong` reader answers from the snapshot by
  `songId` (a new `findSongBySongId` scan over `song.repertoire.song_id`)
  instead of always returning `null`. The resolved version, the badge and the
  switcher then work offline through exactly the same code as online, with no
  offline branch in any controller or component.
- Personal **tabs** are still not captured. The second `getTabs` call fires
  offline with the personal repertoire id, finds no snapshot song under it and
  returns `[]` — correct, because those PDFs were never downloaded.
- `OFFLINE_SCHEMA_VERSION` goes to **2**. A v1 snapshot cannot tell "no personal
  version" from "not captured", and an indicator that might be wrong is worse
  than no offline copy; a photograph is cheap to retake. **Consequence for
  musicians: playlists downloaded before this ships stop counting as downloaded
  and must be downloaded again.** So that this is not merely silent,
  `listOfflinePlaylists` must skip any record whose `schemaVersion` is not the
  current one and purge it (record plus its cached tab bytes, via the existing
  `removeOfflinePlaylist`), instead of listing it as "Downloaded" while Fast
  View reports the playlist unavailable.

### 6. Landing page (F: Landing Page Rule)

**Not a selling point.** This refines how an existing band/personal capability
behaves rather than adding something a musician would choose the app for. Both
dictionaries stay untouched.

### Files touched

- `src/lib/lyricsEditor.ts` — `LyricsVersion`, `resolveLyricsVersion`,
  `hasPersonalVersion`, `seedLyricsDraft`; `selectDisplayedLyrics` and
  `resolveLyricsSaveTarget` re-expressed on the version; controller contract.
- `src/hooks/useLyricsEditor.ts` — version override, edit-target state, the
  dialog gate on `startEditing`, seeding, discard, post-save version switch.
  (If the hook's function body approaches `max-lines-per-function: 200`, split
  the version/dialog state into a sibling `src/hooks/useLyricsVersionChoice.ts`
  — the `useBandEdit`/`useBandAdmin` precedent — rather than adding an override.)
- `src/components/fastview/LyricsDestinationModal.tsx` — new; the choice dialog.
- `src/components/fastview/LyricsSection.tsx` — badge from `activeVersion`,
  switcher banner condition, dialog trigger.
- `src/components/fastview/LyricsEditorPanel.tsx` — the Discard my version
  control and its confirmation.
- `src/app/songs/[id]/fast-view/page.tsx` — renders the modal at the root
  fragment (the `TabDestinationModal` placement rule).
- `src/lib/songs.ts` — `updateLyrics` throws on `rowCount === 0`;
  `addSongToRepertoire` gains the nullable `seedStatusFromBandId` parameter and
  the `COALESCE` seed; both within the file's pinned line budget.
- `src/app/actions/repertoire.ts` — `addSongAction` third parameter, guarded by
  `assertBandMember`.
- `src/app/fastViewLyricsActions.ts`, `src/app/fastViewTabActions.ts` — adapt
  `addSong` to `(songId, seedFromBandId)`.
- `src/hooks/useTabLibrary.ts` — passes `entryBandId` to `addSong` (the latent
  bug fix on the tab-upload path); `LyricsEditorActions.addSong` /
  `TabLibraryActions.addSong` types updated.
- `src/lib/offlineSnapshot.ts` — `personalRepertoire` on the song snapshot,
  validator, `OFFLINE_SCHEMA_VERSION = 2`, doc comments.
- `src/lib/offlineStore.ts` — carry `personalRepertoire` through
  `OfflineSongInput`; `listOfflinePlaylists` drops and purges stale-version
  records.
- `src/lib/offlineFirst.ts` — `getPersonalEntryForSong` answers from the
  snapshot; doc comment updated.
- `src/hooks/useOfflinePlaylist.ts` + `src/app/offlineActions.ts` — capture the
  personal row during download in band context.
- `eslint.config.mjs` — only if `src/lib/songs.ts` shrinks: pin updated down.
- `package.json` — version bump.
- Tests: `src/lib/__tests__/lyricsEditor.test.ts`,
  `src/hooks/__tests__/useLyricsEditor.test.tsx`,
  `src/components/fastview/__tests__/LyricsSection.test.tsx`,
  `src/lib/__tests__/offlineSnapshot.test.ts`,
  `src/lib/__tests__/offlineStore.test.ts`,
  `src/components/fastview/__tests__/LyricsDestinationModal.test.tsx`,
  `src/hooks/__tests__/useTabLibrary.test.tsx`,
  `src/lib/__tests__/offlineFirst.test.ts`,
  `src/hooks/__tests__/useOfflinePlaylist.test.tsx`,
  `src/app/actions/__tests__/` (the `updateLyrics` fail-closed cases),
  `src/components/fastview/__tests__/offlineReadOnlyControls.test.tsx`.

### Test criteria

Unit tests for every new pure function in `src/lib`; `@testing-library/react`
tests (`// @vitest-environment jsdom` first line, explicit `afterEach(cleanup)`)
for the dialog gate, the badge, the seeding and the discard; snapshot/store/
offline-first tests for the schema bump and the personal-row capture; the
existing guard suites (`complexityBudget`, `namingConventions`,
`errorHandlingStyle`, `actionDataAccessGuard`, `transactionGuard`) stay green;
`npm run test:coverage` meets its thresholds.

![Mockup](RH-84-mock.html)

## Expected Results

- [ ] **ER1** `src/lib/lyricsEditor.ts` exports `resolveLyricsVersion`, which
      returns `'personal'` exactly when the entry is a band entry and the
      personal row's `lyrics` is non-empty after trimming, and `'band'` in every
      other case (no band, no personal row, empty or whitespace-only personal
      lyrics); covered by passing tests in
      `src/lib/__tests__/lyricsEditor.test.ts`.
- [ ] **ER2** In band context with a non-empty personal version, Fast View
      renders the personal lyrics on first paint with no user interaction; with
      an empty personal version it renders the band's. Pinned by a passing DOM
      test.
- [ ] **ER3** In band context the Lyrics header renders exactly one version
      badge — `👥 Band` when the band text is displayed, `👤 My version` when
      the personal one is — including when the resolved lyrics are empty; in
      personal context no badge is rendered.
- [ ] **ER4** In band context, clicking `Edit` (or `Add`) opens the choice
      dialog and does **not** open the editor; the dialog appears every time,
      including when a personal version already exists. In personal context the
      editor opens directly and no dialog is rendered. No `window.confirm` or
      `alert` is used anywhere in the flow.
- [ ] **ER5** Draft seeding, pinned by tests on `seedLyricsDraft` and on the
      hook: choosing *My version* with no personal lyrics seeds the band's text;
      choosing *My version* with existing personal lyrics seeds those; choosing
      *Band lyrics* seeds the band's text even while the personal version is on
      screen.
- [ ] **ER6** Saving after choosing *Band lyrics* calls
      `updateLyrics(entry.id, draft, entry.band_id)`; saving after choosing
      *My version* calls `updateLyrics(personalRepertoireId, draft, null)`,
      preceded by `addSong(entry.song_id, entry.band_id)` exactly when
      `personalRepertoireId` is `null` — the second argument being the band to
      seed the status from (ER16). `addSong` is not called when the dialog is
      merely opened or cancelled.
- [ ] **ER7** After a successful save the displayed version is the one just
      edited (saving the band version while a personal one exists leaves the
      band text on screen).
- [ ] **ER8** While editing an existing personal version, a **Discard my
      version** control is offered; confirming it writes `''` to the personal
      row and the section falls back to displaying the band's lyrics with the
      `👥 Band` badge. Saving a whitespace-only personal draft has the same
      effect. The personal `repertoire` row is not deleted.
- [ ] **ER9** `updateLyrics` throws `Lyrics entry not found or not editable`
      when its UPDATE matches no row, and `updateLyricsAction` still resolves
      its owner through `resolveOwner`/`assertBandMember` with no new
      client-supplied parameter; covered by passing tests for (i) a `bandId` the
      user is not a member of, which rejects before any write, and (ii) a
      personal repertoire id sent with a `bandId`, which throws and writes
      nothing.
- [ ] **ER10** `OFFLINE_SCHEMA_VERSION === 2`; `OfflineSongSnapshot` carries
      `personalRepertoire`; the download captures the member's own row once per
      song when `bandId` is set and never when it is `null`; the offline
      `getPersonalEntryForSong` reader answers from the snapshot by song id, so
      offline Fast View shows the same lyrics and the same badge as online for
      the same data. Offline the `Edit`/`Add` button stays disabled and the
      dialog cannot be opened.
- [ ] **ER11** `listOfflinePlaylists()` returns no record whose `schemaVersion`
      differs from `OFFLINE_SCHEMA_VERSION` and purges such a record (IndexedDB
      record and its cached tab bytes); a playlist downloaded before this change
      therefore shows as not downloaded and can be downloaded again. Pinned by a
      passing test in `src/lib/__tests__/offlineStore.test.ts`.
- [ ] **ER12** `src/lib/__tests__/complexityBudget.test.ts` passes: the
      `complexity-budget/override` list has at most 17 entries, no entry is
      added, and any pin whose file shrank equals that file's new exact worst
      number. `src/lib/songs.ts` is at most 529 lines.
- [ ] **ER13** `npm run test:coverage` passes with its configured thresholds,
      and `npm run lint` introduces no new problem: the same **20 problems
      (8 errors, 12 warnings)** with the same `(file, rule, severity)` triples
      as at HEAD `376b3a2` (it does not exit 0 in this repository, and is not
      expected to).
- [ ] **ER14** No landing-page change: `src/i18n/dictionaries/en.json` and
      `pt-BR.json` are untouched. `package.json` `version` is bumped above
      `0.1.122-202609221948` in the `x.y.z-YYYYMMDDHHmm` format.
- [ ] **ER15** The choice dialog always renders the sentence
      `Starts as a copy of the band's lyrics.` under *My version*, and renders
      the disclosure `Adds this song to your personal repertoire when you save.`
      **exactly when `personalRepertoireId` is `null`** — present in that case,
      absent when a personal row already exists. Pinned by two passing DOM
      assertions (one per case) in the dialog's test file, so deleting the
      sentence fails the suite.
- [ ] **ER16** Creating the personal row never lowers the band's status.
      `addSongToRepertoire(owner, songId, seedStatusFromBandId)` inserts the
      band row's current `status` for that `song_id` when
      `seedStatusFromBandId` is a band that has the song, and `'unknown'` when
      it is `null` or when that band has no row for the song; a band owner
      ignores the parameter. `addSongAction` calls `assertBandMember` on a
      non-null `seedStatusFromBandId` and rejects a band the caller is not a
      member of before any INSERT. Both Fast View paths pass it — lyrics
      (`entry.band_id`) and the existing personal tab upload
      (`useTabLibrary`, `entryBandId`) — while `RepertoireDashboard` and
      `useSongPicker` still create `unknown` rows unchanged. Covered by passing
      tests for: band seed applied, `null` seed yields `unknown`, non-member
      band rejected, tab-upload path passes the band id, and personal context
      passes `null`.

## Out of Scope

- Any new table, column or migration for lyrics.
- Editing, choosing or discarding a lyrics version offline.
- Capturing personal **tabs** in the offline snapshot.
- Changing personal (non-band) context in any way.
- Migrating v1 offline snapshots instead of discarding them.
- Applying the same band/personal choice to status, tags or links.
- Back-filling the status of personal rows already created as `unknown` by the
  tab-upload path before this change.
