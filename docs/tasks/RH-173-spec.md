# RH-173 — Allow the Spotify Web Playback SDK iframe in the CSP so Spotify playback starts

Bug fix. Spotify playback never starts: the setlist bar (RH-167) shows "Tap to play <title>" under a Spotify badge and nothing plays, and the Fast View "Play on Spotify" button (RH-164) plays nothing either. Reported on a desktop browser with a Premium account.

## Cause

The Web Playback SDK (`https://sdk.scdn.co/spotify-player.js`, loaded by `loadSdk` in `src/lib/spotifyWebPlayback.ts`) does its playback inside an iframe it creates at `https://sdk.scdn.co/embedded/index.html` (verified in the published script). RH-163 added the app's only Content-Security-Policy in `next.config.ts` `headers()`: `frame-src https://www.youtube-nocookie.com https://docs.google.com`. That directive does not list `https://sdk.scdn.co`, so the browser refuses to load the SDK's iframe, the player never emits `ready`, and `connectPlayer`'s device promise never settles. `playTrack` therefore never resolves; the setlist runtime's `REFUSAL_MS` (4 s) timeout fires and leaves the entry paused with "Tap to play". RH-163 and RH-164 landed the same day, so Spotify playback has never worked with the CSP in place.

## Scope

Covers: adding `https://sdk.scdn.co` to the CSP `frame-src`, and updating the test that pins the CSP.

Does not cover: any other CSP directive, any change to `spotifyWebPlayback.ts`, the setlist runtime, `REFUSAL_MS`, or the engines.

## Approach

**Behavior**

- The CSP value becomes exactly `frame-src https://www.youtube-nocookie.com https://docs.google.com https://sdk.scdn.co`, still on `/:path*`, still the only header rule. No wildcard.

**Files touched**

- `next.config.ts`: the CSP value, plus a short comment naming the SDK iframe as the reason for the third origin.
- `src/lib/__tests__/nextConfigCsp.test.ts`: the exact-value assertion and its header comment; a new case asserting the SDK iframe origin is allowed.
- `AGENTS.md`: the RH-163 bullet ("YouTube embed and the CSP") names the third origin and why.

**Test criteria** (Vitest)

- `nextConfigCsp.test.ts`: the value equals the three-origin string exactly and contains no `*`; the origin of `https://sdk.scdn.co/embedded/index.html` is in the `frame-src` list; the existing gview and nocookie assertions still pass.

## Expected Results

- [ ] ER1: `next.config.ts` `headers()` returns exactly one rule on `/:path*` whose only header is `Content-Security-Policy` with the value `frame-src https://www.youtube-nocookie.com https://docs.google.com https://sdk.scdn.co`, asserted by `src/lib/__tests__/nextConfigCsp.test.ts`.
- [ ] ER2: `nextConfigCsp.test.ts` has a case asserting that `new URL('https://sdk.scdn.co/embedded/index.html').origin` is in the `frame-src` origin list, and the CSP value contains no `*`.
- [ ] ER3: `npm run test -- src/lib/__tests__/nextConfigCsp.test.ts` passes, and `npm run lint` reports no new errors.
- [ ] ER4: Served by `npm run dev`, a response for `/` carries the header `Content-Security-Policy: frame-src https://www.youtube-nocookie.com https://docs.google.com https://sdk.scdn.co` (checked with `curl -sI`).
- [ ] ER5: `AGENTS.md`'s CSP bullet lists `https://sdk.scdn.co` as the Web Playback SDK's iframe origin.

## Out of Scope

Hardening the Spotify engine itself (a device promise that can hang forever when `ready` never arrives, no retry when `PUT /me/player/play` answers 404 right after `ready`, no `not_ready` / `autoplay_failed` / `playback_error` listeners, and the 4 s refusal window covering the SDK's cold start). Those are separate tasks if playback still misbehaves after this fix.
