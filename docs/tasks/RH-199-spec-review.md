VERDICT: APPROVED

Review mode: round 1 (full review). Spec: `docs/tasks/RH-199-spec.md` at `b0d1465`.
Mock: `docs/tasks/RH-199-mock.html`.

## Blocking Findings

None.

## Suggestions

- **FastViewPage is at its line budget.** `FastViewPage` in
  `src/app/songs/[versionId]/fast-view/page.tsx` runs from line 107 to line 304,
  198 lines against `max-lines-per-function: 200`, and the file has no override.
  The spec's "one prop each" adds two lines and lands on exactly 200. Put the new
  prop on an existing line (lines 195 and 283 already pack `onSelect`/`onPlay`
  together), or the next change to the page breaks the budget. The spec could say so.
- **Make the Play button's right padding part of the spec, not only the mock.**
  The spec says the Play button sits "over the row's right padding", but that padding
  is `px-3.5` (14px), which is narrower than a `▶ Play` pill. The mock reserves room
  by adding `pr-20` to the row button when the marker is `play`. Without that, the
  pill covers the *Not in repertoire* chip or the end of the title (the spec says the
  chip "may sit beside either marker"). One sentence in "The row" would settle it.
- **Name the new field once.** The hook field, the `SetlistPanel`/`SetlistDrawer`/
  `SetlistSidebar` prop and the two lib functions have no names in the spec.
  Naming them (for example `activeVersionId`, `rowMarker`, `activeTrackVersionId`)
  would make the pinned key-list update in "exposes no owner context to its
  consumers" mechanical.
- **Wording:** "It stays the only setlist piece that reads the player store" is
  slightly off. The page already reads `useSetlistPlayerStore` for `isCountingDown`
  (page.tsx:163). The rule that matters, and that holds, is that the setlist
  *components* stay presentational.
- **Shared versions across playlists.** Matching by version id means that if the
  player was started from playlist A and the musician opens playlist B, which holds
  the same version, B's row for that version shows `▶ NOW`. The spec explains why
  it matches by version id, so this is acceptable. It could be listed as a known
  edge case so QA does not report it.

## Evidence

### Completeness and coverage
- Scope §1–3 and the rule table (5 rows) cover every state. The rule matches the
  mock's `rowMarker`/`activeVersionId` functions one for one.
- The claim "`playSetlist` already hands the queue and the viewed version id" is true:
  `usePlaylistNav.ts:231-233` calls `requestStart({ entries, versionId: currentVersionId, bandId })`,
  and an existing test asserts it (`usePlaylistNav.test.tsx:92`, "playSetlist hands the
  queue and the song on screen…").
- The claim "`SetlistRuntime.start` already disposes the current engine and begins
  at that index" is true: `runtime.ts:97-107` runs `clearCountdownTimer`,
  `disposeEngines`, `begin(entries, index)`, then `runFrom(index)`. No runtime or store
  change is needed.
- The status semantics are right. `begin` sets `status: 'paused'`
  (`setlistPlayerStore.ts:60`), so countdown and refusal are `paused`. An offline
  start patches `stopped` (`runtime.ts:103`), so no track is active, which matches the
  Out of Scope offline note. `setOffline` while playing → `paused`, so the track stays
  active. `dismiss` → `reset()` → `idle`.
- Drawer close-before-play already exists for the header button
  (`SetlistDrawer.tsx:53-59`). The spec extends the same pattern to the row.

### Expected results (6, within 3–8)
- ER1–ER4 each state one observable marker state or interaction that a jsdom test
  or QA can check. ER2 and ER3 have qualifiers ("and the panel holds exactly one
  NOW", "in the drawer, after closing it"), but each still describes a single
  behaviour. The Test criteria list matching assertions.
- ER3's "stores a start request" is reachable: the component tests assert `onPlay` is
  called, the page wires `onPlay` to `playlist.playSetlist`, and the existing hook
  test asserts the request.
- ER5 runs a concrete vitest command over the touched test files. ER6 checks the
  `node scripts/behavior.js area "Fast View and queue"` output.

### Operator results
Every operator result survives:
- Op1 is covered by ER1 together with ER4.
- Op2 is covered by ER2.
- Op3 is covered by ER3. "Starts playback" is carried by the request that the
  runtime consumes.
- Op4 is covered by ER4.
- Op5 is covered by ER5.

Nothing is dropped or contradicted.

### Behavior registry
- The `## Behavior changes` section is present with one `added:` line.
- The "Fast View and queue" area has no line about the NOW pill, so nothing
  contradicts the change. The line "Users move through the queue by swipe, arrow
  keys or the setlist list" still holds, because a row tap still navigates.
- The auto-navigation line (RH-167 `router.replace`) is kept explicitly in Out of
  Scope.
- "Internationalisation" was checked: Fast View setlist strings are English-only
  today ("▶ NOW", "Play setlist", "Not in repertoire"). The new "▶ Play" string
  follows the same convention.

### Mock
- The mock exists and covers both surfaces (sidebar and drawer) through six presets:
  idle, same song, other song, paused, countdown, stopped.
- It renders each of the spec's states.
- The script reaches every element with `document.getElementById`; none is read
  as a bare global. `state`, `ENTRIES` and `PRESETS` are top-level `const`s and do
  not shadow `window` properties.
- The Play button is a sibling of the row button, not nested inside it, which
  matches the spec.

### Architecture and scope
- One PR-sized deliverable across one feature area (lib rule, hook field,
  presentational row and panel, page wiring).
- The `AGENTS.md` "Fast View Playlist Layout" update is planned.
- The Landing Page Rule decision is made: not a selling point, no dictionary change.
- The spec and the expected results are in English.
- No global rule is added or tightened, so the cross-app impact check does not apply.
- Existing tests: `SetlistRow.test.tsx` uses a single `getByRole('button')`, and the
  drawer and sidebar tests count buttons (4 and 3). No Play button renders with no
  active track, so those tests keep passing. The new cases are listed in the Test
  criteria.
- Complexity: `usePlaylistNav` is lines 96–252 (157 of 200); `usePlaylistNav.ts` has
  258 of 400 lines; the test files are under 800. Only the page is tight (see
  Suggestions).

QUESTIONS:
(none)
