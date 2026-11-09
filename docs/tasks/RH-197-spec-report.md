# RH-197 — Spec Generator Report (round 3)

Spec: `docs/tasks/RH-197-spec.md` · Mock: `docs/tasks/RH-197-mock.html`

## Findings addressed

### 1. Mock vs spec — in-device toast and empty-state hint
- Removed the `#gesture-toast` element, the `toast` lookup, the `showToast()` function and all seven
  `showToast(...)` calls (navigation with queue position "(3/4)", queue start/end, drawing-blocked,
  ignored single tap, ignored scroll/pan). Each of those events still appears in the mock's
  side-panel "Histórico de Eventos" log, which is reviewer tooling outside the device frame, not app UI.
- Removed the hint line "Use as setas ou duplo toque nas bordas para navegar" from both empty states.
  The empty-state text now matches the spec verbatim: "No lyrics available for this song" and
  "No tab or chord chart available for this song".
- Verified with grep: no `toast`, `Toast` or `Use as setas` remains in the mock. The only `n / N`
  counter left is `#fastview-queue-pos` on the standard (non-stage) Fast View screen, outside Stage Mode.

### 2. Sanitization vs marker push order
Confirmed the problem in code: `usePdfStage.ts:100-111` and `useLyricsStage.ts:45-55` push the marker
in an effect; a page-level effect declared after the hook calls (page.tsx:147-150) would run after the
push and overwrite the marker.

Resolution: sanitization moved out of the page and into the hooks themselves.
- New `stripStageParam()` in `src/lib/stageHistory.ts` (beside `stageHistoryState`): removes only the
  `stage` param from the current entry via `replaceState(window.history.state, '', url)`.
- Both push effects call it after the `isOpen` guard and **before** `pushState(stageHistoryState(), '')`.
  Order is now guaranteed by statement order in one effect, not by hook declaration order.
- page.tsx does no `replaceState`.
- History sequence rewritten (step 1 sanitize-then-push; step 2 router.replace over the marker, then the
  destination mount repeats step 1; steps 3–5 both close paths land on a clean entry). The rejected
  ordering is documented with its failure mode.
- New Test Criteria item 5 (in `usePdfStage.test.tsx` and mirrored in `useLyricsEditor.test.tsx`):
  replaceState-before-pushState call order; marker state on top after mount; after ✕ close neither the
  current entry nor the one below has `stage=`; Back (popstate) close is clean; no replaceState without
  `stage` in the URL.
- Files Touched updated (stageHistory.ts, both hook test files; page.tsx line reworded).

## Expected results
Unchanged from the operator's five (already verifiable; no rewording needed).

## Questions
None.
