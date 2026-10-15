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

Covers: a "Start practice" button on the playlist detail page that starts a session from that playlist, and the existing `PracticeStart` control on the dashboard in band context.

Does not cover: any change to the ordering (`practiceOrder.ts`), the queue shape (`songQueue.ts`), Fast View, the hand-picked flow, or the end-of-session flow. No write: starting stays read-only, as in RH-168.

## Approach

**Behavior**

- Playlist detail: a "Start practice" button in `PlaylistDetailHeader`'s action group, next to "Review practice", shown only when the playlist has at least one song. One tap starts a session from this playlist (no source menu): candidates are read with the existing `getCandidates({kind:'playlist', playlistId}, bandId)`, where `bandId` is `playlist.band_id` (null for a personal playlist), ordered by `orderForPractice`, and written with `writeSongQueue`. Owner is `band` or `personal` from `playlist.band_id`; `label` is the playlist's name; `originHref` is `/playlists/<id>` so Back from Fast View returns to the playlist. Then it opens Fast View on the first song (with `?bandId=<id>` for a band playlist). It is distinct from the existing play-through (`openFastView` in `PlaylistSongList`), which keeps playlist order.
- Dashboard in band context: mount the existing `PracticeStart` with `bandId = bandContext.id` (same source menu: Whole repertoire or one of the band's playlists), hidden while the picker is active, like the personal case. `originHref` is `/` because the start came from the dashboard, not `/bands/<id>`.
- `originHref`: `buildPracticeSession` derives it from the owner today (`/bands/<id>` or `/`). Add an optional `originHref` input that overrides the derived one; existing callers pass nothing and keep their behavior.
- Fixed source: `usePracticeStart` gains an optional fixed choice (`PracticeChoice`) and `originHref`; with a fixed choice the button starts directly instead of opening the menu. The playlist header uses this; the existing menu path is unchanged.
- Empty source and errors behave as in RH-168: no queue, no navigation, inline "Nothing to practise here" or the error message.

**Files touched**

- `src/lib/practiceSession.ts`: optional `originHref` override.
- `src/hooks/usePracticeStart.ts`: optional fixed choice and `originHref`, passed through to the session builder.
- `src/components/songs/PracticeStartButton.tsx`: render a plain button (no `aria-haspopup`, no menu) when the controller has a fixed choice.
- `src/components/songs/PracticeStart.tsx`: accept and forward the optional fixed choice and `originHref`.
- `src/components/playlists/PlaylistDetailHeader.tsx` and `PlaylistDetailView.tsx`: mount the control only; `PlaylistDetailHeader` is 343 lines, so the slot is a prop (like `onReviewPractice`), not new logic in the header.
- `src/app/playlists/[id]/page.tsx`: inject `PRACTICE_ACTIONS` (F21).
- `src/components/songs/RepertoireDashboard.tsx`: drop the personal-only guard and pass the band id and `/` as origin; mount only, no logic.

**Test criteria** (Vitest, node env unless a DOM test opts in)

- `practiceSession.test.ts`: an explicit `originHref` wins over the owner-derived one; without it the RH-168 values are unchanged.
- `usePracticeStart.test.tsx`: with a fixed playlist choice, one start reads that playlist, stores the queue with label = playlist name and the given `originHref`, and pushes the first song's Fast View href; it never opens the menu; no recordPractice, status or update function is called.
- A DOM test for the playlist header: the button is absent for an empty playlist and present otherwise.
- A DOM test for the dashboard: in band context the button is rendered and starts with the band id; it is hidden while the picker is active.

UI change: a mock (`docs/tasks/RH-172-mock.html`) of the playlist header with the new button next to "Review practice" is needed before implementation, at narrow (phone) and desktop width, since the header's action group is already crowded on a phone.

## Expected Results

- [ ] On `/playlists/[id]` with at least one song, "Start practice" stores a `songQueue` of that playlist's songs in `orderForPractice` order, labelled with the playlist's name, and opens Fast View on the first song.
- [ ] A session started from a band playlist records owner `band` with the playlist's band id and opens Fast View with `?bandId=<id>`; one from a personal playlist records owner `personal`.
- [ ] Back from Fast View after a start on the playlist page returns to `/playlists/<id>`.
- [ ] On a playlist with no songs the "Start practice" button is not shown.
- [ ] On the dashboard in band context, "Start practice" is shown (hidden while the picker is active) and its menu offers Whole repertoire and the band's playlists; a start records owner `band` and `/` as `originHref`.
- [ ] The existing starts on `/bands/[id]` and the personal dashboard keep their `originHref` values (`/bands/<id>` and `/`).
- [ ] Starting from either new entry point issues no `last_practiced` or status write, asserted by a test on the injected actions.
- [ ] An empty source stores no queue, does not navigate and shows the inline message.

## Out of Scope

Buttons on the playlists index, bands index, Fast View or any other screen listed as Out above; any change to ordering, queue shape, Fast View, the hand-picked flow or the end-of-session flow.
