# RH-189 — Spec Generator Report (Revision Round 2)

## Summary of Work Done

1. **Addressed Spec Review Findings**:
   - **Finding 1 — Playback unlock & delayed play() conflict**:
     - Clarified that on the initial user tap ("Play setlist"), the active engine element is initialized and primed synchronously within the user gesture.
     - Tapping the "Skip countdown" button is a direct user gesture that initiates immediate playback.
     - For unprompted completion of the 5-second countdown timer outside the user gesture, if the browser or media provider (e.g. iOS Safari, Spotify Web Playback SDK, or YouTube) refuses delayed playback without a fresh gesture, this is caught and safely handled via RH-167's established refusal flow: the player enters paused state with `refused: true` and displays "Tap to play <title>" in the bar without crashing or skipping the track.
   - **Finding 2 — Fast View auto-navigation & Behavior changes**:
     - Added the missing auto-navigation line to `## Behavior changes` alongside the countdown overlay line:
       - `added: Fast View and queue — The setlist player automatically navigates Fast View to each upcoming song in the queue via router.replace when advancing or stepping. (RH-189)`
       - `added: Fast View and queue — The setlist player shows a full-screen 5-second countdown overlay with the upcoming title and a skip control before each song starts. (RH-189)`
     - Specified exact timing and mechanics for `onSongChange`:
       - Starting on the song currently on screen in Fast View is a no-op (no route push/replace).
       - Advancing (`ended` / unplayable source `error`) or stepping (`next()` / `prev()`) triggers `onSongChange(versionId, bandId)`.
       - In Fast View, navigation uses `router.replace(fastViewHref(versionId, bandId))` rather than `router.push`, preventing browser history pollution so that Back continues returning to the playlist origin (`queue.origin`).
       - During countdown, touch swipes are intercepted by the overlay, and keyboard navigation (`ArrowLeft` / `ArrowRight`) is ignored while the countdown overlay is visible.
   - **Finding 3 — Defining "active" mechanically**:
     - Clarified the mechanical definition of "active":
       - During countdown (ticks 5..1): The countdown overlay (`fixed inset-0 z-50 pointer-events-auto`) sits above Fast View and intercepts all pointer/touch input, preventing interaction with underlying controls (lyrics, chords, tabs, tuning, and stage overlays). The setlist engine's `play()` is not invoked. Fast View's embedded `YoutubeEmbed` never autoplays and remains covered.
       - Reaching zero or clicking "Skip countdown": The overlay unmounts/hides, pointer events reach Fast View controls, and `engine.play()` is invoked.
       - Rewrote Expected Result 3 and test criteria to use these concrete assertions for Vitest and Playwright.
   - **Finding 4 — Overlay controls, accessible names, and mock alignment**:
     - Specified exact accessible names for the overlay controls:
       - Skip button: accessible name `"Skip countdown"`.
       - Cancel/dismiss button: accessible name `"Cancel countdown"`.
     - Specified that the persistent player bar (`z-40`) is occluded by the overlay (`z-50`), preventing pointer interaction with bar buttons. Programmatic/keyboard `toggle()` during countdown cancels the timer and pauses the player.
     - Clarified that the artist line below the title is in scope, sourced from `SongQueueEntry.artist`.
     - Updated `docs/tasks/RH-189-mock.html` to include matching `aria-label="Cancel countdown"` and `aria-label="Skip countdown"`.

2. **Updated Spec & Operator Coverage**:
   - Updated `docs/tasks/RH-189-spec.md` with all clarified behaviors, files touched, test criteria, behavior registry changes, and operator coverage mapping.
   - Refined the 7 Expected Results to be strictly verifiable, single-sentence assertions matching operator intent.

## Behavior Changes

- added: Fast View and queue — The setlist player automatically navigates Fast View to each upcoming song in the queue via router.replace when advancing or stepping. (RH-189)
- added: Fast View and queue — The setlist player shows a full-screen 5-second countdown overlay with the upcoming title and a skip control before each song starts. (RH-189)

## Artifacts Updated

- Spec: `docs/tasks/RH-189-spec.md`
- Mockup: `docs/tasks/RH-189-mock.html`
- Report: `docs/tasks/RH-189-spec-report.md`

## Expected Results

EXPECTED_RESULTS:
When the setlist player moves to a song, including the first one, a full-screen countdown overlay shows 5, 4, 3, 2, 1 at one-second intervals.
The countdown number is rendered large, at least 30% of the viewport height, and is readable on a 375 px wide viewport without truncation or horizontal overflow.
The full-screen countdown overlay intercepts pointer interaction with underlying Fast View content, and setlist engine playback is initiated only after the countdown reaches zero or Skip countdown is clicked.
The countdown overlay displays the title and artist of the upcoming song.
A "Skip countdown" control dismisses the countdown overlay immediately and initiates song playback.
Dismissing or canceling the player during the countdown cancels it, leaving no timer or interval running.
A Vitest test with fake timers asserts the 5 ticks and start after the fifth, and a Playwright test covers the overlay display, large typography, and Skip countdown control.

MOCK_PATH: docs/tasks/RH-189-mock.html
