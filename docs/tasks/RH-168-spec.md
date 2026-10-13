# RH-168 — Start a practice session in due order from a playlist or the whole repertoire

Part 1 of the split of RH-115. Decided in `docs/use-cases.md` § *Start a practice session*; this task only implements it.

## Scope

Covers: the pure ordering function; a read-only server path that returns the candidates of a source with their level and last-practised date; a "Start practice" control on the band screen (`/bands/[id]`) and the personal dashboard (`RepertoireDashboard`) that writes a `songQueue` (RH-133) in the computed order and opens Fast View on the first song.

Does not cover: hand-picked selections, "Show mode", finishing a session (the playlist-wide review list, RH-159, already exists), any change to Fast View or to `src/lib/songQueue.ts`, and any write (`last_practiced`, `status`). Presence, propagation and `GREATEST` stay out (use case, *Decided*).

## Approach

**Behavior**

- Ordering: `days since last practised ÷ interval for the level`, highest first. Intervals: unassessed always due, learning 1, practicing 3, polishing 14, mastered 21 days. "Unassessed" is both `unknown` and an absent owner row. "Always due" and "never practised" (`last_practiced` null) both rank above every finite ratio; that group sorts together and, as exact ties, is shuffled. Days are fractional (millisecond difference over 86 400 000), so exact ties are songs sharing one timestamp and level.
- Ties: only exact ratio equality is shuffled, uniformly (Fisher-Yates within each tie group), through an injected `random: () => number` defaulting to `Math.random`; `now` is injected too. Near-ties (e.g. 7 days vs 8 at one level) keep ratio order.
- Candidates are read in the owner's context with one read-only call: a playlist's entries, or every row of the owner's repertoire (`user_songs` for personal, `band_songs` for a band). Playlist entries whose owner holds no row are included as unassessed. A band read requires `assertBandMember` (reads stay member-level). The call is a thin action delegating to `src/lib`, injected into the client island as a typed bundle (F21).
- Starting writes the queue with `writeSongQueue`: entries `{versionId, title, artist}` in computed order; `owner` `{type:'band', bandId}` or `{type:'personal'}`; `originHref` `/bands/<id>` for a band start and `/` (the dashboard) for a personal start; `label` the playlist's name, or "Whole repertoire" for the repertoire source. Then it navigates to `/songs/<first versionId>/fast-view` (with `?bandId=<id>` in band context). Back from Fast View already goes to `originHref` through the RH-133 chrome; no Fast View change.
- Control: one "Start practice" button with a source choice (Whole repertoire, or one of the owner's playlists). An empty source writes no queue, does not navigate, and shows an inline "Nothing to practise here" message. A start replaces any previous queue.
- The whole path performs no write: the only server call is the read; no `recordPractice`, `recordPracticeStatus` or status update.

**Files touched**

- `src/lib/practiceOrder.ts` (new): the pure ordering function and the interval table.
- `src/lib/practiceSession.ts` (new): pure builder turning ordered candidates plus owner, source and name into a `SongQueue` and the first Fast View href.
- `src/lib/practiceCandidates.ts` (new): read-only data access for the two sources (not `ownerSongs.ts`, which sits at the 400-line budget).
- `src/app/actions/practice.ts` (new): the read action, session plus `assertBandMember`, no SQL.
- `src/app/practiceActions.ts` (new): the typed `PracticeActions` bundle.
- `src/hooks/usePracticeStart.ts` (new): controller (source choice, pending, empty message, `writeSongQueue`, `router.push`).
- `src/components/songs/PracticeStartButton.tsx` (new): presentational button and source menu, shared by both screens.
- `src/components/songs/RepertoireDashboard.tsx` and `src/app/bands/[id]/page.tsx`: mount the button only; add no logic and no complexity override.
- `AGENTS.md`: one line under Domain Concepts naming `practiceOrder.ts`.

**Test criteria** (Vitest, node env unless a DOM test opts in)

- `practiceOrder.test.ts`: one case per interval; unassessed and never-practised on top; ratio ordering across levels; a seeded random proves exact ties are permuted yet deterministic per seed; near-ties keep ratio order for any seed.
- `practiceSession.test.ts`: owner, originHref and label for band and personal starts and for playlist and repertoire sources; entries carry only the three fields.
- `usePracticeStart.test.tsx`: the queue is stored in computed order and the router receives the first song's Fast View href; an empty source stores nothing and does not navigate; the test asserts no recordPractice, status or update function is called.
- Action test: a non-member of the band is refused; a member reads.

## Expected Results

- [ ] `orderForPractice` in `src/lib` sorts songs by days since last practised divided by the level interval, highest first, asserted by a Vitest unit test.
- [ ] The unit test asserts the intervals unassessed always due, learning 1, practicing 3, polishing 14 and mastered 21 days.
- [ ] A seeded-random test proves exact ties are shuffled through the injected source, and another proves near-ties keep their ratio order.
- [ ] "Start practice" on `/bands/[id]` and on the personal dashboard stores a `songQueue` in computed order for a playlist and for the whole repertoire, then opens Fast View on the first song.
- [ ] A band start records owner `band` and `/bands/<id>` as `originHref`; a personal start records owner `personal` and `/` as `originHref`; both record a label.
- [ ] Back from Fast View after a start returns to the recorded `originHref`.
- [ ] Starting a session issues no `last_practiced` or status write, asserted by a test on the injected actions.
- [ ] An empty source stores no queue, does not navigate and shows an inline message.

## Out of Scope

Hand-picked selection, Show mode, the end-of-session flow, tuning the interval numbers, any Fast View change.
