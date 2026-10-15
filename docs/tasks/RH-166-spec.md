# RH-166 — Add a practice transport with loop, slow-down and count-in

## Scope

Part 5 of the RH-149 split (panel D of `docs/tasks/RH-149-mock.html`). A "Practice" section in Fast View, over the song's uploaded audio (RH-162), with three tools: loop A-B, playback speed, and a count-in before playback starts. Mock: `docs/tasks/RH-166-mock.html` (the transport, an Online/Offline toggle, and the recorded storage decision).

**Decisions**

1. **Own component, own audio element.** RH-162 states `AudioSection` is not the base for the transport. The transport is a new component with its own `<audio preload="none">`; it reuses only the stored `song_files` audio rows (via the existing `AudioLibraryController.files`) and `src/lib/audioLibrary.ts` vocabulary.
2. **Visibility.** Shown only online and only when the reader has at least one audio file. With several files, the transport works on one selected file (default: the first). Offline it renders an explicit "Practice tools are not available offline" message and no audio element, consistent with RH-162.
3. **Loop.** The user sets point A and point B from the current playback position; B must be greater than A (otherwise refused with a message). While playing, when the position reaches B the position is set back to A. With no complete loop nothing is seeked. The check runs on a frame/timer tick, not on the coarse `timeupdate` event. A clear control removes the loop.
4. **Speed.** Presets 0.5x, 0.75x, 1x, 1.25x set `audio.playbackRate`, and `preservesPitch` is set true. Speed is a session setting, not stored.
5. **Count-in.** The app has no tempo field (tempo on `songs` is panel E, a separate task), so the count-in carries its own BPM stepper (40-200, default 90) and a beat count of Off / 2 / 4 (default 4). Pressing Play with a count-in on plays that many clicks (Web Audio oscillator) at `60/bpm` seconds apart, then starts the audio. The count-in happens only on a Play from stopped, not on loop wraps. Both settings are device-local session UI state (not stored in the database). The beat scheduler takes an injected clock so it is testable with fake timers.
6. **No autoplay.** Mounting, changing song, changing the file, setting a loop or changing speed never calls `play()` and never creates or resumes an `AudioContext`; both happen only inside the Play tap handler.
7. **Read-only.** While Fast View is read-only, playback, speed, count-in and loop all still work, because the loop is device-local and writes nothing to the server.

8. **Loop storage (decided; operator: "This is way too complex for now").** The loop is kept device-local in browser `localStorage`, one loop per audio file, under the key `practiceLoop:<fileId>` (the `song_files` id) with value `{start, end}` in seconds. No migration, no database column, no Server Action, no new table. Setting a complete loop saves it; clearing removes the key; selecting a file loads its saved loop. A stored value that is missing, unparsable, or invalid (end not after start, negative) is treated as no loop. A storage that throws (private mode, quota) is swallowed and the loop stays session-only. Accepted limits: the loop does not follow the user to another device and is lost if browser data is cleared.

Not in scope: sharing loops in a band, server-side or cross-device loop storage, multiple loops per file, tempo on the catalog or any metronome (panel E), the setlist player (panel F), offline audio, waveform display, pitch shifting beyond the browser's `preservesPitch`, Spotify/YouTube sources.

## Approach

Behavior
- A pure lib module decides the loop: given position, loop and playing state it returns "seek to A" or "none". A second pure module schedules count-in beats from an injected clock and calls back per beat and once at the end.
- A controller hook owns the transport state (selected file, position, loop, rate, count-in settings, playing) and exposes intent commands (play, pause, setA, setB, clearLoop, setRate, setCountIn, setBpm, nudge +/-5 s). It reads and writes the loop through the loop-store helper in `src/lib/practiceLoop.ts` (no Server Action involved) and takes the `Storage` object as an optional parameter so tests can pass a fake.
- A presentational `PracticeTransport` component renders the controls from the controller; it is wired at the Fast View composition point, not added to `page.tsx` logic. English strings follow `AudioSection` (no dictionary).

Files touched
- `src/lib/practiceLoop.ts` (new): pure loop decision and loop validation, plus the localStorage load/save/clear helper (defensive parse, storage errors swallowed).
- `src/lib/countIn.ts` (new): beat scheduler with injected clock, plus the click voice factory (created only on call).
- `src/hooks/usePracticeTransport.ts` (new): controller hook.
- `src/components/fastview/PracticeTransport.tsx` (new): presentational transport; mounted next to `AudioSection` through the existing composition seam.
- `docs/use-cases.md`, `AGENTS.md`: Song File entry gains the practice transport and notes that loops are device-local.

Test criteria
- Unit: loop decision (inside loop, at end, past end, no loop, A >= B refused); count-in scheduler with fake timers (N beats at 60/bpm spacing, end callback after the last beat, none for 0 beats).
- Component (jsdom): hidden with no audio file; offline message and no `<audio>`; rate button sets `playbackRate`; `play` not called and no `AudioContext` constructed on mount; with count-in 4, `play` is called only after the fourth beat.
- Loop store (unit, fake `Storage`): a saved loop is returned by a fresh load for the same file id and not for another id; clear removes it; corrupt JSON, a missing key, end <= start and a throwing storage all yield no loop without throwing.

## Expected Results
- [ ] The Practice section renders only online and only for a song with an uploaded audio file; offline it shows the unavailable message and no `<audio>`, one component test per state.
- [ ] With a loop set, the loop logic returns a seek to the loop start once the position reaches the loop end and returns none otherwise, asserted by a unit test; an end not after the start is refused.
- [ ] Choosing a speed sets the audio element's `playbackRate` to that value with `preservesPitch` true, asserted by a component test.
- [ ] A count-in of N beats at B BPM emits N beats `60/B` seconds apart and only then starts the audio, asserted by a unit test with a fake clock.
- [ ] Mounting the transport, switching file and changing loop or speed never call `play()` or create an `AudioContext`; only a Play tap does, asserted by a component test.
- [ ] A loop saved in `localStorage` is restored for that audio file on a fresh load and not for another file, and a corrupt or invalid stored value yields no loop, asserted by unit tests of the loop store with a fake `Storage`.

## Out of Scope
Band-shared loops, a metronome or tempo field, the setlist player, offline audio, waveform display, remembering speed or count-in settings, any database or server change for loops.
