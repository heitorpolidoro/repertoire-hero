# RH-50 - Fast View parte 3/5: extrair o overlay do Stage Mode de PDF

Part 3 of 5 of the RH-38 decomposition of `src/app/songs/[id]/fast-view/page.tsx`
(parent RH-38; RH-25 T5, covers F6). Baseline for every measurement in this spec
is `6b30ddb` ("refactor(RH-49): extract Fast View tab library, active tab and
upload"), where the page is 1091 lines and `FastViewPage` has an ESLint
cyclomatic complexity of 67.

## Scope

This task moves the **PDF Stage Mode overlay** out of the Fast View page and
nothing else. Concretely it covers:

- `findScrollHost` (page lines 85-98) moved into `src/lib`, plus the
  lock/restore of that host expressed as a second small function there;
- the `{ stageMode: true }` history marker turned into two shared helpers in
  `src/lib`, so the PDF half and the lyrics half of today's single popstate
  effect can be split without either of them re-inventing the marker;
- one controller hook in `src/hooks` that owns the PDF stage's open/close state,
  the visual-viewport measurement (page lines 204-238), the scroll-host lock
  (page lines 240-256), the back-button popstate intercept for the PDF half
  (page lines 187-202) and the RH-46 annotation load/save (page lines 272-301);
- one presentational component `src/components/fastview/PdfStageOverlay.tsx`
  carrying the overlay JSX verbatim (page lines 1014-1055);
- the composition root for the two annotation Server Actions, added to the
  existing `src/app/fastViewTabActions.ts`;
- unit tests for the two lib modules, `renderHook` tests for the controller with
  injected fake actions, and a jsdom test for the component.

It is a behaviour-preserving refactor: no user-visible change, no schema change,
no change to `TabDrawingStage` or to any RH-20/RH-28 guard test.

What this task does **not** cover: the lyrics Stage Mode overlay and its
`isStageMode` state (RH-51, part 4); the page's entry/status/links/lyrics
sections and the page shell (RH-52, part 5); any change to
`src/components/tabs/TabDrawingStage.tsx`, `src/lib/stageInteraction.ts`,
`src/lib/annotationMath.ts`, `src/app/actions/tabs.ts`, `src/lib/tabs.ts` or the
tab-library controller shipped by RH-49; the two red RH-44 e2e specs; and the
two pre-existing ESLint errors in the page (`prefer-const` on `let html` in
`parseLyricsMarkdown`, `@typescript-eslint/no-explicit-any` in the status
dropdown), which are outside this slice and stay exactly as they are.

## Audit at 6b30ddb

Every PDF-Stage-Mode site in `src/app/songs/[id]/fast-view/page.tsx` (1091
lines), with its line range and its destination.

| Lines | What is there today | Destination |
|---|---|---|
| 9 | `import { getTabAnnotationsAction, saveTabAnnotationsAction } from '@/app/actions/tabs'` | deleted from the page; both actions are wired in `src/app/fastViewTabActions.ts` |
| 10 | `import TabDrawingStage from '@/components/tabs/TabDrawingStage'` | moves to `PdfStageOverlay.tsx` |
| 14 | `import { stageViewportHeight, isStableViewportMeasurement } from '@/lib/stageInteraction'` | moves to `usePdfStage.ts` |
| 85-98 | doc comment + `function findScrollHost(node)` walking `parentElement` and testing `getComputedStyle(el).overflowY` for `auto`/`scroll` | moves verbatim to `src/lib/scrollHost.ts` |
| 151 | `const [isStageMode, setIsStageMode] = useState(false)` (lyrics) | **stays** on the page (RH-51 owns it) |
| 154 | `const [isPdfStageMode, setIsPdfStageMode] = useState(false)` | becomes `isOpen` inside `usePdfStage` |
| 155 | `const pdfStageOverlayRef = useRef<HTMLDivElement>(null)` | becomes `overlayRef` returned by `usePdfStage` |
| 156 | `const [pdfStageHeight, setPdfStageHeight] = useState<number \| null>(null)` | becomes `height` inside `usePdfStage` |
| 187-202 | the **shared** popstate effect: `if (!isStageMode && !isPdfStageMode) return`, `window.history.pushState({ stageMode: true }, '')`, a `handlePopState` that clears **both** flags, subscribe/unsubscribe on `popstate` | **split**, see "The popstate boundary" below |
| 204-238 | visual-viewport effect keyed on `isPdfStageMode`: reads `window.visualViewport`, guards with `isStableViewportMeasurement(vv?.scale)`, stores `stageViewportHeight(vv?.height, window.innerHeight)`, subscribes to `vv` `resize`+`scroll` and `window` `resize`+`orientationchange`, and on cleanup removes all four and sets the height back to `null` | moves to `usePdfStage.ts` |
| 240-256 | scroll-lock effect keyed on `isPdfStageMode`: `findScrollHost(pdfStageOverlayRef.current)`, `if (!host) return`, save `host.style.overflow`, set `'hidden'`, restore the saved string verbatim on cleanup | moves to `usePdfStage.ts`, with the save/set/restore expressed as `lockScrollHost` in `src/lib/scrollHost.ts` |
| 258-263 | `closeStageMode` (lyrics): clears `isStageMode`, then `if (window.history.state?.stageMode) window.history.back()` | **stays** on the page, with the marker test replaced by the shared `isStageHistoryEntry(window.history.state)` |
| 265-270 | `closePdfStageMode`: identical shape for the PDF flag | becomes `close()` inside `usePdfStage` |
| 272-278 | `stageAnnotations` state, typed `{ tabId: string; data: TabAnnotations; error: string \| null } \| null` (RH-46 keying by tab) | moves to `usePdfStage.ts`, unchanged in shape |
| 280-290 | annotation load effect: `if (!isPdfStageMode \|\| !activeTabId \|\| !activeTabRepertoireId) return`, `getTabAnnotationsAction(...)`, `cancelled` guard, stores `{ tabId, data: res.data ?? {}, error: res.error ?? null }` | moves to `usePdfStage.ts`, with the action injected |
| 292-293 | `stageAnnotationsForTab` = the payload only when `stageAnnotations.tabId === activeTabId` | moves to `usePdfStage.ts` and is what the returned `annotations` / `annotationsError` are derived from |
| 295-301 | `handleSaveStageAnnotations` `useCallback`: returns `{ error: 'Tab not found' }` when either id is missing, else `saveTabAnnotationsAction(tabId, repertoireId, pageNumber, strokes)` | becomes `saveAnnotations` inside `usePdfStage`, same early return and same message |
| 659 | `onOpenStage={() => setIsPdfStageMode(true)}` on `<TabLibrarySection>` | becomes `onOpenStage={pdfStage.open}` |
| 1014-1055 | the overlay JSX: root `div` with `ref`, `className="fixed inset-x-0 top-0 z-50 bg-black flex flex-col"` and an inline style carrying exactly `height` (measured px, else `'100dvh'`), `touchAction: 'pan-x pan-y'`, `overflow: 'hidden'`, `overscrollBehavior: 'contain'`; a header bar with the tab title (`activeTabTitle \|\| 'PDF Tab'`), the song title and `key ? \`* ${key}\` : ''`, and the red close button; then `<TabDrawingStage key={activeTabId} fileUrl annotations annotationsError onSaveAnnotations />` | moves verbatim to `src/components/fastview/PdfStageOverlay.tsx` |

Inputs the overlay consumes from RH-49's controller (page line 174):
`activeTabId`, `activeTabRepertoireId`, `activeTabUrl`, `activeTabTitle`. They
stay exactly where they are; this task only changes who reads them.

Measured baselines used by the Expected Results (all at `6b30ddb`):

- `wc -l "src/app/songs/[id]/fast-view/page.tsx"` prints `1091`.
- `npx eslint "src/app/songs/[id]/fast-view/page.tsx" --rule '{"complexity":["error",15]}'` prints three problem lines, one of which is `Function 'FastViewPage' has a complexity of 67. Maximum allowed is 15`.
- `grep -c "getTabAnnotationsAction\|saveTabAnnotationsAction\|findScrollHost\|visualViewport" "src/app/songs/[id]/fast-view/page.tsx"` prints `6`.
- `grep -c "isPdfStageMode\|pdfStageHeight\|pdfStageOverlayRef" "src/app/songs/[id]/fast-view/page.tsx"` prints `15`.
- `grep -c "popstate" "src/app/songs/[id]/fast-view/page.tsx"` prints `2`.
- `grep -rln "stageMode: true" src` lists exactly `src/app/songs/[id]/fast-view/page.tsx`.
- No test file reads the page source: the only guard test that mentions Fast View is `src/lib/__tests__/pdfWorkerAsset.test.ts`, and it only matches the *route* `/songs/1/fast-view` against the `src/proxy.ts` matcher. `src/lib/__tests__/erasePersistence.test.ts` reads `src/components/tabs/TabDrawingStage.tsx` only. So moving page code cannot break a guard test as long as `TabDrawingStage.tsx` is untouched.

### The popstate boundary (explicit decision)

Today's single effect (187-202) serves **both** stage modes: it fires when either
`isStageMode` (lyrics, RH-51) or `isPdfStageMode` (this task) is true, pushes one
history entry `{ stageMode: true }`, and its `handlePopState` clears **both**
flags.

**Decision.** The effect is split in two, one per owner, and the marker itself is
extracted so the two halves cannot drift:

1. `src/lib/stageHistory.ts` owns the marker: `stageHistoryState()` returns the
   object that is pushed, `isStageHistoryEntry(state)` answers whether the entry
   on top of the history stack is a Stage Mode entry. The literal
   `{ stageMode: true }` exists in exactly one non-test source file after this
   task.
2. `usePdfStage` owns the **PDF half**: an effect keyed on its own `isOpen` that
   pushes `stageHistoryState()` on open, subscribes to `popstate`, and on
   `popstate` sets `isOpen` to false. `close()` mirrors the current
   `closePdfStageMode`: set `isOpen` false, then `if (isStageHistoryEntry(window.history.state)) window.history.back()`.
3. The **page keeps the lyrics half** verbatim, narrowed to `isStageMode` alone
   (`if (!isStageMode) return`, handler `setIsStageMode(false)`, dependency array
   `[isStageMode]`), and `closeStageMode` uses the same
   `isStageHistoryEntry(window.history.state)` test. RH-51 moves this half, and
   only this half, into the lyrics controller, reusing `src/lib/stageHistory.ts`
   unchanged - that is what this boundary buys part 4.

**Why this is behaviour-preserving.** The two overlays are mutually exclusive by
construction: each is a `fixed ... z-50` full-screen surface that covers the only
trigger of the other (the lyrics "Stage Mode" button at page lines 783-791 sits
under the PDF overlay; the tab library's "Stage Mode" button sits under the
lyrics overlay). The single-effect and the split-effect behaviours can only
differ while both flags are true at once, which the UI cannot reach. In every
reachable state the split pushes exactly one entry, one `popstate` handler is
subscribed, and back closes the overlay that is on screen - identical to today.
The hook test `pushes exactly one history entry when the stage opens` pins the
"one entry" half of that mechanically.

No `history.replaceState`, no router push and no `popstate` behaviour other than
the above is introduced.

## Approach

### 1. `src/lib/scrollHost.ts` (new)

DOM helpers, no React, no App Router import. Two exports:

```ts
/** Nearest scrollable DOM ancestor of `node`, resolved by computed overflow. */
export function findScrollHost(node: HTMLElement | null): HTMLElement | null

/**
 * Freezes `host`'s inline overflow at 'hidden' and returns the restore closure,
 * which writes the previous inline value back verbatim. A null host yields a
 * no-op restore.
 */
export function lockScrollHost(host: HTMLElement | null): () => void
```

`findScrollHost` is the page's function moved verbatim, doc comment included (the
two-`<main>` explanation is exactly why it resolves by computed overflow and not
by tag name). `lockScrollHost` is the save/set/restore of page lines 249-255,
with the same "restored verbatim" comment, so an element that had no inline
overflow goes back to having none rather than being frozen.

Tests: `src/lib/__tests__/scrollHost.test.ts`, first line exactly
`// @vitest-environment jsdom` (the module needs `getComputedStyle`; the rest of
`src/lib/__tests__` stays on the default `node` environment). Nine tests, names
listed in ER2. Fixtures are plain `document.createElement('div')` trees appended
to `document.body`, with `el.style.overflowY = 'auto' | 'scroll' | 'visible'`;
`afterEach` empties `document.body`.

### 2. `src/lib/stageHistory.ts` (new)

Pure, no DOM access, default `node` test environment. Two exports:

```ts
/** The history entry Stage Mode pushes so the back button closes it. */
export function stageHistoryState(): { stageMode: true }

/** True when `state` is the entry `stageHistoryState()` pushed. */
export function isStageHistoryEntry(state: unknown): boolean
```

`isStageHistoryEntry` reads the flag through a scoped structural cast
(`(state as { stageMode?: unknown } | null)?.stageMode === true`), never an
`any`-typed binding, per the AGENTS.md error-handling conventions. Tests:
`src/lib/__tests__/stageHistory.test.ts`, three tests, names in ER2.

### 3. `src/hooks/usePdfStage.ts` (new) - the single controller

```ts
export interface PdfStageActions {
  getAnnotations: (tabId: string, repertoireId: string) =>
    Promise<{ data?: TabAnnotations; error?: string }>
  saveAnnotations: (tabId: string, repertoireId: string, pageNumber: number, strokes: Stroke[]) =>
    Promise<{ success?: boolean; error?: string }>
}

/** The slice of `window.visualViewport` this hook uses; a test passes a fake. */
export interface VisualViewportLike {
  height?: number
  scale?: number
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

export interface UsePdfStageOptions {
  /** `activeTabId` from `useTabLibrary`; null when no tab is selected. */
  tabId: string | null
  /** `activeTabRepertoireId` from `useTabLibrary`. */
  repertoireId: string | null
  /** Required, never defaulted - see `src/app/fastViewTabActions.ts` (F21). */
  actions: PdfStageActions
  /** Test seam. Defaults to a module-level reader of `window.visualViewport`. */
  getViewport?: () => VisualViewportLike | null | undefined
}

export interface PdfStageController {
  isOpen: boolean
  open: () => void
  close: () => void
  overlayRef: RefObject<HTMLDivElement | null>
  /** Measured visual-viewport height in px; null before the first measurement. */
  height: number | null
  /** null while loading, `{}` for a tab with none (RH-46 prop contract). */
  annotations: TabAnnotations | null
  annotationsError: string | null
  saveAnnotations: (pageNumber: number, strokes: Stroke[]) =>
    Promise<{ success?: boolean; error?: string }>
}

export function usePdfStage(options: UsePdfStageOptions): PdfStageController
```

The default viewport reader is a **module-level const**
(`const WINDOW_VIEWPORT = () => (typeof window !== 'undefined' ? window.visualViewport : undefined)`),
so its identity is stable and the measurement effect cannot be restarted by a
re-render - the same reason `TAB_LIBRARY_ACTIONS` is module-level in RH-49.

Internal state: `isOpen`, `height`, `payload` (`{ tabId; data; error } | null`,
the RH-46 keying), and `overlayRef`. Four effects, each keyed on `isOpen` (plus
`tabId`/`repertoireId` for the last one), each a verbatim move of the
corresponding page effect:

1. **popstate** - see the boundary decision above.
2. **visual viewport** - `const vv = getViewport()`; `measure()` returns early
   when `!isStableViewportMeasurement(vv?.scale)`, otherwise
   `setHeight(stageViewportHeight(vv?.height, window.innerHeight))`; subscribes
   `vv` `resize` **and** `scroll` plus `window` `resize` and `orientationchange`;
   cleanup removes all four and sets `height` back to `null`.
   `visualViewport.offsetTop` is never read (RH-28 section 2).
3. **scroll-host lock** - `const release = lockScrollHost(findScrollHost(overlayRef.current))`,
   returned as the cleanup. `document.body.style.overflow` is never touched
   (RH-28 section 3).
4. **annotation load** - unchanged, with `actions.getAnnotations` in place of the
   direct import and the same `cancelled` guard and `{ tabId, data: res.data ?? {}, error: res.error ?? null }`
   payload.

`annotations` / `annotationsError` are derived exactly as `stageAnnotationsForTab`
is today: the payload is used only while `payload.tabId === tabId`, so reopening
the stage for a different tab renders the loading state (a null `annotations`
prop) instead of a stale payload. `saveAnnotations` keeps the
`{ error: 'Tab not found' }` early return, character for character.

How each preserved rule maps:

| Rule | Where it lives after this task |
|---|---|
| RH-28 s2 - measured visual-viewport height, `100dvh` only as fallback | height in `usePdfStage`, fallback in `PdfStageOverlay`'s inline style |
| RH-28 s2 - pinch-zoom stability guard | `isStableViewportMeasurement` call in `usePdfStage`, module unchanged |
| RH-28 s2 - `resize` **and** `scroll` on `visualViewport`, `resize`/`orientationchange` on `window` | `usePdfStage` effect 2 |
| RH-28 s2 - `offsetTop` never read | greppable: `offsetTop` appears nowhere in the new files |
| RH-28 s2a - overlay root `touchAction: 'pan-x pan-y'` as the single choke point | `PdfStageOverlay` root inline style, asserted by a jsdom test |
| RH-28 s3 - scroll host resolved from the overlay ref by computed overflow, restored verbatim, `body` untouched | `src/lib/scrollHost.ts` + `usePdfStage` effect 3 |
| RH-28 s3 - overlay root `overflow: 'hidden'` + `overscrollBehavior: 'contain'` | `PdfStageOverlay` root inline style, asserted by a jsdom test |
| RH-28 s4/s5, RH-20 (toolbar height, drawing toggle, erase persistence, safe-area spacer) | entirely inside `TabDrawingStage.tsx`, which this task does not touch; its guard tests stay byte-identical |
| AGENTS.md "NO browser alerts" | no dialog is introduced; `noBrowserDialogs.test.ts` keeps scanning the whole `src/` tree, new files included |

Tests: `src/hooks/__tests__/usePdfStage.test.tsx`, first line exactly
`// @vitest-environment jsdom`, `afterEach(cleanup)` plus
`afterEach(() => vi.unstubAllGlobals())`, built with `renderHook` from
`@testing-library/react`. Stubbing, exactly:

- **actions**: a `makeActions()` factory returning
  `{ getAnnotations: vi.fn().mockResolvedValue({ data: { '1': [] } }), saveAnnotations: vi.fn().mockResolvedValue({ success: true }) }`.
  Nothing under `@/app/actions` is imported by the test.
- **visual viewport**: jsdom has no `window.visualViewport`, so the fake is
  injected through the `getViewport` option -
  `const vv = { height: 640, scale: 1, addEventListener: vi.fn(), removeEventListener: vi.fn() }`,
  passed as `getViewport: () => vv`. The listeners the hook registers are read
  back off `vv.addEventListener.mock.calls` and invoked inside `act` to simulate
  a chrome collapse. The "no visual viewport" case passes
  `getViewport: () => undefined` and stubs the fallback with
  `vi.stubGlobal('innerHeight', 900)`.
- **history**: jsdom's real `window.history` is used.
  `vi.spyOn(window.history, 'pushState')` counts the pushes; a back press is
  simulated with `act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })`;
  the "close from the toolbar" case spies on `window.history.back` and drives
  the two branches by leaving the pushed entry in place versus calling
  `window.history.replaceState({}, '')` first.
- **scroll host**: a `div` with `style.overflowY = 'auto'` appended to
  `document.body`, a child `div` assigned to `result.current.overlayRef.current`
  before `open()` is called.

Fifteen tests, names listed in ER3.

### 4. `src/components/fastview/PdfStageOverlay.tsx` (new)

`'use client'`, presentational only - no `useState`, no `useEffect`, no
`useRef`, no measurement, no persistence, no Server Action import:

```ts
export interface PdfStageOverlayProps {
  open: boolean
  overlayRef: RefObject<HTMLDivElement | null>
  /** Measured px height; null falls back to '100dvh'. */
  height: number | null
  tabId: string | null
  fileUrl: string | null
  tabTitle: string
  songTitle: string
  songKey?: string | null
  annotations: TabAnnotations | null
  annotationsError: string | null
  onSaveAnnotations: (pageNumber: number, strokes: Stroke[]) =>
    Promise<{ success?: boolean; error?: string }>
  onClose: () => void
}
```

It renders `null` unless `open && fileUrl && tabId`. That is equivalent to the
page's current four-way guard (`isPdfStageMode && activeTabUrl && activeTabId && activeTabRepertoireId`)
because `activeTabRepertoireId` is non-null exactly when `activeTabId` is - both
come from the same `ActiveTab` object inside `useTabLibrary` - and the overlay
renders nothing derived from the repertoire id. Everything else (className,
inline style, header markup, `key={tabId}` on `TabDrawingStage`) is moved
verbatim.

The component's prop names deliberately avoid the controller-object shape: the
overlay takes flat props, so no controller type has to be re-exported from
`src/lib` for it (unlike RH-49's `TabLibraryController`, which several components
share). `src/components` therefore still never imports `src/hooks`.

Tests: `src/components/fastview/__tests__/PdfStageOverlay.test.tsx`, first line
exactly `// @vitest-environment jsdom`, `afterEach(cleanup)`, and
`vi.mock('@/components/tabs/TabDrawingStage', ...)` replacing the stage with a
stub that renders a `data-testid="drawing-stage"` node echoing the props it got.
The real component is never mounted here: `react-pdf`/`pdfjs-dist` touch
`DOMMatrix` at module load, which is exactly why
`src/components/tabs/__tests__/TabDrawingStage.test.tsx` mocks them, and that
file must stay byte-identical. Seven tests, names in ER4.

### 5. `src/app/fastViewTabActions.ts` (modified) - composition root

The two annotation actions come from the same module (`@/app/actions/tabs`) as
the four already wired there, so they are added to that file rather than to a new
`fastViewStageActions.ts`; one Fast View tab composition root is easier to keep
consistent than two, and a five-line sibling file would only duplicate the
imports:

```ts
export const PDF_STAGE_ACTIONS: PdfStageActions = {
  getAnnotations: getTabAnnotationsAction,
  saveAnnotations: saveTabAnnotationsAction,
}
```

Module-level, for the same stable-identity reason as `TAB_LIBRARY_ACTIONS`.

### 6. `src/app/songs/[id]/fast-view/page.tsx` (modified)

After the move the page:

- drops the imports at lines 9, 10 and 14 and the function at 85-98;
- drops the three PDF state/ref declarations (154-156), the effects at 204-238
  and 240-256, `closePdfStageMode` (265-270) and the whole annotation block
  (272-301);
- narrows the popstate effect to the lyrics half and uses
  `stageHistoryState()` / `isStageHistoryEntry()` there and in `closeStageMode`;
- adds one hook call, right after the `useTabLibrary` call so `activeTabId` and
  `activeTabRepertoireId` are in scope:
  `const pdfStage = usePdfStage({ tabId: activeTabId, repertoireId: activeTabRepertoireId, actions: PDF_STAGE_ACTIONS })`;
- passes `onOpenStage={pdfStage.open}` to `<TabLibrarySection>`;
- renders `<PdfStageOverlay ... />` in place of lines 1014-1055, forwarding
  `open={pdfStage.isOpen}`, `overlayRef={pdfStage.overlayRef}`,
  `height={pdfStage.height}`, `tabId={activeTabId}`, `fileUrl={activeTabUrl}`,
  `tabTitle={activeTabTitle}`, `songTitle={title}`, `songKey={key}`,
  `annotations={pdfStage.annotations}`,
  `annotationsError={pdfStage.annotationsError}`,
  `onSaveAnnotations={pdfStage.saveAnnotations}` and `onClose={pdfStage.close}`.

Measured with a throwaway copy of the page at `6b30ddb` with exactly those
regions removed: 939 lines and `FastViewPage` complexity 54. The wiring above
adds roughly 25 lines and no new branch, so the bounds in ER6 (under 1000 lines,
complexity at most 58) carry real margin without being vacuous.

### 7. Conventions

Import direction (F21): none of `src/lib/scrollHost.ts`,
`src/lib/stageHistory.ts`, `src/hooks/usePdfStage.ts` or
`src/components/fastview/PdfStageOverlay.tsx` may import from `@/app/*`; the
actions arrive through `PDF_STAGE_ACTIONS`. Error handling: the annotation load
keeps its existing shape (the action already returns an `{ data, error }`
envelope, so there is no `catch` to add and none is added). No native browser
dialog anywhere. No landing-page copy change: this is an internal refactor with
no new selling point, so the Landing Page Rule is satisfied by leaving
`LandingPage.tsx` and both dictionaries untouched (ER12).

## Expected Results

ER1 - From the project root all eight of these files exist and are non-empty: `src/lib/scrollHost.ts`, `src/lib/__tests__/scrollHost.test.ts`, `src/lib/stageHistory.ts`, `src/lib/__tests__/stageHistory.test.ts`, `src/hooks/usePdfStage.ts`, `src/hooks/__tests__/usePdfStage.test.tsx`, `src/components/fastview/PdfStageOverlay.tsx`, `src/components/fastview/__tests__/PdfStageOverlay.test.tsx`. `grep -rn "@/app/" src/lib/scrollHost.ts src/lib/stageHistory.ts src/hooks/usePdfStage.ts src/components/fastview/PdfStageOverlay.tsx` prints nothing and exits with status 1. `grep -rln "from '@/hooks/usePdfStage'" src` lists exactly these three paths and no others, in any order: `src/hooks/__tests__/usePdfStage.test.tsx`, `src/app/fastViewTabActions.ts`, `src/app/songs/[id]/fast-view/page.tsx` (the check matches import specifiers only, so naming the identifier in a doc comment is never a match). `grep -rln "@/hooks/usePdfStage" src/components src/lib` prints nothing and exits with status 1. `grep -c "PDF_STAGE_ACTIONS" src/app/fastViewTabActions.ts` and `grep -c "PDF_STAGE_ACTIONS" "src/app/songs/[id]/fast-view/page.tsx"` each print a number greater than 0, and `grep -c "getTabAnnotationsAction\|saveTabAnnotationsAction" src/app/fastViewTabActions.ts` prints a number greater than 0.

ER2 - `npx vitest run src/lib/__tests__/scrollHost.test.ts src/lib/__tests__/stageHistory.test.ts --reporter=verbose` exits 0 and reports at least 12 passed and 0 failed tests, among which these exact names all appear and pass: `findScrollHost returns the nearest ancestor whose computed overflow-y is auto`, `findScrollHost accepts an ancestor whose computed overflow-y is scroll`, `findScrollHost skips ancestors that are not scrollable and returns the outer one`, `findScrollHost returns null when no ancestor scrolls`, `findScrollHost returns null for a null node`, `findScrollHost never returns the node itself`, `lockScrollHost hides the host overflow and restores the previous inline value verbatim`, `lockScrollHost restores an empty inline overflow rather than freezing the host`, `lockScrollHost is a no-op for a null host`, `stageHistoryState marks the entry Stage Mode pushed`, `isStageHistoryEntry recognises the entry Stage Mode pushed`, `isStageHistoryEntry rejects null, undefined and an unrelated entry`. The first line of `src/lib/__tests__/scrollHost.test.ts` is exactly `// @vitest-environment jsdom`, while `src/lib/__tests__/stageHistory.test.ts` does not contain the string `@vitest-environment` at all (it runs in the default node environment, which proves `src/lib/stageHistory.ts` touches no DOM). `grep -c "window\.\|document\." src/lib/stageHistory.ts` prints `0`.

ER3 - `npx vitest run src/hooks/__tests__/usePdfStage.test.tsx --reporter=verbose` exits 0 and reports at least 15 passed and 0 failed tests, among which these exact names all appear and pass: `starts closed and exposes no annotations`, `loads the annotations of the active tab when the stage opens`, `does not load annotations while the stage is closed`, `reports the load error returned by the action`, `keeps the annotations null until the newly selected tab has loaded its own`, `passes a save through to the action with the active tab and repertoire ids`, `refuses to save when no tab is active and never calls the action`, `measures the overlay height from the visual viewport when the stage opens`, `keeps the last stable height while the visual viewport is pinch-zoomed`, `falls back to the window inner height when there is no visual viewport`, `re-measures on visual viewport resize and scroll and drops every listener on close`, `locks the scroll host while the stage is open and restores it verbatim on close`, `pushes exactly one history entry when the stage opens`, `exits the stage when the browser back button fires popstate`, `closing from the toolbar goes back only when the Stage Mode history entry is on top`. The first line of that file is exactly `// @vitest-environment jsdom`, it contains `afterEach(cleanup)` and `vi.unstubAllGlobals()`, it calls `renderHook`, it simulates the back button with `new PopStateEvent('popstate')`, it injects the fake visual viewport through the hook's `getViewport` option (jsdom defines no `window.visualViewport`) and stubs the fallback with `vi.stubGlobal('innerHeight'`, and `grep -c "@/app/actions" src/hooks/__tests__/usePdfStage.test.tsx` prints `0` because both annotation actions are passed in as test doubles. In the hook itself, `grep -c "offsetTop" src/hooks/usePdfStage.ts` prints `0` (RH-28 never reads it) and `grep -rn "body.style.overflow" src` prints nothing and exits with status 1 (the scroll lock touches only the resolved host).

ER4 - `npx vitest run src/components/fastview --reporter=verbose` exits 0 and reports 0 failed tests across at least eight files, including the new `src/components/fastview/__tests__/PdfStageOverlay.test.tsx` with at least 7 tests whose names include exactly: `PdfStageOverlay renders nothing while the stage is closed`, `PdfStageOverlay renders nothing without an active tab url`, `PdfStageOverlay shows the tab title, the song title and the key in the header`, `PdfStageOverlay sizes itself to the measured height and falls back to 100dvh`, `PdfStageOverlay keeps the overlay root touch-action, overflow and overscroll rules`, `PdfStageOverlay reports the close button press`, `PdfStageOverlay hands the annotations, the error and the save callback to the drawing stage`. That file has `// @vitest-environment jsdom` as its literal first line, calls `afterEach(cleanup)` and mocks `@/components/tabs/TabDrawingStage`. The `PdfStageOverlay keeps the overlay root touch-action, overflow and overscroll rules` test asserts on the rendered root element that `style.touchAction` is `pan-x pan-y`, `style.overflow` is `hidden` and `style.overscrollBehavior` is `contain`, and that its `className` is exactly `fixed inset-x-0 top-0 z-50 bg-black flex flex-col`. The component carries no logic: `grep -c "visualViewport\|addEventListener\|useEffect\|useState\|useRef\|@/app/" src/components/fastview/PdfStageOverlay.tsx` prints `0`, and `grep -c "getTabAnnotations\|saveTabAnnotations" src/components/fastview/PdfStageOverlay.tsx` prints `0`.

ER5 - The page no longer holds any PDF Stage Mode logic: `grep -c "getTabAnnotationsAction\|saveTabAnnotationsAction\|findScrollHost\|visualViewport" "src/app/songs/[id]/fast-view/page.tsx"` prints `0` (it prints `6` at `6b30ddb`), `grep -c "isPdfStageMode\|pdfStageHeight\|pdfStageOverlayRef\|stageAnnotations" "src/app/songs/[id]/fast-view/page.tsx"` prints `0` (the first three alone print `15` at `6b30ddb`), and `grep -c "TabDrawingStage" "src/app/songs/[id]/fast-view/page.tsx"` prints `0` while `grep -c "TabDrawingStage" src/components/fastview/PdfStageOverlay.tsx` prints a number greater than 0. The popstate boundary is exactly where this spec puts it: `grep -c "popstate" "src/app/songs/[id]/fast-view/page.tsx"` prints `2` (one `addEventListener`, one `removeEventListener`, unchanged from `6b30ddb`), `grep -c "popstate" src/hooks/usePdfStage.ts` prints `2`, the page's remaining popstate effect is the lyrics half only so `grep -c "setIsStageMode" "src/app/songs/[id]/fast-view/page.tsx"` prints a number greater than 0, and the marker lives in one place: `grep -rln "stageMode: true" src` prints only paths drawn from the closed set `src/lib/stageHistory.ts` and `src/lib/__tests__/stageHistory.test.ts`, and in particular lists neither `src/app/songs/[id]/fast-view/page.tsx` (which it does list at `6b30ddb`) nor `src/hooks/usePdfStage.ts`, while `grep -c "stageHistoryState\|isStageHistoryEntry" "src/app/songs/[id]/fast-view/page.tsx"` and `grep -c "stageHistoryState\|isStageHistoryEntry" src/hooks/usePdfStage.ts` each print a number greater than 0.

ER6 - `npx eslint src/lib/scrollHost.ts src/lib/stageHistory.ts src/hooks/usePdfStage.ts src/components/fastview/PdfStageOverlay.tsx src/app/fastViewTabActions.ts --rule '{"complexity":["error",15],"max-lines-per-function":["error",200]}'` exits 0 and prints no output at all. `wc -l` on each of the eight files listed in ER1 prints a number strictly less than 400. `wc -l "src/app/songs/[id]/fast-view/page.tsx"` prints a number strictly less than 1000 (it prints `1091` at `6b30ddb`). The output of `npx eslint "src/app/songs/[id]/fast-view/page.tsx" --rule '{"complexity":["error",15]}'` contains exactly one line matching `Function 'FastViewPage' has a complexity of N`, and N is at most 58 (it is 67 at `6b30ddb`). That command's other output lines are not constrained here: `--rule` adds to the flat config rather than replacing it, so the command also reports the page's ordinary problems, which ER7 pins separately.

ER7 - `npx eslint .` prints the summary line `26 problems (12 errors, 14 warnings)` and nothing worse, and `npx eslint "src/app/songs/[id]/fast-view/page.tsx"` prints the summary line `2 problems (2 errors, 0 warnings)`, the two remaining problems being one `prefer-const` error on the `let html` declaration inside `parseLyricsMarkdown` and one `@typescript-eslint/no-explicit-any` error inside the status dropdown, both with possibly shifted line numbers. `./node_modules/.bin/tsc --noEmit` exits 0 and prints nothing. `npm run lint:dead` exits 0 and reports no unused files, exports, types or dependencies. `npm run lint:dup` exits 0 and prints `Found N clones.` with N at most 19 and a total duplicated-lines percentage at most 0.85% (18 clones, 230 lines, 0.78% at `6b30ddb`). `npm run audit` exits 0 and reports 0 vulnerabilities.

ER8 - `git diff 6b30ddb -- src/lib/__tests__/erasePersistence.test.ts src/lib/__tests__/stageInteraction.test.ts src/lib/__tests__/annotationMath.test.ts src/lib/__tests__/pdfWorkerAsset.test.ts src/lib/__tests__/noBrowserDialogs.test.ts src/components/tabs/__tests__/TabDrawingStage.test.tsx src/components/tabs/TabDrawingStage.tsx src/lib/stageInteraction.ts src/lib/annotationMath.ts` prints nothing, and `npx vitest run src/lib/__tests__/erasePersistence.test.ts src/lib/__tests__/stageInteraction.test.ts src/lib/__tests__/annotationMath.test.ts src/lib/__tests__/pdfWorkerAsset.test.ts src/lib/__tests__/noBrowserDialogs.test.ts src/lib/__tests__/errorHandlingStyle.test.ts src/components/tabs/__tests__/TabDrawingStage.test.tsx` exits 0 with 0 failed tests.

ER9 - With a live Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with all migrations applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` exported into the environment (for example `set -a; . ./.env.local; set +a`), `npx vitest run` exits 0 and its summary reports at least 74 test files passed, 0 test files failed, at least 883 tests passed, 0 tests failed and 0 tests skipped (the same command at `6b30ddb` reports 70 files and 849 tests, 0 skipped; this task adds 4 files and at least 34 tests).

ER10 - Under the same Postgres and `SUPABASE_SERVICE_ROLE_KEY` precondition as ER9, `npm run test:coverage` exits 0 with no threshold error (the configured gates are statements 80, branches 65, functions 78, lines 80) and its `All files` row shows statements at least 93, branches at least 76, functions at least 95 and lines at least 93. Because the text table can omit a file that is fully covered, the per-file floors are read from the JSON summary instead: `npx vitest run --coverage --coverage.reporter=json-summary` exits 0 and, in the resulting `coverage/coverage-summary.json`, the entry whose key ends with `src/lib/scrollHost.ts` reports `statements.pct` 100, `functions.pct` 100, `lines.pct` 100 and `branches.pct` at least 85; the entry whose key ends with `src/lib/stageHistory.ts` reports `statements.pct` 100, `functions.pct` 100, `lines.pct` 100 and `branches.pct` at least 90; and the entry whose key ends with `src/hooks/usePdfStage.ts` reports `statements.pct` at least 90, `functions.pct` at least 90, `lines.pct` at least 90 and `branches.pct` at least 70.

ER11 - `npx next build` exits 0 and its route table lists `/songs/[id]/fast-view` marked `f` (Dynamic, server-rendered on demand). Immediately afterwards, `set -a; . ./.env.local; set +a; PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test e2e/ssr-smoke.spec.ts --project=chromium` prints `4 passed` and exits 0. `e2e/fast-view-mobile.spec.ts` and `e2e/songs-crud.spec.ts` are not gates here: both are red at `6b30ddb` for the RH-44 `addSong` helper reason (`e2e/helpers.ts`), so their result is recorded but never blocks this task.

ER12 - The `version` field in `package.json` matches `0.1.78-` followed by exactly twelve digits (it is `0.1.77-202609071901` at `6b30ddb`, and the version may only ever go up). `git diff 6b30ddb -- src/components/landing/LandingPage.tsx src/i18n/dictionaries/en.json src/i18n/dictionaries/pt-BR.json` prints nothing, and `npx vitest run src/lib/__tests__/landingCopy.test.ts` exits 0 with 0 failed tests. `git diff --name-only 6b30ddb` lists only paths drawn from this closed set and nothing else: `AGENTS.md`, `package.json`, `.meridian/tasks.json`, `docs/tasks/RH-50-spec.md`, `docs/suggestions-log.md`, `src/app/songs/[id]/fast-view/page.tsx`, `src/app/fastViewTabActions.ts`, `src/lib/scrollHost.ts`, `src/lib/__tests__/scrollHost.test.ts`, `src/lib/stageHistory.ts`, `src/lib/__tests__/stageHistory.test.ts`, `src/hooks/usePdfStage.ts`, `src/hooks/__tests__/usePdfStage.test.tsx`, `src/components/fastview/PdfStageOverlay.tsx`, `src/components/fastview/__tests__/PdfStageOverlay.test.tsx`. In particular that list contains no path under `migrations/`, no `eslint.config.mjs`, no `vitest.config.ts`, no `src/lib/tabs.ts`, no `src/lib/songs.ts`, no path under `src/components/tabs/` and no path under `src/app/actions/`.

## Out of Scope

- The lyrics Stage Mode overlay, `isStageMode`, `lyricsFontSize`,
  `isStageDarkMode`, `closeStageMode` and the lyrics half of the popstate
  intercept: they stay on the page for RH-51 (part 4), which will reuse
  `src/lib/stageHistory.ts` as-is.
- The page shell, entry loading, status dropdown, links, lyrics editing and
  playlist wiring: RH-52 (part 5).
- Any change to `TabDrawingStage.tsx`, `stageInteraction.ts`,
  `annotationMath.ts`, `src/app/actions/tabs.ts`, `src/lib/tabs.ts` or
  `src/lib/tabLibrary.ts` / `useTabLibrary.ts`.
- Fixing the two pre-existing ESLint errors in the page, the RH-44 red e2e
  specs, and any landing-page copy.
- Any migration, ESLint or Vitest configuration change.

## Post-merge checks (orchestrator)

Manual smoke on a tablet-sized viewport, matching the task's own last draft
result: open a song with a PDF tab in Fast View, open PDF Stage Mode, confirm the
toolbar is fully visible with the browser chrome expanded, draw an annotation,
leave with the hardware/browser back button, reopen the same tab and confirm the
annotation is still there and the page behind is scrollable again.
