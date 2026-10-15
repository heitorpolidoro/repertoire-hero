# RH-172 — Offer "Start practice" on more screens

Follow-up to RH-168 (the "Start practice" control) and RH-170 (start from a hand-picked selection). The session itself (`docs/use-cases.md` § *Start a practice session*) is unchanged; this task only adds entry points.

## Where the button is today

| Screen | Entry point | Since |
|---|---|---|
| Band screen `/bands/[id]` | `PracticeStart` in the band "Playlists" section header, source menu (Whole repertoire or one band playlist) | RH-168 |
| Band screen `/bands/[id]` | `BandSongPicker` "Select songs" then "Start practice" on the pick | RH-170 |
| Dashboard `/`, personal context | `PracticeStart` next to "Select songs", hidden while the picker is active | RH-168 |
| Dashboard `/`, personal and band context | `SongPickerBar` "Start practice" on the pick | RH-170 |
| Fast View `/songs/[versionId]/fast-view` | "Finish practice" on the last song of a session (ends a session, does not start one) | RH-169 |

## Candidate screens

| Screen | Verdict | Why |
|---|---|---|
| Playlist detail `/playlists/[id]` | **In scope** | The screen where a musician is already looking at one playlist; today they must go back to the dashboard or band screen and pick the same playlist from a menu. The source is known, so the button starts at once with no menu. |
| Dashboard `/` in band context | **In scope** | The dashboard shows the band repertoire and already lets the user hand-pick band songs (RH-170), but the "Start practice" button is hidden there (`bandContext.type === 'user'` guard). It is the one place where the hand-picked start exists without the due-order start. |
| Playlists index `/playlists` | Out | One tap from the playlist detail page, which gets the button; a per-card control adds a client island to a server page for little gain. |
| Bands index `/bands` | Out | One tap from the band screen, which already has the button. |
| Fast View (outside a session) | Out | Fast View is where a session runs; starting one from a single song has no source to order. |
| Settings, profile, auth, admin, offline, join, privacy | Out | Not about practising songs; the offline page cannot do the server read a start needs. |

## Scope

Covers: a "Start practice" button on the playlist detail page that starts a session from that playlist; moving every secondary action of that header ("Reorder", "Review practice", "Add songs", "Rename playlist", "Delete playlist") into a three-dots overflow menu to make room for it; and the existing `PracticeStart` control on the dashboard in band context.

Does not cover: any change to the ordering (`practiceOrder.ts`), the queue shape (`songQueue.ts`), Fast View, the hand-picked flow, or the end-of-session flow; any change to what Reorder, Review practice, Add songs, Rename or Delete do (only where their entry points live). No write: starting stays read-only, as in RH-168.

## Approach

**Behavior**

- Playlist detail: a "Start practice" button in `PlaylistDetailHeader`'s action group, the one visible primary action, shown only when the playlist has at least one song. One tap starts a session from this playlist (no source menu): candidates are read with the existing `getCandidates({kind:'playlist', playlistId}, bandId)`, where `bandId` is `playlist.band_id` (null for a personal playlist), ordered by `orderForPractice`, and written with `writeSongQueue`. Owner is `band` or `personal` from `playlist.band_id`; `label` is the playlist's name; `originHref` is `/playlists/<id>` so Back from Fast View returns to the playlist. Then it opens Fast View on the first song (with `?bandId=<id>` for a band playlist). It is distinct from the existing play-through (`openFastView` in `PlaylistSongList`), which keeps playlist order.
- Overflow menu (operator decisions on q-rh172-phone-header and q-rh172-rename-menu): "Reorder", "Review practice", "Add songs", "Rename playlist" and "Delete playlist" leave the header's top-level action group and become items of a three-dots button (accessible name "More actions", `aria-haspopup="menu"`, `aria-expanded`), at every width. The visible group is then only: Start practice (when the playlist has songs) and the dots button, plus "Done reordering" while reordering. The menu closes on item click, on Escape and on an outside click. "Reorder" is listed when `canReorder` and not while reordering, "Review practice" when `onReviewPractice` is given; "Add songs", "Rename playlist" and "Delete playlist" are always listed, so the dots button is always rendered. Items keep today's accessible names, now as `menuitem`s. Each item runs what its top-level button ran: "Add songs" toggles the song picker panel, "Rename playlist" opens the inline rename editor (the title becomes the input and the whole action group, dots included, is hidden while renaming, as today), "Delete playlist" opens the delete confirmation.
- Delete confirmation from the menu (operator decision on rev-1792033534233): choosing "Delete playlist" closes the menu and opens a confirmation modal over the page, not an inline row. The modal is a `role="dialog"` with `aria-modal="true"` and accessible name "Delete playlist" (via `aria-labelledby` on its heading), a short body ("This deletes the playlist. Its songs stay in your repertoire.") and two buttons, "No" and "Yes, delete". Focus moves to "No" (the safe choice) on open and returns to the dots button on close. Escape, "No" and a backdrop click close it and delete nothing; "Yes, delete" runs the existing delete and redirect, and while it runs the buttons give way to a "Deleting…" `role="status"` spinner so the click cannot be repeated (as the inline `PlaylistDeleteConfirm` does today). The panel state stays `delete-confirm`, so opening the picker or rename replaces it as before. Visual language follows the two existing dialogs (`PracticeReviewList`, `CreatePlaylistModal`): `fixed inset-0 z-30 bg-black/30` backdrop, centred white `rounded-lg shadow-xl` card. No focus-trap helper exists in the codebase, so none is added (Tab is not trapped, matching those dialogs).
- The phone header stays on one row; the wrap-to-second-row layout (old option B of q-rh172-phone-header) is dropped, and the delete confirmation adds no second row, so the header is one row in every state.
- Dashboard in band context: mount the existing `PracticeStart` with `bandId = bandContext.id` (same source menu: Whole repertoire or one of the band's playlists), hidden while the picker is active, like the personal case. `originHref` is `/` because the start came from the dashboard, not `/bands/<id>`.
- `originHref`: `buildPracticeSession` derives it from the owner today (`/bands/<id>` or `/`). Add an optional `originHref` input that overrides the derived one; existing callers pass nothing and keep their behavior.
- Fixed source: `usePracticeStart` gains an optional fixed choice (`PracticeChoice`) and `originHref`; with a fixed choice the button starts directly instead of opening the menu. The playlist header uses this; the existing menu path is unchanged.
- Empty source and errors behave as in RH-168: no queue, no navigation, inline "Nothing to practise here" or the error message.

**Files touched**

- `src/lib/practiceSession.ts`: optional `originHref` override.
- `src/hooks/usePracticeStart.ts`: optional fixed choice and `originHref`, passed through to the session builder.
- `src/components/songs/PracticeStartButton.tsx`: render a plain button (no `aria-haspopup`, no menu) when the controller has a fixed choice.
- `src/components/songs/PracticeStart.tsx`: accept and forward the optional fixed choice and `originHref`.
- `src/components/playlists/PlaylistHeaderMenu.tsx` (new): the three-dots button and its menu (items Reorder, Review practice, Add songs, Rename playlist, Delete playlist; toggle, Escape, outside click). New file so the header does not grow. There is no shared menu component to reuse: `PracticeStartButton` hand-rolls its own and has no outside-click or Escape close, so this one is local and `PracticeStartButton`'s menu is not refactored here.
- `src/components/playlists/PlaylistDeleteModal.tsx` (new): the confirmation dialog. `PlaylistDeleteConfirm` is a private function inside `PlaylistDetailHeader.tsx`, not a shared file, so it is moved out and rewritten as this modal, keeping its `onDelete`/`onCancel` props, its deleting-spinner behaviour and the `.catch(console.error).finally(...)` handling; the inline version is deleted.
- `src/components/playlists/PlaylistDetailHeader.tsx` and `PlaylistDetailView.tsx`: replace the top-level Reorder, Review practice, Add songs (`SongPickerToggle`), Rename and Delete buttons with the menu, keep the "Done" button, render `PlaylistDeleteModal` while the panel is `delete-confirm`, and mount the Start practice slot as a prop (like `onReviewPractice`). The header is 343 lines against the 400 `max-lines` cap and is not in the complexity-ratchet override list; its component function is about 192 of the 200-line cap. Removing five inline buttons (about 60 lines of JSX) and the roughly 40-line `PlaylistDeleteConfirm` makes the file clearly shorter, but the function body must not grow: one JSX line per slot, no new logic. The new modal file stays well under both caps.
- `src/app/playlists/[id]/page.tsx`: inject `PRACTICE_ACTIONS` (F21).
- `src/components/songs/RepertoireDashboard.tsx`: drop the personal-only guard and pass the band id and `/` as origin; mount only, no logic.
- `src/components/playlists/__tests__/practiceReviewHeader.test.tsx`, `playlistReorder.test.tsx`, `playlistHeader.test.tsx` and `PlaylistDetailView.test.tsx`: existing tests that click "Review practice", "Reorder", "Add songs", "Rename playlist" or "Delete playlist" as top-level buttons (`reorderToggle()` helper, ER14, ER20, playlistHeader around lines 101, 181-189 and 197 (any assertion on the inline "Sure?" text now targets the dialog), PlaylistDetailView around lines 194-197, 214 and 227) now open the menu first and query `menuitem`. The `aria-pressed` assertion on "Add songs" cannot survive on a menuitem and becomes an assertion that the song picker panel is shown or hidden.

**Test criteria** (Vitest, node env unless a DOM test opts in)

- `practiceSession.test.ts`: an explicit `originHref` wins over the owner-derived one; without it the RH-168 values are unchanged.
- `usePracticeStart.test.tsx`: with a fixed playlist choice, one start reads that playlist, stores the queue with label = playlist name and the given `originHref`, and pushes the first song's Fast View href; it never opens the menu; no recordPractice, status or update function is called.
- A DOM test for the playlist header: Start practice is absent for an empty playlist, present otherwise, and is a top-level button (not inside the menu).
- A DOM test for the overflow menu: closed by default; none of the five actions is a top-level button; opening lists them as `menuitem`s; each runs its callback and closes the menu; Escape and an outside click close it; with `canReorder` false "Reorder" is not listed and without `onReviewPractice` "Review practice" is not listed, while Add songs, Rename and Delete always are; while `reordering`, "Done reordering" is top-level and "Reorder" is not listed.
- A DOM test for delete from the menu: choosing "Delete playlist" closes the menu and shows a `role="dialog"` named "Delete playlist" containing "No" and "Yes, delete"; focus is on "No"; "No", Escape and a backdrop click remove the dialog and call nothing; "Yes, delete" calls the delete callback once and shows "Deleting…" while pending; focus returns to the dots button after cancel. Choosing "Rename playlist" shows the name input and hides the action group.
- Updated existing tests (above) keep their assertions and only change how they reach the control. `complexityBudget.test.ts` keeps passing: no new override entry.
- A DOM test for the dashboard: in band context the button is rendered and starts with the band id; it is hidden while the picker is active.

**Phone layout.** The operator chose to keep the header on one row with every secondary action in the three-dots menu (B on q-rh172-rename-menu). At 375px the row holds back arrow, title, Start practice (about 110px) and one dots button, so the title gets roughly 170px (about 18 characters) instead of about 6. The Start practice button uses the solid emerald style of `PracticeStartButton`. The delete confirmation is a modal, so it never competes with the title for room.

UI change: a mock (`docs/tasks/RH-172-mock.html`) shows the header with the new button and the menu, closed and open, at phone and desktop width, plus the interactive delete confirmation modal (open, No, Escape, backdrop, Yes).

## Expected Results

- [ ] On `/playlists/[id]` with at least one song, "Start practice" stores a `songQueue` in `orderForPractice` order, labelled with the playlist's name and `originHref` `/playlists/<id>`, and opens Fast View on the first song.
- [ ] A start from a band playlist records owner `band` with the playlist's band id and opens Fast View with `?bandId=<id>`; a start from a personal playlist records owner `personal`.
- [ ] The "Start practice" button is a top-level header button on a playlist with songs and is not rendered on a playlist with no songs.
- [ ] In the playlist header "Reorder", "Review practice", "Add songs", "Rename playlist" and "Delete playlist" are `menuitem`s of a three-dots "More actions" menu and none is a top-level button.
- [ ] Choosing "Delete playlist" from the menu closes it and opens a confirmation modal (`role="dialog"` named "Delete playlist"); "No", Escape and a backdrop click delete nothing and "Yes, delete" calls the existing delete.
- [ ] The existing header, reorder, review-practice and detail-view tests pass after being changed only to open the menu first.
- [ ] On the dashboard in band context, "Start practice" is rendered, hidden while the song picker is active, and a start records owner `band` and `originHref` `/`.

Covered by the test criteria above rather than as results: menu items hidden by `canReorder` / `onReviewPractice` / `reordering`, "Rename playlist" and "Add songs" from the menu behaving as the old buttons, the explicit `originHref` override in `practiceSession.test.ts`, the band dashboard source menu listing Whole repertoire and the band's playlists, an empty source storing no queue and showing the inline message, the menu closing on Escape and outside click, and neither new entry point calling a `last_practiced` or status write.

## Out of Scope

Buttons on the playlists index, bands index, Fast View or any other screen listed as Out above; any change to ordering, queue shape, Fast View, the hand-picked flow or the end-of-session flow; changing what Reorder, Review practice, Add songs, Rename or Delete do; refactoring `PracticeStartButton`'s menu into a shared component.
