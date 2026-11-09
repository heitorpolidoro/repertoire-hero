# QA Report for RH-200: Restart current song on player previous click unless near the beginning

VERDICT: APPROVED

## Expected Results Checked
- [x] Clicking Previous after more than 3000 ms of playback calls `seek(0)` on the active engine and the counter keeps its value. — verified via Vitest test suite (`src/components/layout/__tests__/SetlistPlayer.test.tsx` -> `restarts while playing after 3500 ms without countdown or re-calling play`): `fakes.youtube?.seek` called with `0`, counter retained `2 / 4`, and `play` was not invoked again.
- [x] Clicking Previous within the first 3000 ms of playback moves the counter to the prior entry. — verified via Vitest test suite (`src/components/layout/__tests__/SetlistPlayer.test.tsx` -> `steps to previous song within threshold (1500 ms)` and `does not count paused time towards the 3000 ms threshold`): at 1500 ms, `seek` was not called and counter decremented to `1 / 4`. Paused time was excluded from the threshold calculation.
- [x] A restart shows no countdown dialog, calls `play` again only when the player was paused, and leaves the toggle reading `Pause`. — verified via Vitest test suite (`src/components/layout/__tests__/SetlistPlayer.test.tsx`): in `restarts while playing...`, no countdown dialog rendered (`queryByRole('dialog', { name: 'Setlist countdown' })` is null), `play` was not re-called, and toggle read `Pause`. In `restarts while paused...`, `seek(0)` was called, `play` was called once more to resume playback, and toggle transitioned to `Pause`.
- [x] At `1 / N` with a song playing or paused, the Previous button is enabled and clicking it calls `seek(0)` without changing the counter. — verified via Vitest test suite (`src/components/layout/__tests__/SetlistPlayer.test.tsx` -> `enables Previous at index 0 when playing or paused, and always restarts at index 0`): at index 0 (`1 / 4`) playing, Previous button is not disabled; clicking it at 1000 ms elapsed invoked `fakes.youtube?.seek(0)` and kept counter at `1 / 4`.
- [x] The audio, YouTube and Spotify engines each implement `seek`, and `setlistEngines.test.ts` asserts `currentTime = 0`, `seekTo(0, true)` and `seekSpotify(1500)`. — verified via source code and unit tests (`src/hooks/__tests__/setlistEngines.test.ts` and `src/lib/__tests__/spotifyWebPlayback.test.ts`): audio engine sets `el.currentTime = seconds` (asserted `audio.currentTime === 0`); YouTube engine calls `player.seekTo(seconds, true)` (asserted `player.seekTo(0, true)`); Spotify engine calls `seekSpotify(Math.round(seconds * 1000))` (asserted `seekSpotify(1500)` and SDK player's `seek(1500)`).
- [x] `SetlistPlayer.test.tsx` fake-timer tests pass, asserting Previous at 3500 ms seeks to 0 and keeps the index, and Previous at 1500 ms decrements it. — verified via `npx vitest run src/components/layout/__tests__/SetlistPlayer.test.tsx`: all 26 tests in the file passed, including all fake-timer tests in the `previous control restart and step (RH-200)` suite.

## Registry lines checked (Area: Fast View and queue)
- [x] A song opens at an address keyed by its version id. (src/app/songs/[versionId]/fast-view/page.tsx) — verified unchanged.
- [x] The queue holds only version id, title and artist per entry, plus an owner and an origin, in sessionStorage. (src/lib/songQueue.ts, src/lib/__tests__/songQueue.test.ts) — verified via `songQueue.test.ts` (all passed).
- [x] The current queue position is derived by matching the route's version id against the stored entries. (src/lib/songQueue.ts, src/lib/playlistNav.ts) — verified via `playlistNav.test.ts` (all passed).
- [x] A stored queue that does not list the song on screen is ignored, so a song opened alone shows no setlist chrome. (src/lib/songQueue.ts, src/components/fastview/SetlistPanel.tsx) — verified via `songQueue.test.ts` (all passed).
- [x] A bandId in the URL decides the owner context; a queue's owner applies only when the URL has none. (src/lib/songQueue.ts, src/app/songs/[versionId]/fast-view/page.tsx) — verified via `songQueue.test.ts` (all passed).
- [x] Users move through the queue by swipe, arrow keys or the setlist list, and arrow keys are off while a stage is open. (src/hooks/usePlaylistNav.ts, src/components/fastview/SwipeHint.tsx, src/lib/playlistNav.ts) — verified via `usePlaylistNav.test.ts` (all passed).
- [x] Content is fetched as a window of the current song and its neighbours, including the reader's own custom field values; a write invalidates that song's cached copy, and a custom field definition change drops every cached song. (src/lib/songWindow.ts, src/hooks/useSongWindow.ts, src/hooks/useSongCustomFields.ts, src/hooks/useCustomFieldSettings.ts, src/lib/__tests__/songWindow.test.ts) — verified via `songWindow.test.ts` (all passed).
- [x] Fast View keeps the screen awake through a wake lock. (src/hooks/useWakeLock.ts, src/app/songs/[versionId]/fast-view/page.tsx) — verified via `useWakeLock.test.ts` (all passed).
- [x] Fast View embeds the song's first YouTube link as a no-autoplay youtube-nocookie iframe. (src/lib/youtubeEmbed.ts, src/components/fastview/YoutubeEmbed.tsx, src/lib/__tests__/youtubeEmbed.test.ts) — verified via `youtubeEmbed.test.ts` (all passed).
- [x] The setlist player plays the queue in order from uploaded audio, then Spotify, then YouTube, and stops at the end. (src/lib/setlistPlayer.ts, src/hooks/useSetlistPlayer.ts, src/components/layout/SetlistPlayer.tsx) — verified via `SetlistPlayer.test.tsx` (all passed).
- [x] The setlist player automatically navigates Fast View to each upcoming song in the queue via router.replace when advancing or stepping. (src/app/AppShell.tsx, src/hooks/setlistEngines/runtime.ts, src/hooks/useSetlistPlayer.ts) — verified via `SetlistPlayer.test.tsx` (all passed).
- [x] The setlist player shows a full-screen 5-second countdown overlay with the upcoming title, resolved tuning, custom fields, and a skip control before each song starts, but not when the previous control restarts the current song. (src/components/layout/SetlistPlayer.tsx, src/hooks/setlistEngines/runtime.ts, src/store/setlistPlayerStore.ts) (RH-198, RH-200) — verified via `SetlistPlayer.test.tsx` (all passed).
- [x] The setlist player's previous control restarts the current song from 0:00, with no countdown, after more than 3 seconds of playback or on the first song; within the first 3 seconds it steps to the prior song. (src/hooks/setlistEngines/runtime.ts, src/hooks/useSetlistPlayer.ts, src/components/layout/SetlistPlayer.tsx) (RH-200) — verified via `SetlistPlayer.test.tsx` (all passed).
- [x] The Content-Security-Policy frame-src allows only YouTube nocookie, Google Docs and the Spotify SDK origin. (next.config.ts, src/lib/__tests__/nextConfigCsp.test.ts) — verified via `nextConfigCsp.test.ts` (all passed).

## Test Suites Executed
- `npm run test:coverage` (Vitest coverage suite with v8): 324 test files passed, 3,867 tests passed, 3 skipped. Coverage thresholds exceeded:
  - Statements: 96.96% (threshold 80%)
  - Branches: 90.02% (threshold 65%)
  - Functions: 96.82% (threshold 78%)
  - Lines: 97.68% (threshold 80%)
- Target suites run directly:
  - `npx vitest run src/hooks/__tests__/setlistEngines.test.ts src/lib/__tests__/spotifyWebPlayback.test.ts src/components/layout/__tests__/SetlistPlayer.test.tsx`: 3 test files passed, 63 tests passed.
- `npx eslint . --max-warnings=0`: 0 warnings, 0 errors.
- `npm run lint:dead` (Knip): Clean, no unused files or exports.
- `npm run lint:dup` (jscpd): Clean duplication check (0.93% duplication, well below limits).
- `npm run typecheck:sw`: Clean service worker type check.
- `npx tsc --noEmit`: Clean TypeScript compilation check, 0 errors.

## Blocking Findings
None.

## Suggestions
None.
