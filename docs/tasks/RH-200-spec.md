# RH-200 — Restart current song on player previous click unless near the beginning

## Scope
This task gives the setlist player's Previous control (`|<<`) the standard media-player convention:
- After more than 3 seconds (> 3000 ms) of playback of the current song, Previous restarts that song from 0:00. The queue index does not change and the 5-second countdown does not appear.
- Within the first 3 seconds (<= 3000 ms), Previous steps to the prior song in the queue, as it does today. That includes the countdown before the prior song starts.
- At queue index 0 there is no prior song. Previous is enabled there whenever the first song is loaded, and it always restarts that song from 0:00.
- `SetlistEngine` gains a `seek` method, implemented by the audio, YouTube and Spotify engines.

Out of scope:
- The Next (`|>>`) control.
- A scrubber, progress bar or elapsed-time display in the player bar.
- Fast View lyrics, chords or tab stage navigation.
- Database schema and server actions.

## Approach

### Behavior
- **Engine seek.** `SetlistEngine.seek(seconds)` moves the loaded source to `seconds` and never changes whether it is playing:
  - audio sets `el.currentTime = seconds`;
  - YouTube calls `player.seekTo(seconds, true)`;
  - Spotify calls a new `seekSpotify(Math.round(seconds * 1000))` in `spotifyWebPlayback`, which calls the SDK player's optional `seek(positionMs)`.
- **Elapsed time.** `SetlistRuntime` keeps the current song's elapsed playing time:
  - It counts only the time the store status is `'playing'`. Time spent paused, refused or in the countdown does not count.
  - It resets to 0 whenever `runFrom` begins (start, Next, Previous step, `ended`, `error`) and whenever a restart happens.
  - It reads the wall clock (`Date.now()`), so `vi.useFakeTimers()` with `vi.advanceTimersByTime` drives it in tests.
- **`prev()` decides between restart and step:**
  - It **restarts** when all of these hold: the player is online; no countdown is running (`store().countdown === null`); an engine is active; the store status is `'playing'` or `'paused'`; and either the elapsed time is > 3000 ms or the index is 0.
  - In every other case it **steps** through the existing `step(-1)`, unchanged: the target is `index - 1`, the countdown runs, and the step is a no-op at index 0.
- **A restart:**
  - calls `engine.seek(0)` and resets the elapsed time;
  - keeps the queue index, starts no countdown, does not call `onSongChange`, and does not bump `this.run`.
  - **When the status is `'playing'`:** it does nothing else. It does not call `tryPlay` or `engine.play()`, and the status stays `'playing'`. Each engine keeps playing through a seek on its own. Calling `play()` here would hang YouTube: `playVideo()` on a video that is already playing emits no `STATE_PLAYING`, so `withTimeout` would reject after `refusalMs` and leave the entry paused with "Tap to play".
  - **When the status is `'paused'`** (a refused entry included): it calls `tryPlay(engine, this.run)` once after the seek. Success and refusal are handled as they are when `toggle()` resumes a paused entry.
- **Enabling Previous.** `useSetlistPlayer` computes `hasPrev` as `index > 0 || ((status === 'playing' || status === 'paused') && countdown === null)`, replacing `state.index > 0`. The button's markup is unchanged: it stays disabled while offline, and at index 0 while stopped, idle or counting down.

### Files Touched
- `src/hooks/setlistEngines/types.ts`: adds `seek: (seconds: number) => void` to `SetlistEngine`.
- `src/lib/spotifyWebPlayback.ts`: adds the optional `seek?(positionMs)` to `SdkPlayer`, and exports `seekSpotify(positionMs)`.
- `src/hooks/setlistEngines/audioEngine.ts`: adds `seek` through `el.currentTime`.
- `src/hooks/setlistEngines/youtubeEngine.ts`: adds `seekTo` to `YtPlayer`, and adds `seek` through `player.seekTo(seconds, true)`.
- `src/hooks/setlistEngines/spotifyEngine.ts`: adds `seek` through `seekSpotify`.
- `src/hooks/setlistEngines/runtime.ts`: adds the elapsed-time tracking and the restart/step branch in `prev()`.
- `src/hooks/useSetlistPlayer.ts`: switches `hasPrev` to the rule above.
- `src/components/layout/SetlistPlayer.tsx`: no change. Its Previous button already renders `disabled={!c.hasPrev || c.offline}`, so the new `hasPrev` reaches it as is.
- `src/hooks/__tests__/setlistEngines.test.ts`: adds `seek` cases for the audio, YouTube and Spotify engines.
- `src/lib/__tests__/spotifyWebPlayback.test.ts`: adds a `seekSpotify` case.
- `src/components/layout/__tests__/SetlistPlayer.test.tsx`: adds `seek: vi.fn()` to the fake engines and the fake-timer cases below.

### Test Criteria
All `SetlistPlayer.test.tsx` cases use fake timers and YouTube fakes, so `seek` and `play` are spies.
- **Restart while playing.** Host with `countdownMs={5000}`, tap `two`, advance 5000 ms, then advance 3500 ms. Clicking Previous calls `seek(0)` once. The counter still reads `2 / 4`. No `Setlist countdown` dialog is rendered. `play` has not been called again, and the toggle still reads `Pause`.
- **Restart while paused.** Play `two` for 3500 ms, click Pause, then Previous. This calls `seek(0)` and one more `play`, and the toggle reads `Pause` again.
- **Step within threshold.** Play `two` for 1500 ms. Clicking Previous moves the counter to `1 / 4` and does not call `seek`.
- **Paused time is not counted.** Play `two` for 2000 ms, pause, wait 5000 ms, resume, and play 500 ms more. Previous steps to `1 / 4`, because only 2500 ms were spent playing.
- **Index 0.** At `1 / 4` and playing, the Previous button is enabled. Clicking it at 1000 ms calls `seek(0)`, and the counter stays `1 / 4`.
- The existing "next control and previous control move through the queue" test keeps passing unchanged.
- **Engine tests.**
  - The audio `seek(0)` sets `currentTime` to 0.
  - The YouTube `seek(0)` calls `seekTo(0, true)`.
  - The Spotify `seek(1.5)` calls `seekSpotify(1500)`.
  - `seekSpotify(1500)` calls the SDK player's `seek(1500)`, and is a no-op before a player exists.

## Behavior changes
- added: Fast View and queue — The setlist player's previous control restarts the current song from 0:00, with no countdown, after more than 3 seconds of playback or on the first song; within the first 3 seconds it steps to the prior song. (RH-200)
- changed: Fast View and queue — The setlist player shows a full-screen 5-second countdown overlay with the upcoming title and a skip control before each song starts, but not when the previous control restarts the current song. (RH-200)

## Operator Results Coverage
- Operator Result 1 ("Clicking Previous (|<<) when the current song has been playing for more than 3 seconds restarts the current song from 0:00 without decrementing the queue index.") is covered by Approach § Behavior (restart) and Expected Result 1.
- Operator Result 2 ("Clicking Previous (|<<) within the first 3 seconds of playback steps to the previous song in the queue.") is covered by Approach § Behavior (step) and Expected Result 2.
- Operator Result 3 ("When restarting the current song, playback restarts immediately without re-triggering the 5-second countdown.") is covered by Approach § Behavior (restart while playing and while paused) and Expected Result 3.
- Operator Result 4 ("The 3-second threshold and restart behavior works across audio, YouTube, and Spotify setlist engines.") is covered by Approach § Behavior (engine seek), Files Touched and Expected Result 5.
- Operator Result 5 ("A Vitest fake-timer test asserts that Previous at >3000 ms seeks to 0 and keeps index, while Previous at <=3000 ms decrements index.") is covered by Approach § Test Criteria and Expected Result 6.

## Expected Results
- [ ] Clicking Previous after more than 3000 ms of playback calls `seek(0)` on the active engine and the counter keeps its value.
- [ ] Clicking Previous within the first 3000 ms of playback moves the counter to the prior entry.
- [ ] A restart shows no countdown dialog, calls `play` again only when the player was paused, and leaves the toggle reading `Pause`.
- [ ] At `1 / N` with a song playing or paused, the Previous button is enabled and clicking it calls `seek(0)` without changing the counter.
- [ ] The audio, YouTube and Spotify engines each implement `seek`, and `setlistEngines.test.ts` asserts `currentTime = 0`, `seekTo(0, true)` and `seekSpotify(1500)`.
- [ ] `SetlistPlayer.test.tsx` fake-timer tests pass, asserting Previous at 3500 ms seeks to 0 and keeps the index, and Previous at 1500 ms decrements it.

Mockup: `docs/tasks/RH-200-mock.html`.
