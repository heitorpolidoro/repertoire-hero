# Spec Generator Report: RH-200 (revision round 2)

**Task**: RH-200 — Restart current song on player previous click unless near the beginning
**Verdict**: SPEC_READY
**Spec**: `docs/tasks/RH-200-spec.md`
**Mock**: `docs/tasks/RH-200-mock.html`

## Findings addressed

### 1. `hasPrev` at index 0 and the missing controller and UI files
The finding is accurate. `src/hooks/useSetlistPlayer.ts:109` hardcodes `hasPrev: state.index > 0`, and `src/components/layout/SetlistPlayer.tsx:121` renders `disabled={!c.hasPrev || c.offline}`. Track 1 could therefore never use Previous to restart. The round 1 mock also had an unreachable branch: its button was disabled at index 0 whenever the song was within 3 s, yet it had an "index 0 and <= 3 s" handler.

What the spec decides now:
- At index 0, Previous **always restarts** the first song (`seek(0)`), whatever the elapsed time. There is no prior song to step to. This matches Spotify and Apple Music, which also restart on the first track.
- `hasPrev = index > 0 || ((status === 'playing' || status === 'paused') && countdown === null)`. This needs no timer-driven re-render to follow the 3 s threshold, because enablement at index 0 never depends on the elapsed time. Index 0 stays disabled while stopped, idle or counting down. The countdown overlay covers the bar during a countdown in any case.
- `src/hooks/useSetlistPlayer.ts` is now in Files Touched.
- `src/components/layout/SetlistPlayer.tsx` is listed explicitly as unchanged, with the reason: it already reads `hasPrev`, and nothing else consumes `hasPrev`. A grep across `src` confirmed that.

### 2. "resumes playback if needed via tryPlay" left undefined
The finding is accurate. `youtubeEngine.play()` (`src/hooks/setlistEngines/youtubeEngine.ts:102-107`) sets `pending` and resolves only on `STATE_PLAYING`. `runtime.tryPlay` wraps that call in `withTimeout(…, refusalMs)` and, on rejection, pauses the entry and sets `refused: true`. Calling it on a video that is already playing would therefore land in "Tap to play".

What the spec decides now:
- **Status `'playing'`:** `seek(0)` only. There is no `tryPlay` or `engine.play()` call, and the status does not change.
- **Status `'paused'`** (a refused entry included): `seek(0)`, then `tryPlay(engine, this.run)` once.
- A restart does not bump `this.run`, does not call `onSongChange` and starts no countdown.
- A test asserts that `play` is not called again for a restart while playing, and that it is called once for a restart while paused.

## Other tightening done this round
- **Restart condition, defined exactly:** the player is online, no countdown is running, an engine is active, the status is `'playing'` or `'paused'`, and either the elapsed time is > 3000 ms or the index is 0. Every other case falls through to the unchanged `step(-1)`.
- **Elapsed time:**
  - It counts only time spent in `'playing'`.
  - It resets at every `runFrom` and on a restart.
  - It reads `Date.now()`, which Vitest's default fake timers mock, so `advanceTimersByTime` drives it.
- **`seek` signature:** narrowed to `(seconds) => void`. Every engine's seek is fire-and-forget.
- **`SdkPlayer` and `YtPlayer`:** both interfaces gain the method they need (`seek?`, `seekTo`).
- **Audio engine test:** the audio engine has no unit test today. It is exercised for real in `SetlistPlayer.test.tsx`, so its `seek` case is added to `setlistEngines.test.ts`.
- **`seekSpotify` test:** a case is added to `src/lib/__tests__/spotifyWebPlayback.test.ts`.
- **Behavior registry:** the registry line "countdown overlay … before each song starts" (Fast View and queue) is contradicted by a restart that shows no countdown. It is now listed as `changed`, alongside the `added` line.
- **Expected results:** cut to six one-sentence assertions. The index-0 case now has its own result.

## Mock changes
- **Previous enablement:** the button follows the new `hasPrev` rule. A state-level `countdown` field is now kept, so the rule can read it.
- **Restart path:**
  - When playing, it logs "seek(0), no play() call".
  - When paused, it logs "seek(0), then tryPlay()" and resumes.
  - At index 0 it always restarts.
- **Text:** a bullet list in the header states the rules. The threshold badge reads "First song (Will Restart 0:00)" at index 0.
- **Bug fix:** the step branch logged the elapsed time after resetting it to 0. It now logs the time before the reset.
- **Check:** the script parses (checked with `new Function`).

## Not changed / noted
- The mock's Cancel countdown still only pauses. In the app, `cancelCountdown` dismisses the player. That behavior predates this task, and the task does not touch it.
- A Spotify seek to 0 while paused emits an SDK state of paused at position 0. `spotifyTrackEnded` also requires the current track to be in `previous_tracks`, which should not hold mid-track. The spec does not change that detection.

## Operator questions
None open.
