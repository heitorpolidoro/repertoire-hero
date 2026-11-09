# RH-198 — Show tuning and custom fields in the setlist countdown overlay

## Scope

The setlist player countdown overlay (RH-189) provides musicians with a 5-second countdown before each upcoming song starts. This task enhances the overlay to display the upcoming song's resolved guitar/instrument tuning and the musician's custom field definitions and values (such as Capo, Preset, or Patch), allowing musicians to adjust their instrument setup before audio playback begins.

Covers:
- Displaying the upcoming song's resolved tuning (owner override or version baseline) in the countdown overlay when present, formatted through canonical display rules (e.g. `Eb (-0.5)` or `Drop D (-1)`).
- Displaying the signed-in user's custom field names and values for the upcoming song in the countdown overlay when present (omitting empty or unset custom fields).
- Clean rendering without empty badges, placeholder containers, or layout shift when the upcoming song has neither tuning nor custom field values.
- Responsive styling ensuring metadata chips wrap cleanly without horizontal overflow on a 375 px mobile viewport, with explicit width and truncation constraints preventing long names, values, or custom tuning strings from overflowing.
- Data resolution leveraging the Fast View song window cache (`cachedSong`) when pre-fetched, with fallback to `getSongDetails` via `getSongWindowAction` in `SETLIST_PLAYER_ACTIONS`, guarded against stale async resolution during song navigation.
- Vitest unit tests in `SetlistPlayer.test.tsx` verifying overlay rendering with tuning, with custom fields, with neither, with long/overflow values at 375 px, and discarding late responses across song changes.

Does not cover:
- Inline editing of tuning or custom field values from the countdown overlay (Fast View remains the editing surface).
- Adding custom fields for band members other than the signed-in user (custom fields remain personal per RH-186).
- Changes to countdown timer duration, cancellation flow, skip mechanics, or audio engine priming (established in RH-189).

## Approach

### Behavior
- **Data availability during countdown**:
  - The upcoming song is identified by `versionId` and `bandId` from the active setlist player state.
  - When the countdown begins (or when the active song index changes), `useSetlistPlayer` resolves tuning and custom fields for the upcoming song:
    - It checks the client in-memory window cache (`cachedSong(bandId, versionId)`). If already present (e.g. pre-fetched by Fast View's window loader), tuning and custom fields are populated synchronously without network latency.
    - If absent from cache, it calls `actions.getSongDetails(versionId, bandId)`, which invokes `getSongWindowAction([versionId], bandId)` on the server to retrieve the resolved song entry and custom field values.
    - **Stale response protection**: When an asynchronous `getSongDetails(versionId, bandId)` fetch resolves, its response is applied to state only if `versionId` and `bandId` still match the active song entry when the promise settles. If navigation (e.g. `next()`, `prev()`, `skipCountdown()`, `cancelCountdown()`) or setlist progression has moved to another song or dismissed the countdown while the fetch was in flight, the late response is discarded and does not overwrite state or the active song's metadata.
    - If neither is available or while a fetch is pending, tuning defaults to `null` and custom fields to `[]`.
- **Overlay presentation**:
  - In `CountdownOverlay` (`src/components/layout/SetlistPlayer.tsx`), preserving the existing overlay styling (`p-8 bg-black/90 text-white backdrop-blur-md`, `text-[30vh]` countdown numeral, `mt-4 w-full px-4` song heading container, `mt-1 truncate text-xl font-bold text-white` title, and skip countdown button):
  - Below the song title and artist line, a metadata badges container is rendered only if `tuning` is present or at least one custom field has a non-blank value.
  - When present:
    - **Tuning**: Rendered as a distinct badge using `formatTuningDisplay(tuning)` (e.g. `Tuning: Eb (-0.5)` or `Tuning: Drop D (-1)`), styled in emerald accent tones matching the player chrome (`inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-950/50 px-2.5 py-1 text-xs text-emerald-300 shadow-sm max-w-full min-w-0`). The tuning text span applies `truncate` so long custom tuning strings cannot exceed the container width.
    - **Custom fields**: Rendered as individual chips displaying `Name: Value` (e.g. `Capo: 2`, `Preset: Clean Boost`), styled in subtle neutral translucent badges (`inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/10 px-2.5 py-1 text-xs text-gray-200 shadow-sm max-w-full min-w-0`). The field name span has `max-w-[120px] truncate font-medium text-gray-400` and the value span has `max-w-[160px] truncate font-semibold text-white`. Unset fields (`value: null` or whitespace) are excluded.
  - When neither tuning nor custom field values are present, the metadata container renders `null`, producing no empty badges, no borders, and no layout shift.
- **Mobile responsiveness**:
  - The metadata container uses `mt-3 flex flex-wrap items-center justify-center gap-2 max-w-full px-2`.
  - Every badge and chip is bounded by `max-w-full min-w-0`.
  - Both custom field names and values apply `truncate` (with max-width boundaries on names and values), and the tuning text applies `truncate`, preventing arbitrarily long custom field names, values, or custom tuning strings from exceeding the container or causing horizontal overflow.
  - On a 375 px mobile viewport, multiple chips wrap naturally into subsequent lines without causing horizontal scrolling or viewport overflow.

### Files touched
- `src/hooks/setlistEngines/runtime.ts`:
  - Update `SetlistPlayerActions` interface (line 16) to add optional `getSongDetails?: (versionId: string, bandId: string | null) => Promise<{ tuning: string | null; customFields: Array<{ name: string; value: string }> }>`.
- `src/hooks/useSetlistPlayer.ts`:
  - Expose `tuning: string | null` and `customFields: Array<{ name: string; value: string }>` on `SetlistPlayerController`.
  - In `useSetlistPlayer`, maintain state for the upcoming song's tuning and custom fields, populating from `cachedSong` and/or `actions.getSongDetails`. Discard late responses if the active song changed while the fetch was in flight.
- `src/app/setlistPlayerActions.ts`:
  - Implement `getSongDetails` in `SETLIST_PLAYER_ACTIONS`, querying `getSongWindowAction([versionId], bandId)` to return resolved tuning and non-empty custom field entries.
- `src/components/layout/SetlistPlayer.tsx`:
  - In `CountdownOverlay`, render tuning (formatted with `formatTuningDisplay`) and custom field badges below the title/artist when available; omit container when empty. Preserve existing overlay styles (`p-8`, `text-[30vh]`, `mt-4 w-full px-4`, `text-xl` title).
- `src/components/layout/__tests__/SetlistPlayer.test.tsx`:
  - Add Vitest unit tests asserting that the countdown overlay displays the resolved tuning and custom field values when available, formats tuning canonically, renders cleanly with no badges when neither is present, wraps without errors, discards stale `getSongDetails` responses after navigation, and applies truncation classes (`truncate`, `max-w-full`, `min-w-0`) to prevent overflow with long names, values, and tunings at 375 px.

### Test criteria
- `SetlistPlayer.test.tsx` (Vitest, jsdom):
  - Starting the countdown on an upcoming song with tuning displays `formatTuningDisplay(tuning)` (e.g. "Eb (-0.5)") in the countdown overlay.
  - Starting the countdown on an upcoming song with custom fields displays their names and values (e.g. "Capo: 2") in the countdown overlay.
  - Starting the countdown on an upcoming song with neither tuning nor custom fields renders cleanly without blank badges or empty containers.
  - Advancing fake timers and skipping/cancelling countdown functions as before without regression.
  - Stale responses: A pending `getSongDetails` fetch that resolves after navigation (e.g. `next()` or song change) does not update state or overwrite the active song's metadata.
  - Mobile constraints and overflow: Verify that items with arbitrarily long custom field names, values, and custom tunings have `truncate` and `max-w-full min-w-0` applied so they fit within the container and do not cause horizontal overflow on a 375 px mobile viewport.

## Behavior changes
- changed: Fast View and queue — The setlist player shows a full-screen 5-second countdown overlay with the upcoming title, resolved tuning, custom fields, and a skip control before each song starts. (RH-198)

## Expected Results
- [ ] The setlist player countdown overlay displays the resolved tuning of the upcoming song when present.
- [ ] The countdown overlay displays the user's custom field names and values for the upcoming song when present.
- [ ] When the upcoming song has neither tuning nor custom field values, the countdown overlay renders cleanly without blank badges or layout shift.
- [ ] The tuning and custom field elements fit without horizontal overflow on a 375 px mobile viewport.
- [ ] A Vitest test asserts that tuning and custom field values are rendered in the countdown overlay when available.

## Operator Results Coverage
- Operator Result 1 ("The setlist player countdown overlay displays the resolved tuning of the upcoming song when present.") is covered by Approach § Behavior and Expected Result 1.
- Operator Result 2 ("The countdown overlay displays the user's custom field names and values for the upcoming song when present.") is covered by Approach § Behavior and Expected Result 2.
- Operator Result 3 ("When the upcoming song has neither tuning nor custom field values, the countdown overlay renders cleanly without blank badges or layout shift.") is covered by Approach § Behavior and Expected Result 3.
- Operator Result 4 ("The tuning and custom field elements fit without horizontal overflow on a 375 px mobile viewport.") is covered by Approach § Mobile responsiveness and Expected Result 4.
- Operator Result 5 ("A Vitest test asserts that tuning and custom field values are rendered in the countdown overlay when available.") is covered by Approach § Test criteria and Expected Result 5.
