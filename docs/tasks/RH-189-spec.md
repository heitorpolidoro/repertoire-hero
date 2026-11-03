# RH-189 — Show a big 5-second countdown before each song in the setlist player

## Scope

The "Play setlist" player (RH-167) advances through the queue immediately after each song or on initial start. This task introduces a prominent, full-screen 5-second countdown before each song's playback and content become active in Fast View, giving musicians time to get ready.

Covers:
- A full-screen countdown overlay displaying 5, 4, 3, 2, 1 at 1-second intervals before each song starts (including the first song upon tapping "Play setlist" and subsequent songs as the player advances).
- Displaying the upcoming song title and artist prominently in the overlay.
- Large countdown typography, occupying at least 30% of the viewport height (`text-[30vh]`), readable on a 375 px mobile viewport without horizontal overflow or truncation.
- A "Skip countdown" control with accessible name `"Skip countdown"` that immediately dismisses the overlay and starts playback.
- A "Cancel countdown" control with accessible name `"Cancel countdown"` that cancels the countdown and closes the player.
- Fast View auto-navigation: when advancing or stepping while in Fast View, the route updates to the upcoming song via `router.replace` behind the overlay.
- Overlay occlusion and activation: the full-screen overlay intercepts pointer events so Fast View controls cannot be clicked during the countdown; playback is initiated only when countdown reaches zero or Skip is clicked.
- Playback unlocking and refusal handling: priming during the initial tap and direct activation on Skip, with graceful fallback to RH-167 refusal state ("Tap to play <title>") if delayed playback is refused by the browser.
- Safe cancellation: closing or dismissing the player during countdown clears any active timer.
- Comprehensive Vitest fake-timer unit tests and a Playwright E2E spec.

Does not cover:
- Configurable countdown durations (fixed at 5 seconds).
- Audio metronome or click track during the countdown (visual only).
- Offline setlist playback (setlist player remains disabled offline per RH-167).
- Changes to source resolution precedence (uploaded audio -> Spotify -> YouTube).

## Approach

### Behavior
- **Countdown initiation and playback unlocking**:
  - When the player starts (`start`) or advances (`runFrom`) to a playable entry, a 5-second countdown is initiated (`countdown = 5`) instead of immediate playback.
  - On the initial "Play setlist" user tap, the active engine is initialized and primed synchronously within the user gesture (for HTMLAudioElement, loading or setting source; for Spotify/YouTube, preparing the engine host).
  - Tapping "Skip countdown" is a direct user gesture that immediately invokes `engine.play()` in the click handler.
  - When the countdown reaches zero without user interaction, `engine.play()` is invoked. If the browser or provider (iOS Safari, Spotify SDK, or YouTube) refuses unprompted playback outside a user gesture, the rejection is caught and handled via RH-167's established refusal flow: the player enters paused state with `refused: true`, displaying "Tap to play <title>" in the player bar, without erroring or skipping the song.
- **Overlay presentation**:
  - While countdown is running (`countdown !== null`), a full-screen overlay (`fixed inset-0 z-50 flex flex-col items-center justify-between bg-black/90 backdrop-blur-md text-white pointer-events-auto`) completely covers the viewport.
  - It renders above both Fast View content and the persistent player bar (`z-40`).
  - Center: countdown number (5 down to 1) at `text-[30vh]` (at least 30% viewport height), centered and readable on a 375 px screen without horizontal overflow or clipping.
  - Below the number: upcoming song title (`text-xl font-bold truncate`) and artist line (`text-sm text-gray-300 truncate`).
  - Header: a dismiss button with accessible name `"Cancel countdown"` and visible text "Cancel" that aborts the countdown and closes the setlist player via `dismiss()`.
  - Footer: a primary button with accessible name `"Skip countdown"` and visible text "Skip countdown" that immediately dismisses the countdown and begins song playback.
- **Occlusion and activation**:
  - The overlay intercepts all pointer and touch events, preventing user interaction with underlying Fast View controls (lyrics, chords, tabs, tuning, or stage mode overlays) while countdown is running.
  - The setlist player bar (`z-40`) is occluded by the overlay (`z-50`), so the bar's play, next, prev, and close buttons cannot be reached by pointer. Calling `toggle()` programmatically or via keyboard while countdown is running cancels the countdown and pauses the player.
  - Fast View's embedded `YoutubeEmbed` never autoplays (per RH-163) and remains covered.
  - When the countdown reaches zero or "Skip countdown" is clicked, the countdown clears (`countdown = null`), the overlay unmounts/hides, pointer events reach Fast View, and the setlist engine initiates playback.
- **Fast View synchronization and navigation**:
  - When advancing (`ended` or unplayable source `error`) or stepping (`next()` / `prev()`), the setlist player notifies an `onSongChange(versionId, bandId)` listener.
  - In `AppShell`, when the user is on a Fast View route (`pathname.includes('/fast-view')`), `onSongChange` calls `router.replace(fastViewHref(versionId, bandId))`.
  - Using `router.replace` updates the URL and loads the upcoming song behind the countdown overlay without adding entries to the browser history stack, preserving history depth so that browser Back and the Fast View Back button continue returning to the playlist origin (`queue.origin`).
  - If the player starts on the song already on screen, `onSongChange` does not trigger navigation (no-op).
  - During countdown, touch swipes are intercepted by the overlay, and keyboard navigation (`ArrowLeft` / `ArrowRight`) is ignored while the countdown overlay is visible.
- **One-second intervals and cancellation**:
  - The timer ticks at 1000 ms intervals: 5, 4, 3, 2, 1. At 0, the countdown clears and playback is triggered.
  - Tapping "Cancel countdown" or calling `dismiss()`, `dispose()`, or `reset()` clears the timer interval (`clearInterval`) and sets `countdown: null` without calling `engine.play()`.
  - Stepping via `next()` or `prev()` clears the existing timer and starts a fresh 5-second countdown for the destination song.
  - Songs without a playable source are skipped immediately per RH-167; countdown begins only once a playable song is reached.

### Files touched
- `src/store/setlistPlayerStore.ts`: Add `countdown: number | null` to state, include `countdown` in `patch`'s `Pick<...>` union, and reset to `null` on `reset()` and `begin()`.
- `src/hooks/setlistEngines/runtime.ts`: Manage the countdown timer, element priming, and ticks in `runFrom` before engine playback; support `countdownMs?: number` (default 5000; existing real-timer tests pass 0); clear timer and reset countdown on `skipCountdown()`, `cancelCountdown()`, `setOffline(true)`, dismiss, or dispose.
- `src/hooks/useSetlistPlayer.ts`: Pass `countdownMs` to runtime deps; expose `countdown`, `skipCountdown`, and `cancelCountdown` on `SetlistPlayerController`; accept an `onSongChange` callback to notify listeners when the active song changes.
- `src/components/layout/SetlistPlayer.tsx`: Render the full-screen countdown overlay when `countdown !== null`, displaying the upcoming title, artist, `text-[30vh]` countdown number, `"Cancel countdown"` button, and `"Skip countdown"` button.
- `src/app/AppShell.tsx`: Supply `onSongChange` to `useSetlistPlayer` to navigate Fast View via `router.replace(fastViewHref(versionId, bandId))` when currently on a Fast View route.
- `src/components/layout/__tests__/SetlistPlayer.test.tsx`: Vitest tests using `vi.useFakeTimers()` asserting 5 ticks, completion at 0 triggering play, skip button action, dismiss/cancel action, offline clearing, and refusal fallback handling; existing real-timer tests pass `countdownMs: 0`.
- `e2e/fast-view-queue.spec.ts`: Playwright test verifying countdown overlay appearance, title and artist display, font size at least 30% of viewport height, pointer occlusion, and Skip countdown button dismissal on a playlist queue with uploaded audio.
- `docs/behavior.md`: Record new setlist player countdown and auto-navigation behavior under `Fast View and queue`.

### Test criteria
- `SetlistPlayer.test.tsx` (Vitest, jsdom, fake timers):
  - Starting the player renders the countdown overlay showing "5", the upcoming song title, and artist; engine `play()` is not called.
  - Advancing fake timers by 1000 ms updates the number to "4", then sequentially to "3", "2", and "1".
  - Advancing the final 1000 ms (5000 ms total) dismisses the overlay and invokes engine `play()`.
  - If engine `play()` rejects after countdown, the player transitions to paused with `refused: true` showing "Tap to play <title>".
  - Clicking `"Skip countdown"` during countdown dismisses the overlay immediately and calls engine `play()`.
  - Clicking `"Cancel countdown"` during countdown clears the timer and leaves countdown at `null`, without calling engine `play()`.
  - Calling `toggle()` during countdown cancels the timer and sets status to paused.
  - Stepping with `next()` or `prev()` during countdown clears the active timer and starts a fresh countdown for the destination song.
- Playwright E2E spec:
  - Navigating to Fast View from a playlist, opening the setlist drawer, and clicking "Play setlist" opens the full-screen overlay.
  - Asserts upcoming song title and artist are visible in the overlay, and countdown number element height or font size matches at least 30% of viewport height.
  - Asserts the overlay intercepts clicks, preventing underlying Fast View content from being clicked.
  - Clicks `"Skip countdown"` and asserts the countdown overlay is dismissed/hidden and Fast View controls become interactive.

## Behavior changes
- added: Fast View and queue — The setlist player automatically navigates Fast View to each upcoming song in the queue via router.replace when advancing or stepping. (RH-189)
- added: Fast View and queue — The setlist player shows a full-screen 5-second countdown overlay with the upcoming title and a skip control before each song starts. (RH-189)

## Expected Results
- [ ] When the setlist player moves to a song, including the first one, a full-screen countdown overlay shows 5, 4, 3, 2, 1 at one-second intervals.
- [ ] The countdown number is rendered large, at least 30% of the viewport height, and is readable on a 375 px wide viewport without truncation or horizontal overflow.
- [ ] The full-screen countdown overlay intercepts pointer interaction with underlying Fast View content, and setlist engine playback is initiated only after the countdown reaches zero or Skip countdown is clicked.
- [ ] The countdown overlay displays the title and artist of the upcoming song.
- [ ] A "Skip countdown" control dismisses the countdown overlay immediately and initiates song playback.
- [ ] Dismissing or canceling the player during the countdown cancels it, leaving no timer or interval running.
- [ ] A Vitest test with fake timers asserts the 5 ticks and start after the fifth, and a Playwright test covers the overlay display, large typography, and Skip countdown control.

## Operator Results Coverage
- Operator Result 1 ("When the setlist player moves to a song, including the first one, a full-screen countdown overlay shows 5, 4, 3, 2, 1 at one-second intervals.") is covered by Approach § Behavior and Expected Result 1.
- Operator Result 2 ("The countdown number is rendered large, at least 30% of the viewport height, and is readable on a 375 px wide viewport.") is covered by Approach § Overlay presentation and Expected Result 2.
- Operator Result 3 ("The song's content in Fast View becomes active only after the countdown reaches zero.") is covered by Approach § Occlusion and activation and Expected Result 3.
- Operator Result 4 ("The overlay shows the title of the upcoming song.") is covered by Approach § Overlay presentation and Expected Result 4.
- Operator Result 5 ("A 'Skip' control dismisses the countdown immediately and starts the song.") is covered by Approach § Overlay presentation, Approach § Behavior, and Expected Result 5.
- Operator Result 6 ("Leaving the player during the countdown cancels it, with no timer left running.") is covered by Approach § One-second intervals and cancellation and Expected Result 6.
- Operator Result 7 ("A Vitest test with fake timers asserts the 5 ticks and the start after the fifth, and a Playwright test covers the overlay and Skip.") is covered by Approach § Test criteria and Expected Result 7.

## Out of Scope
- Customizable countdown duration or sound effects / metronome audio clicks.
- Offline playback of setlist audio (remains blocked offline per RH-167).
- Automatic looping, crossfading, or tempo changes.
