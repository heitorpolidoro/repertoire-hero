# RH-197 — Navigate between queued songs in Stage Mode with arrow keys and edge double-tap

Mock: [`docs/tasks/RH-197-mock.html`](RH-197-mock.html) (Fast View Stage Mode navigation).

## Scope

In Fast View Stage Mode (full-screen Lyrics Stage Mode or PDF/Tab Drawing Stage Mode), musicians currently have keyboard setlist navigation disabled and have no touch gesture to advance or backtrack across the active song queue.

This task enables moving through the active Fast View song queue while inside Stage Mode:
1. **Keyboard navigation**: pressing `ArrowRight` or `ArrowLeft` navigates to the next or previous queued song (when an entry exists), without exiting Stage Mode. `ArrowUp` and `ArrowDown` remain reserved for vertical reading/scrolling and do not trigger song navigation in Stage Mode.
2. **Edge double-tap navigation**: double-tapping within the screen's left edge zone navigates to the previous song in the queue, and double-tapping within the right edge zone navigates to the next song.
3. **Drawing mode safety**: while drawing mode is active in PDF Stage Mode, edge double-taps are suppressed so that drawing or erasing strokes near document borders never triggers song transitions.
4. **Gesture isolation**: single taps, vertical scrolling in lyrics, and two-finger pinch-to-zoom or pan gestures in PDF Stage Mode do not trigger song navigation.
5. **Stage continuity & missing content handling**: navigating to a neighbouring song from within Stage Mode preserves Stage Mode on the destination song (opening Lyrics Stage Mode if navigating from Lyrics Stage Mode, or PDF Stage Mode if navigating from PDF Stage Mode). If the destination song has no lyrics or no tab file, Stage Mode remains open, rendering the stage header controls alongside a clear empty-state message, preserving keyboard and edge double-tap traversal across the queue.

Explicitly out of scope:
- Multi-finger swipe gestures inside Stage Mode (swipe continues to trigger page turns or canvas panning where applicable).
- Changing song queue storage shape or lifetime in `sessionStorage`.
- Modifying non-stage Fast View keyboard navigation (up/down arrows outside Stage Mode keep their pedal-friendly behaviour).
- Navigating beyond queue bounds (at the first song, previous navigation is a no-op; at the last song, next navigation is a no-op; neither wraps around).
- Adding queue position chrome, footer tips, or floating status badges to Stage Mode surfaces.

## Approach

### 1. Pure Decision Logic (`src/lib/stageNav.ts` and `src/lib/playlistNav.ts`)
- **Edge zone determination**: `isEdgeZone(clientX: number, viewportWidth: number): 'left' | 'right' | null`
  - Defines the edge trigger width as 20% of viewport width with a minimum of 64px (`Math.max(64, Math.round(viewportWidth * 0.2))`).
  - Returns `'left'` if `clientX <= edgeWidth`.
  - Returns `'right'` if `clientX >= viewportWidth - edgeWidth`.
  - Returns `null` if `clientX` falls in the central reading area.
- **Double-tap evaluation**: `evaluateDoubleTap(lastTap: TapRecord | null, currentTap: TapRecord): 'prev' | 'next' | null`
  - A valid double-tap requires:
    1. `lastTap !== null`.
    2. Both taps occurred in the same edge zone (`currentTap.zone === lastTap.zone`).
    3. Time delta between taps is within `DOUBLE_TAP_MAX_DELAY_MS` (350 ms).
    4. Distance between taps is within `DOUBLE_TAP_MAX_DISTANCE_PX` (50 px).
  - Returns `'prev'` when the double-tap completes in the left edge zone; returns `'next'` when it completes in the right edge zone; returns `null` otherwise.
- **Tap gesture validation**: `isTapCandidate(pointerMoveDistancePx: number, durationMs: number): boolean`
  - Rejects gestures with pointer travel greater than `TAP_MOVE_TOLERANCE_PX` (15 px) or duration exceeding `TAP_MAX_DURATION_MS` (500 ms).
  - This cleanly filters out vertical lyric scrolls, canvas drags, and long presses.
- **Stage Mode keyboard target**: `keyboardTarget(press: NavKeyPress, nav: PlaylistNav | null, options?: { inStageMode?: boolean })`
  - When `inStageMode: true`, only `'ArrowRight'` maps to `{ versionId: nav.nextId, direction: 'left' }` and `'ArrowLeft'` maps to `{ versionId: nav.prevId, direction: 'right' }`. `'ArrowDown'` and `'ArrowUp'` return `null` so they do not hijack scrolling.
  - When `inStageMode: false` (or omitted), existing pedal/arrow mapping (`ArrowDown`/`ArrowUp` included) is preserved.
- **Stage Mode route href**: `fastViewHref(versionId: string, bandId: string | null, stage?: 'lyrics' | 'pdf' | null): string`
  - Accepts an optional `stage` parameter.
  - When provided, appends `stage=lyrics` or `stage=pdf` to the query string (e.g. `/songs/[versionId]/fast-view?bandId=...&stage=lyrics`).

### 2. Controller & Hook Integration
- **`usePlaylistNav` (`src/hooks/usePlaylistNav.ts`)**:
  - Accepts `activeStage?: 'lyrics' | 'pdf' | null`.
  - Enables keyboard navigation while a stage is open (`keyboardEnabled: !isCountingDown`), passing `inStageMode: activeStage !== null` to `keyboardTarget`.
  - In `slideAwayTo`, when `activeStage !== null`, executes navigation via `router.replace(fastViewHref(targetId, hrefBandId, activeStage))` instead of `router.push`. This replaces the in-stage history entry rather than stacking intermediate song markers across the setlist.
  - Exposes `goNext()` alongside existing `goPrev()`.
- **`useEdgeDoubleTap` (`src/hooks/useEdgeDoubleTap.ts`)**:
  - Shared hook encapsulating edge double-tap detection for Stage Mode overlays.
  - Accepts `{ enabled: boolean, onPrev: () => void, onNext: () => void }`.
  - Attaches pointer/touch handlers to track tap start, tap end, movement distance, and elapsed time.
  - Discards events if `enabled` is false, if multi-touch is detected (pinch/zoom), or if the event originates from an interactive control (button, input, select).
- **`stripStageParam` (`src/lib/stageHistory.ts`)**:
  - New helper next to `stageHistoryState`. If the current `window.location` carries a `stage` query parameter, it calls `window.history.replaceState(window.history.state, '', <same path and query with only `stage` removed>)`; otherwise it does nothing.
- **`usePdfStage` (`src/hooks/usePdfStage.ts`)**:
  - Accepts `initialOpen?: boolean` (used as the `useState` initial value of `isOpen`) to open the overlay immediately upon mount when `stage=pdf` is present in the route.
  - Its existing push effect (`if (!isOpen) return; … pushState(stageHistoryState(), '')`) calls `stripStageParam()` as its first statement after the `isOpen` guard, **before** `pushState`. See § 3 "History sequence" for why the order is fixed here.
- **`useLyricsStage` (`src/hooks/useLyricsStage.ts`)**:
  - Accepts `initialOpen?: boolean` (used as the `useState` initial value of `isStageOpen`) to open the lyrics overlay immediately upon mount when `stage=lyrics` is present in the route.
  - Its push effect calls `stripStageParam()` before `pushState(stageHistoryState(), '')`, exactly as `usePdfStage` does.
- **`useLyricsEditor` (`src/hooks/useLyricsEditor.ts`)**:
  - Passes `initialStageOpen?: boolean` down to `useLyricsStage`.
- **`useTabLibrary` (`src/hooks/useTabLibrary.ts`)**:
  - When mounting with `initialStageOpen` or `stage=pdf`, auto-selects the destination song's primary file (`is_primary: true`), falling back to the first available file (`tabs[0]`) so the drawing stage has a file to display.

### 3. Component Presentation, Missing Content & History Sequence
- **`TabDrawingStage` (`src/components/tabs/TabDrawingStage.tsx`)**:
  - Accepts an `onDrawingChange?: (drawing: boolean) => void` callback.
  - Fires `onDrawingChange(!drawingEnabled)` when drawing mode is toggled, and notifies `false` on unmount or tab change.
- **`PdfStageOverlay` (`src/components/fastview/PdfStageOverlay.tsx`)**:
  - Accepts `onNavigatePrev?: () => void`, `onNavigateNext?: () => void`, and `isLoading?: boolean`.
  - Maintains `isDrawing` via `TabDrawingStage`'s `onDrawingChange`.
  - Binds `useEdgeDoubleTap` with `enabled: !isDrawing && open`, ensuring strokes near screen edges while drawing never trigger song transitions.
  - When `open` is true but the song has no files (`!tabId` or `!fileUrl`), renders the stage header (title, key, close button) and an empty-state message ("No tab or chord chart available for this song") in the stage surface instead of returning `null`, keeping edge double-tap and keyboard navigation alive. While loading, shows a loading skeleton/indicator.
- **`LyricsStageOverlay` (`src/components/fastview/LyricsStageOverlay.tsx`)**:
  - Accepts `onNavigatePrev?: () => void` and `onNavigateNext?: () => void`.
  - Binds `useEdgeDoubleTap` to the overlay container, calling `onNavigatePrev` on left edge double-tap and `onNavigateNext` on right edge double-tap.
  - When `controller.isStageOpen` is true but `controller.displayedLyrics` is empty or null, renders the sticky header and an empty-state message ("No lyrics available for this song") in the reading body instead of returning `null`, keeping edge double-tap and keyboard navigation alive.
- **`FastViewOverlays` (`src/components/fastview/FastViewOverlays.tsx`)**:
  - Forwards `onNavigatePrev` and `onNavigateNext` callbacks from `usePlaylistNav` down to `LyricsStageOverlay` and `PdfStageOverlay`.
- **`FastViewPage` (`src/app/songs/[versionId]/fast-view/page.tsx`)**:
  - Derives `activeStage: 'pdf' | 'lyrics' | null` based on `pdfStage.isOpen` and `lyrics.isStageOpen`.
  - Inspects `searchParams.get('stage')` on mount to initialize `initialOpen` on `usePdfStage` (`stage === 'pdf'`) and `useLyricsEditor` (`stage === 'lyrics'`).
  - The page itself performs **no** `replaceState`; URL sanitization lives inside the stage hooks' push effects (§ 2), so it cannot run after the marker push.
  - **History sequence** (sanitize strictly before push):
    1. Opening Stage Mode (manually or via `initialOpen`) runs the hook's push effect, which first calls `stripStageParam()` — rewriting the *current* entry in place to the URL without `stage=` while keeping its state — and only then pushes the single stage marker with `window.history.pushState(stageHistoryState(), '')`. The marker therefore sits on top of an already clean entry, and the marker keeps its `stageMode` state.
    2. In-stage navigation executes `router.replace(fastViewHref(nextId, bandId, activeStage))`, which replaces the marker entry with the destination URL carrying `stage=`. The destination page mounts with `initialOpen`, and step 1 runs again: that entry is cleaned in place, and a fresh marker is pushed above it. No intermediate song entries pile up.
    3. On close via Close button (✕), `close()` / `closeStage()` sets open state to `false`; because the current entry is the marker (`isStageHistoryEntry` is true), it calls `window.history.back()`, landing on the clean entry below.
    4. On close via Back button / gesture, the browser pops the marker, `popstate` fires and sets open state to `false`, landing on the same clean entry.
    5. In both close paths, neither the current entry nor any entry below it created by this flow contains `stage=`, so refreshing the page never re-opens Stage Mode.
    - Rejected ordering: a `replaceState` placed in a page-level `useEffect` declared after `usePdfStage`/`useLyricsEditor` runs *after* their push. It would overwrite the marker (its state becomes non-stage, so `close()` skips `history.back()`), and the entry below would keep `stage=`.

## Files Touched
- `src/lib/stageNav.ts` — pure decision logic for edge zones (`isEdgeZone`), tap movement validation (`isTapCandidate`), and double-tap detection (`evaluateDoubleTap`).
- `src/lib/playlistNav.ts` — `fastViewHref` stage parameter support and `keyboardTarget` in-stage mode filtering (allowing `ArrowLeft`/`ArrowRight`, suppressing `ArrowUp`/`ArrowDown`).
- `src/hooks/usePlaylistNav.ts` — accepts `activeStage`, enables keyboard navigation in stage mode, executes `router.replace` when navigating with an active stage, and exposes `goNext`.
- `src/hooks/useEdgeDoubleTap.ts` — reusable pointer/touch hook handling edge double-taps, gesture movement thresholds, and interactive control exclusion.
- `src/lib/stageHistory.ts` — adds `stripStageParam()`, which removes `stage` from the current entry's URL via `replaceState`, keeping its state.
- `src/hooks/usePdfStage.ts` — `initialOpen` support for incoming `stage=pdf` param; the push effect calls `stripStageParam()` before `pushState`.
- `src/hooks/useLyricsStage.ts` — `initialOpen` support for incoming `stage=lyrics` param; the push effect calls `stripStageParam()` before `pushState`.
- `src/hooks/useLyricsEditor.ts` — passes `initialStageOpen` through to `useLyricsStage`.
- `src/hooks/useTabLibrary.ts` — auto-selects primary tab (`is_primary`) or first tab (`tabs[0]`) when entering with `stage=pdf`.
- `src/components/tabs/TabDrawingStage.tsx` — reports drawing state via `onDrawingChange?: (drawing: boolean) => void`.
- `src/components/fastview/LyricsStageOverlay.tsx` — binds edge double-tap navigation; renders empty state when song has no lyrics instead of returning `null`.
- `src/components/fastview/PdfStageOverlay.tsx` — receives navigation callbacks, tracks drawing state via `onDrawingChange`, binds edge double-taps when drawing is off, and renders empty state when no files exist.
- `src/components/fastview/FastViewOverlays.tsx` — forwards navigation callbacks to `LyricsStageOverlay` and `PdfStageOverlay`.
- `src/app/songs/[versionId]/fast-view/page.tsx` — composition root wiring of `activeStage`, `stage` param consumption into `initialOpen` / `initialStageOpen`, and `usePlaylistNav` navigation options (no `replaceState` here).
- `src/hooks/__tests__/usePdfStage.test.tsx` — history-order test for `stage=pdf` entry and ✕ / Back close.
- `src/hooks/__tests__/useLyricsEditor.test.tsx` — the same history-order test for `stage=lyrics`.
- `src/lib/__tests__/stageNav.test.ts` — unit tests for pure edge zone and double-tap logic.
- `src/lib/__tests__/playlistNav.test.ts` — unit tests for `fastViewHref` with stage parameter and stage-mode `keyboardTarget`.
- `src/hooks/__tests__/usePlaylistNav.test.ts` — tests for keyboard navigation in stage mode, `router.replace` navigation with stage param, and `goNext`.
- `src/hooks/__tests__/useEdgeDoubleTap.test.ts` — unit tests for edge double-tap hook and gesture isolation.

## Test Criteria
1. `src/lib/__tests__/stageNav.test.ts` verifies:
   - `isEdgeZone` returns `'left'` within the left 20% / 64px, `'right'` within the right 20% / 64px, and `null` in the middle.
   - `evaluateDoubleTap` returns `'prev'` for two consecutive taps in the left zone within 350 ms and 50 px.
   - `evaluateDoubleTap` returns `'next'` for two consecutive taps in the right zone within 350 ms and 50 px.
   - `evaluateDoubleTap` returns `null` for taps in opposite zones, taps separated by > 350 ms, or taps separated by > 50 px.
   - `isTapCandidate` rejects movements > 15 px (scroll/pan) and gestures longer than 500 ms.
2. `src/lib/__tests__/playlistNav.test.ts` verifies:
   - `fastViewHref` appends `stage=lyrics` or `stage=pdf` when specified, and keeps bare trailing `?` when only `bandId` is absent.
   - `keyboardTarget` with `inStageMode: true` maps `ArrowRight` and `ArrowLeft` but returns `null` for `ArrowDown` and `ArrowUp`.
3. `src/hooks/__tests__/usePlaylistNav.test.ts` verifies:
   - Pressing `ArrowRight` / `ArrowLeft` triggers navigation when `keyboardEnabled` is active even if a stage is up.
   - Stage mode navigation replaces the route (`router.replace`) preserving `stage` query param.
   - `goNext` navigates to next queued song.
4. `src/hooks/__tests__/useEdgeDoubleTap.test.ts` verifies:
   - Double-tap calls `onNext` on right edge and `onPrev` on left edge.
   - Double-tap does nothing when `enabled: false`.
   - Single tap alone does not fire `onNext` or `onPrev`.
   - Vertical drag movement does not trigger double-tap.
   - Taps on button/input elements are ignored.
5. `src/hooks/__tests__/usePdfStage.test.tsx` (and the mirror case in `useLyricsEditor.test.tsx` with `stage=lyrics`) verifies, starting from a jsdom location of `/songs/v-2/fast-view?bandId=b-1&stage=pdf` and mounting with `initialOpen: true`:
   - The push effect calls `replaceState` (URL without `stage=`) before `pushState(stageHistoryState(), '')` — asserted by call order on spies.
   - Right after mount, `window.history.state` is the stage marker (`isStageHistoryEntry` true) and `window.location.search` has no `stage=`.
   - After closing with ✕ (`close()`), the current entry is not a stage marker and `window.location.search` has no `stage=`, and the entry that was below the marker (the one now current) has no `stage=` either.
   - After closing via a dispatched `popstate` (Back), the overlay is closed and `window.location.search` has no `stage=`.
   - Mounting without `stage` in the URL never calls `replaceState`.
6. DOM integration / E2E verification:
   - In Lyrics Stage Mode or PDF Stage Mode, pressing arrow keys or double-tapping screen edges switches songs and keeps Stage Mode open.
   - Navigating to a song without lyrics or tabs keeps Stage Mode open with the appropriate empty state message and retains edge double-tap / keyboard navigation.
   - While drawing mode is active in PDF Stage Mode, edge double-taps do not trigger song navigation.
   - Closing Stage Mode via Close button or Back button leaves a clean URL without `stage=`.

## Behavior changes
changed: Fast View and queue — Users move through the queue by swipe, arrow keys or the setlist list, with ArrowLeft and ArrowRight enabled in Stage Mode while ArrowUp and ArrowDown remain off. (RH-197)
added: Fast View and queue — In Stage Mode (lyrics or PDF tab), users navigate between queued songs using ArrowLeft/ArrowRight or double-tapping the left/right screen edges, keeping Stage Mode open on the destination song. (RH-197)

## Operator Results Coverage
- **Original Operator Result 1**: Covered by Section 1 & 2 (`keyboardTarget` and `usePlaylistNav` stage keyboard support) and Returned Expected Result 1.
- **Original Operator Result 2**: Covered by Section 1, 2 & 3 (`isEdgeZone`, `evaluateDoubleTap`, `useEdgeDoubleTap`, `LyricsStageOverlay`, `PdfStageOverlay`) and Returned Expected Result 2.
- **Original Operator Result 3**: Covered by Section 2 & 3 (`TabDrawingStage` reporting drawing state via `onDrawingChange` and `PdfStageOverlay` disabling `useEdgeDoubleTap`) and Returned Expected Result 3.
- **Original Operator Result 4**: Covered by Section 1 & 2 (`isTapCandidate` discarding movement > 15 px, duration > 500 ms, and multi-touch) and Returned Expected Result 4.
- **Original Operator Result 5**: Covered by Section 1, 2 & 3 (`fastViewHref` preserving `stage`, `initialOpen` on stage hooks, `useTabLibrary` tab auto-selection, empty-state rendering in stage overlays, and URL sanitization) and Returned Expected Result 5.

## Expected Results
- [ ] Pressing ArrowRight or ArrowLeft while Lyrics Stage Mode or PDF Stage Mode is open navigates to the next or previous song in the active Fast View queue when a next or previous entry exists.
- [ ] Double-tapping the right edge zone in Lyrics Stage Mode or PDF Stage Mode (when drawing mode is off) navigates to the next song in the active queue, and double-tapping the left edge zone navigates to the previous song.
- [ ] While drawing mode is active in PDF Stage Mode, edge double-taps do not trigger song navigation.
- [ ] Single taps, vertical scrolling in Lyrics Stage Mode, and pinch/pan gestures in PDF Stage Mode do not trigger song navigation.
- [ ] Navigating to the previous or next song from within Stage Mode keeps Stage Mode open on the destination song.

## Out of Scope
- Swipe gestures inside Stage Mode for queue traversal (swipe is reserved for page turns and stage panning).
- Changing song queue schema in `sessionStorage` or persisting navigation history beyond active tab session.
- ArrowUp / ArrowDown song switching in Stage Mode (these remain available for vertical scrolling of lyrics or canvas).
- Edge double-tap navigation outside of Stage Mode (standard Fast View continues using horizontal swipe gestures, drawer, and desktop prev arrow).
- Adding queue position chrome, footer tips, or floating status badges to Stage Mode surfaces.
