# RH-149 — Play a song's audio while reading its chart

## Scope

The request was the single word "player". This spec **does not choose** what that word means. It records the candidate readings, the hard limits attached to each, and the mock that lets the operator choose at `spec_approval`. `expected_results` stay empty until the choice is made.

Mock: `docs/tasks/RH-149-mock.html` — seven panels on the real Fast View, side by side, labelled 0 and A–F. Open the file directly; an Online/Offline toggle at the top previews the offline state.

**Operator decision (spec_review):** uploaded audio (panel C) needs its own task, whose spec settles the open questions (offline, player, ownership, quota). It is removed from this task; see "Separate task: uploaded audio" below. Which of the remaining readings stays here is still open.

Not in scope: any code, migration, scope change or dependency. Nothing is built from this document until a reading is picked and the task is re-specified (or split).

## Grounding (verified at `51bba28`)

- No audio of any kind exists in `src/` (no `<audio>`, Howler, `AudioContext`, metronome, `playbackRate`). No tempo field is used.
- Spotify OAuth requests only `playlist-read-private`, `playlist-modify-public`, `playlist-modify-private`, `user-read-private` (`src/app/api/auth/spotify/authorize/route.ts:33-38`). The app cannot start, stop or observe playback.
- `song_links.provider` already distinguishes `spotify` / `youtube` / `other`; `spotifyTrackUriFromUrl` returns a track uri for `/track/` urls and `null` for `spotify.link`, `spoti.fi` and the `spotify:` scheme.
- `song_files` is per-musician with no `band_id`; Fast View's composition root (`page.tsx`) holds no state, so any new behaviour lands as a lib function + hook + component.

## Candidate readings (choice left open)

| Panel | Reading | Depends on | Hard limits shown in the mock |
|---|---|---|---|
| 0 | Today, no player | — | — |
| A | Reading 1a: Spotify embed/SDK of the song's own linked track | a Spotify `/track/` link | Premium required; new scopes `streaming`, `user-read-playback-state`, `user-modify-playback-state`; re-consent of every connected user; short links unsupported; online only; autoplay needs a tap |
| B | Reading 1b: YouTube embed of the song's own linked video | a YouTube link | online only; autoplay needs a tap; third-party iframe (CSP, ads); no Premium or scope constraint |
| C | **Split out to its own task.** Reading 2: own audio (uploaded backing/reference track) via `<audio>` | — | personal not shared in band context; audio size/quota in Vercel Blob; offline only if the snapshot includes audio; autoplay needs a tap |
| D | Reading 3: practice transport (loop, slow, count-in) | reading C | only over app-controlled audio; loop storage; autoplay needs a tap |
| E | Reading 4: click track / metronome | schema change (tempo on `songs`) | who may edit tempo in a wiki-style catalog; works offline; autoplay needs a tap |
| F | Reading 5: setlist player over the RH-133 queue | an audio source from A, B or C | not standalone; player must outlive route changes; autoplay needs a tap |

The readings are different features sharing a word. A and B share placement and differ in constraints; D builds on C; F builds on one of A–C; E is independent. The honest outcome of the gate may be one reading kept in this task and the others filed separately.

## Separate task: uploaded audio (panel C, split out)

Its spec, written when that task reaches spec generation, must settle:

- **Offline**: whether the downloaded snapshot includes audio; if so, the storage budget and eviction, and what Fast View shows offline when a file is not downloaded.
- **Ownership in band context**: `song_files` is per-musician with no `band_id`; decide whether band audio is shared, uploader-only, or needs a new ownership model.
- **Size and quota**: per-file cap, per-user quota, accepted formats, Vercel Blob cost.
- **Player behaviour**: the `<audio>` bar's controls, tap-to-start (no autoplay), behaviour on route change and with the wake lock, and whether it is the base for panel D (practice transport) and F (setlist player).

Panels D and F depend on an audio source (C, or A/B for F) and stay blocked until one exists. Panels A, B and E are independent of the upload task.

## Approach

Deferred. Once a reading is chosen, re-specify it against its panel: behavior, files touched (a lib function, a controller hook and a presentational component under `src/components/fastview/`, injected at `page.tsx`, never added to the page itself) and test criteria. Offline must be stated honestly per reading: Fast View is read-only offline and must not promise playback it cannot deliver.

## Expected Results

Intentionally empty pending the operator's choice. Each reading yields its own set (see the report for the shape).

## Out of Scope

Choosing a reading on the operator's behalf; implementing any reading; changing Spotify scopes before the Premium and re-consent questions are decided.
