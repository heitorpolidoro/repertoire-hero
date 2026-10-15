# RH-165 — Add a tempo field and a click track to Fast View

Part 4 of the RH-149 split (panel E of `docs/tasks/RH-149-mock.html`). Mock: `docs/tasks/RH-165-mock.html`.

## Scope
In: a nullable `songs.tempo_bpm` column; tempo as a catalog field the song form can fill; a click-track strip in Fast View shown only for songs with a tempo; a browser-generated click that starts on a tap and works offline.
Not in: audio files, backing tracks, loop points, count-in, time signatures other than 4/4, tap-tempo, per-user tempo, a setlist-wide player, a Spotify BPM lookup.

## Approach
**Data.** A new migration (next number after `0024`) adds `songs.tempo_bpm integer NULL` with a CHECK of 20..300 (NULL allowed). Tempo joins the catalog columns in `catalogFields.ts` and the suggestion payload/SQL, so it follows the existing wiki rule (RH-97): fill a blank directly, a conflicting value goes to the moderation queue as a correction. This is the default for the open question on who may edit tempo. `src/types/database.ts` gains the field.

**Reads.** The tempo travels with the song through the Fast View entry reader and the offline snapshot (a snapshot-format version bump with migration of older snapshots, per the `offlineSnapshot*.ts` conventions; a snapshot without tempo reads as "no tempo").

**Click engine.** A pure scheduler module (injectable clock and tick sink, no React) emits a beat every 60000/bpm ms, with beat 1 of each 4 accented. A thin hook drives it with the Web Audio API (short oscillator blip), creating/resuming the `AudioContext` only inside the tap handler. It never touches the network and never starts on mount.

**UI.** A compact strip after the identity header in Fast View: play/stop button, BPM readout, four beat dots. Rendered only when the song has a tempo; absent otherwise (no placeholder). Stops on unmount and on navigation to another song. Usable offline (it is not a write). The existing wake lock already keeps the screen on.

**Files touched.**
- `migrations/0025_songs_tempo.sql` — column + CHECK.
- `src/types/database.ts` — `tempo_bpm` on the song types.
- `src/lib/catalogFields.ts`, `catalogSuggestionPayload.ts`, `catalogSuggestionSql.ts`, `songs.ts` — tempo as a fillable/refusable catalog column.
- `src/components/songs/SongForm.tsx` (and `CorrectionModal` if it lists fields) — tempo input.
- `src/lib/songEntry.ts` and the offline snapshot modules — carry tempo, version bump.
- `src/lib/clickTrack.ts` — scheduler; `src/hooks/useClickTrack.ts` — Web Audio driver.
- `src/components/fastview/ClickTrackStrip.tsx` and its mount in the Fast View composition root.
- `AGENTS.md`, `docs/use-cases.md` — one line each for the new field.

**Test criteria.**
- db test: tempo 0, 19, 301 rejected by the CHECK; NULL, 20, 92, 300 accepted.
- Unit, fake clock: at 120 BPM, 4 beats in 2000 ms, beat 1 accented; stop halts ticks.
- Component: strip present with tempo, absent without; after render no audio started and no tick; first tap starts it.
- Offline: engine and strip run with `fetch` stubbed to throw, for a song read from a snapshot; no fetch call occurs; a pre-bump snapshot reads as no tempo.

## Expected Results
- [ ] A migration adds nullable `songs.tempo_bpm` with a CHECK of 20..300, and a db test shows 0 and 301 are rejected while NULL and 92 are accepted.
- [ ] A Fast View component test shows the click-track control for a song with a tempo and no control for a song without one.
- [ ] A unit test with a fake clock shows beats every 60000/bpm ms (4 beats in 2000 ms at 120 BPM).
- [ ] A component test shows no audio context started and no beat on render, and the click starts only after a tap on play.
- [ ] A test with `fetch` stubbed to throw shows the click track working for a song read from the offline snapshot.
- [ ] The song form fills a blank tempo, and a conflicting tempo is routed to the moderation queue like other catalog fields.

## Out of Scope
Everything under "Not in" above.
