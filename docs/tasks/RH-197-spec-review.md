VERDICT: APPROVED

Round 2 (findings-only re-review) of docs/tasks/RH-197-spec.md and docs/tasks/RH-197-mock.html.

## Blocking Findings
None.

## Verification of previous findings

1. **Mock vs spec (toast / hint line)** — resolved. `#gesture-toast` and every `showToast` call are gone from the mock (grep for `toast` finds nothing). Navigation, queue start and end, the drawing-blocked case, and ignored taps and scrolls now write only to the side-panel event log, which sits outside the device frame. Both empty states (`#stage-lyrics-empty`, `#stage-pdf-empty`) show only an icon and the spec's text ("No lyrics available for this song" / "No tab or chord chart available for this song"). The "Use as setas ou duplo toque…" hint line is gone. The stage overlays have no queue position. The striped edge-zone highlight and the "BORDA ESQ/DIR (20%)" labels are review aids that the top-bar checkbox switches off; they are not product UI. The script reaches every element with `document.getElementById`, so the mock does not open blank.

2. **§ Approach 3, sanitization vs marker push order** — resolved. The spec now puts `stripStageParam()` (new, in `src/lib/stageHistory.ts`) inside each stage hook's existing push effect, right after the `isOpen` guard and before `pushState(stageHistoryState(), '')`. It says plainly that the page performs no `replaceState`, and it names the rejected ordering. `stripStageParam` replaces the current URL and keeps `window.history.state`, so the marker is pushed on top of a clean entry and still has its stage state. `close()` then still calls `history.back()` as before (usePdfStage.ts:91, useLyricsStage.ts:37; the push effect is at usePdfStage.ts:100-103 and useLyricsStage.ts:45-48). Test Criteria 5 covers this: replaceState is called before pushState (checked by spy call order), the marker is current after mount, the URL is clean after closing with ✕ and after Back (popstate), and nothing happens when the URL has no `stage`. Files Touched lists the new test files and `stageHistory.ts`.

Consistency pass on the changed sections (§ 2 hooks, § 3 history sequence, Files Touched, Test Criteria 5): no new contradiction. Step 2 (router.replace onto the marker, then the destination mounts with initialOpen, cleans its entry and pushes a fresh marker) agrees with step 1's order.

## Suggestions
- In Test Criteria 5, the ✕ case says "the current entry … and the entry that was below the marker (the one now current)", which describes the same entry twice. Also, jsdom's `history.back()` is asynchronous: the test should wait for the popstate/navigation before it asserts.
- In-stage navigation uses `router.replace` to put the destination's `?stage=` URL in place of the marker. With React StrictMode in dev, the push effect runs twice. This matches the hooks' existing behaviour, but the implementer should check that it does not push two markers in dev.
