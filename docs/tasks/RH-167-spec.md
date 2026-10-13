# RH-167 — Add a setlist player over the RH-133 queue

## Scope

Part 6 of the RH-149 split (panel F of `docs/tasks/RH-149-mock.html`). A persistent bar at the bottom of the screen plays, in RH-133 tab-queue order, each song's own audio: uploaded audio (RH-162), the Spotify track (RH-164) or the YouTube video (RH-163). It keeps playing while the musician moves between Fast View songs or other routes. Blocked by RH-162, RH-163 and RH-164 (operator decision: all three are sources).

**Decisions**

1. **Three sources, one precedence per song.** For each queue entry the first available of: (a) the reader's newest uploaded audio file; (b) the Spotify track of the song's Spotify link, only when RH-164's decision function says `ready` (connected, new scopes, Premium, uri from `spotifyTrackUriFromUrl`; short links give no uri); (c) the YouTube video of the song's first youtube-provider link (id via the RH-163 lib). Reason: uploaded audio is the only source that continues unattended and without account costs; Spotify is a full track but needs Premium; YouTube is the fallback that works for everyone but carries ads. The choice is one pure function (`pickSource`); nothing is configurable per user. Uploaded audio stays owned by the reader alone (RH-162): band context plays the listener's own files.
2. **One engine per provider, one controller.** A single `SetlistPlayer` controller drives three small engines behind a common interface (load, play, pause, ended, error, dispose): an `<audio>` element, the Spotify Web Playback SDK player, and a YouTube IFrame API player. Engines are created lazily, the first time an entry needs them; the SDK and IFrame scripts load only then, never on app start. A single `<audio>` cannot play YouTube or Spotify, and an iframe cannot play a file, so the model is: the controller owns exactly one active engine at a time and pauses the previous one on a switch.
3. **Hoisted above the route.** The `<audio>` element, the YouTube host container and the Spotify SDK instance are all mounted/held by `AppShell` (root layout, never remounted by navigation) under `SetlistPlayer`. They are not the RH-162 `AudioSection`, the RH-163 `YoutubeEmbed` or the RH-164 `SpotifyPlayer` components, which are per-song and unmount with the route; this task reuses their libs (video id extraction, `spotifyPlayback` decision, playback-token route), not the components. The YouTube frame has its own visible region in the bar (expanded only while the current source is YouTube, never hidden or 0-sized), as YouTube requires a visible player. It uses `youtube-nocookie.com` and the CSP from RH-163 (`frame-src` only) already admits it; no further CSP change.
4. **The player owns its position; the route does not move it.** Starting copies the queue entries into a zustand store (`src/store`, not persisted) and records the current entry. Route changes, `clearSongQueue()` (RH-133 dashboard link) and a new queue written by another playlist do not touch a running player. It does not navigate; tapping the title opens that song's Fast View.
5. **Start is a tap, always.** No `autoplay` attribute, no autoplay URL parameter or `autoplay` iframe permission, no `play()`, engine load or SDK script fetch on mount, restore, route change or queue change. The only entry is a "Play setlist" tap in the Fast View setlist chrome, which starts at the song on screen if it has a playable source, otherwise at the next one that has.
6. **Advancing, and when a browser refuses it.** After `ended` (or the next control) the controller picks the next playable entry, loads it into its engine and calls play. Same-engine advances reuse the element that the first tap unlocked; a switch to another engine (e.g. file then YouTube) can be refused by the browser or provider because no gesture preceded it. If the engine does not report playing within a few seconds, or its play call rejects, the player stays on that entry in `paused` with the bar text "Tap to play <title>". It never retries by itself and never skips an entry because of a refusal. An entry whose source fails to load (audio error, YouTube error 100/101/150, Spotify error) is treated like one with no source.
7. **A song with no source is skipped, visibly.** Entries with no playable source are passed over; the bar says "Skipped: <title> (no audio or video)" at the moment it takes effect. If no later entry is playable the player stops at the end (no wraparound, as RH-133). Previous works backwards the same way.
8. **Lazy resolution.** Sources are resolved one entry at a time when playback reaches or looks ahead at an entry, never for the whole queue at once. Spotify readiness comes from the RH-164 playback-token route and is asked only when an entry has a Spotify uri and no uploaded audio.
9. **Offline:** none of the three sources works offline (audio is not in the snapshot; RH-163 and RH-164 refuse offline). Offline the bar shows "Playback is not available offline", mounts no `<audio>`, no iframe and no SDK, and skips nothing.
10. **Dismiss:** a close control stops and disposes the active engine and hides the bar. The bar is hidden entirely until the first tap.

Not in scope: shuffle, repeat, seek-position persistence across reloads, crossfade, offline playback, loop/tempo controls (RH-149 panel D), background controls beyond the browser's native ones, any change to the queue shape, to `AudioSection`, `YoutubeEmbed`, `SpotifyPlayer`, scopes or who owns audio, resolving short links (RH-142 already does it at write time), choosing the source per song by hand.

## Approach

Behavior
- The bar (panel F): play/pause, title with a source badge (File / Spotify / YouTube), "Next: <title>", previous, next, "n / total" over the whole queue. Hidden until started; sticky at the bottom above route content.
- `ended` from the active engine advances per Decisions 6-7. Pause/play from the bar and from native/provider controls stay in sync with the store.
- Route changes never remount the audio element, the YouTube host node or the Spotify instance; they live in `AppShell`, above the routes.
- Source lookup is one server action, injected from `AppShell` as a typed actions object (F21; hooks and components import no action). For one `versionId` it answers `{ audio?: { fileUrl, title }, spotifyUrl?, youtubeUrl? }` from the caller's own rows only; it checks the session. Signed-out: nothing renders and nothing is requested.

Files touched
- `src/lib/setlistPlayer.ts` (new): pure decisions: `pickSource` (precedence, readiness, offline), next/previous playable index, skipped-title result, end-of-queue, refusal state, counter text. No browser API, no React.
- `src/lib/queueSources.ts` (new, server-only via `@/lib/db`): `resolveVersionSources(userId, versionId)`: the reader's newest audio `song_files` row (limit 1), the song's Spotify and first YouTube link urls.
- `src/app/actions/audio.ts`: thin `getQueueSourcesAction(versionId)` that resolves the session and delegates (A2 pattern, no SQL).
- `src/app/setlistPlayerActions.ts` (new): `SETLIST_PLAYER_ACTIONS` bundle (sources action; Spotify readiness reuses the RH-164 route through an injected fetcher).
- `src/store/setlistPlayerStore.ts` (new): zustand: entries snapshot, current index, status (`idle | playing | paused | stopped`), active source kind, last skipped title.
- `src/hooks/setlistEngines/audioEngine.ts`, `youtubeEngine.ts`, `spotifyEngine.ts` (new): the three engines behind one interface; each wraps its browser/SDK API and lazy script load.
- `src/hooks/useSetlistPlayer.ts` (new): the controller: lazily creates engines, switches, advances, handles refusal and offline; returns a `SetlistPlayerController`.
- `src/components/layout/SetlistPlayer.tsx` (new, presentational): the bar and the persistent audio/YouTube hosts; mounted by `src/app/AppShell.tsx` next to `ConditionalLayout`, the only edit there.
- `src/components/fastview/SetlistPanel.tsx` (and drawer/sidebar if shared): "Play setlist" control that sends the RH-133 queue entries to the store.
- `src/lib/youtubeEmbed.ts`, `src/lib/spotifyPlayback.ts`: consumed as-is (from RH-163/RH-164); only an export is added if one is missing.
- `src/types/database.ts`/`src/lib/dbRows.ts`: row type for the lookup only if none fits.
- `docs/use-cases.md`, `AGENTS.md`: setlist player, source precedence, hoisting, refusal and skip rules.
- `package.json`: version bump (standing rule).

Test criteria
- `setlistPlayer.test.ts` (node): `pickSource` precedence (audio over Spotify over YouTube; Spotify not `ready` falls to YouTube; nothing yields `null`; offline yields `null`), skipping, end of queue without wraparound, previous symmetry, counter over the whole queue.
- `useSetlistPlayer`/`SetlistPlayer` component tests (jsdom, `afterEach(cleanup)`, fake engines for YouTube and Spotify, no real SDK or network): ended on entry 1 loads entry 2 in its own engine and calls play, for same-engine (file to file) and cross-engine (file to YouTube); a play call that rejects, or a refusal timeout (fake timers), leaves the entry paused with "Tap to play <title>" and no skip; an entry with no source is passed over and the skipped title shown; offline renders the message and no `<audio>`, iframe or script.
- No-autoplay: rendering with a queue present, with a store already holding entries, and after a simulated route change never calls any engine's play or load, never adds an SDK/IFrame script, the element has no `autoplay` attribute and no iframe src carries `autoplay`; only the tap does and it starts at the song on screen or the next playable one.
- No-remount: render an `AppShell`-equivalent host, grab the `<audio>` node and the YouTube host node, re-render children as a different route/song, assert the same instances (`toBe`), unchanged `src`, and `play` not re-called.
- Action test: `getQueueSourcesAction` returns only the caller's newest audio file and links; another user's audio on the same song is not returned. DB test for `resolveVersionSources` (`.db.test.ts`).
- Lint, `lint:dead` and coverage gates read by exit code; new files stay under budget.

## Expected Results
- [ ] Nothing plays or loads until the "Play setlist" tap, which then starts at the song on screen if it has a playable source, otherwise at the next entry that has one, asserted by the no-autoplay and start-position component tests.
- [ ] `pickSource` chooses uploaded audio over a `ready` Spotify track over a YouTube video, falls to YouTube when Spotify is not `ready`, and returns `null` offline or with no source, asserted by `setlistPlayer.test.ts`.
- [ ] When a track ends, the next playable entry is loaded in its own engine (file to file and file to YouTube) and play is called, asserted by component tests.
- [ ] When the next engine refuses to start (rejected play or timeout), the player stays on that entry paused showing "Tap to play <title>" and skips nothing, asserted by a component test.
- [ ] Advancing passes over an entry with no source with the bar showing "Skipped: <title> (no audio or video)", and stops at the end of the queue without wrapping when none follows, asserted by a component test and a `setlistPlayer.test.ts` case.
- [ ] The `<audio>` node and the YouTube host node are the same instances with `src` unchanged after a route change between two queue songs, asserted by a no-remount test.
- [ ] Offline, the bar shows "Playback is not available offline" and renders no `<audio>`, iframe or SDK script, asserted by a component test.
- [ ] `getQueueSourcesAction` returns only the caller's newest audio file and links for a version, never another user's, asserted by an action/DB test.

## Out of Scope
Shuffle/repeat, offline playback, resume after reload, sharing audio with a band, loop and tempo controls, per-song manual source choice, new Spotify scopes, short-link resolution, changes to the per-song AudioSection/YoutubeEmbed/SpotifyPlayer components.
