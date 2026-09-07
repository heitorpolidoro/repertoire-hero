# RH-46 - Inverter TabDrawingStage e AppLayout para receber dados por props

Parent: RH-37, part 2 of 3 (RH-25 T4, finding F21 as written). Depends on RH-45
(`a493731`, done). Part 3 is RH-47.

## Scope

Two presentational components under `src/components` currently reach up into the App
Router tree to fetch their own data. This task inverts both so the data arrives as
props, and adds a jsdom suite for each proving it renders from props alone and invokes
the callbacks it was given.

In scope:

- `src/components/tabs/TabDrawingStage.tsx` stops importing
  `getTabAnnotationsAction` / `saveTabAnnotationsAction` from `@/app/actions/tabs` and
  takes `annotations`, `annotationsError` and `onSaveAnnotations` as props.
- `src/app/songs/[id]/fast-view/page.tsx` becomes the owner of the annotation fetch and
  of the save call it passes down.
- `src/components/layout/AppLayout.tsx` (and the `ContextSwitcher` declared inside it)
  stops importing `getBandsAction` from `@/app/actions/bands` and takes `bands` as a
  prop.
- A new client component in the App Router tree, `src/app/AppShell.tsx`, owns the band
  fetch and the band-context reconciliation, and threads `bands` through
  `src/components/layout/ConditionalLayout.tsx` into `AppLayout` / `ContextSwitcher`.
- One shared prop type, `BandOption`, added to `src/types/database.ts`.
- Two new jsdom suites: `src/components/tabs/__tests__/TabDrawingStage.test.tsx` and
  `src/components/layout/__tests__/AppLayout.test.tsx`.

Behaviour is otherwise unchanged. In particular every Stage Mode UX rule from RH-28 and
RH-20 stays exactly as it is: drawing off on open and never persisted, the debounced
autosave with its 800 ms coalescing window, the immediate save inside `eraseAt`, the
flush on page change, the flush on drawing-off, the flush on unmount, zoom reset on page
navigation, the toolbar layout and the Toast-based clear confirmation.

## Audit at a493731

`git log --oneline -1` prints `a493731 refactor(RH-45): move Server Action SQL into
src/lib, dev route on shared pool`. `git status --porcelain` prints nothing.
`package.json` version is `0.1.72-202609070958`.

### The two inward imports

`grep -rn "@/app/" src/components src/lib src/hooks | grep -v __tests__` prints five
lines today:

```
src/components/tabs/TabDrawingStage.tsx:6:import { getTabAnnotationsAction, saveTabAnnotationsAction } from '@/app/actions/tabs'
src/components/songs/SongForm.tsx:16:} from "@/app/actions/repertoire";
src/components/songs/CorrectionModal.tsx:5:import { submitGlobalSongEditAction } from "@/app/actions/moderation";
src/components/layout/AppLayout.tsx:8:import { getBandsAction } from '@/app/actions/bands';
src/hooks/useBandAdmin.ts:11:} from "@/app/actions/bands";
```

Lines 1 and 4 are this task. Lines 2, 3 and 5 are RH-47 and must be left untouched.

### TabDrawingStage

- **What it fetches:** `getTabAnnotationsAction(tabId, repertoireId)` at
  `src/components/tabs/TabDrawingStage.tsx:122`, inside a `useEffect` whose deps are
  `[tabId, repertoireId]` (L120-L138). The result populates `annotationsRef.current`,
  flips `annotationsLoadedRef` / `annotationsLoaded`, and moves `saveState` from
  `'loading'` to `'saved'`. On `res.error` it calls `showLocalToast(res.error)`.
- **What it writes:** `saveTabAnnotationsAction(tabId, repertoireId, page, strokes)` at
  two sites: `performSave` (L241, the debounced/coalesced path used by drawing, erasing,
  undo and clear) and the unmount-flush effect cleanup (L187, `void` call, deps
  `[tabId, repertoireId]`).
- **Where the loaded data is used:** the effect at L142-L145 copies
  `annotationsRef.current[String(pageNumber)]` into the `strokes` state whenever the page
  changes or loading completes; `annotationsLoaded` is the gate.
- **Types:** `Stroke` and `TabAnnotations` are already imported from `@/types/database`
  (L7), not from the action module, so no type import has to move. `src/app/actions/tabs.ts`
  keeps `export type { Stroke, TabAnnotations }` and both action signatures unchanged
  after RH-45 (`src/app/actions/tabs.ts:17`, `:98`, `:113`); `src/lib/tabs.ts` exports the
  functions those actions delegate to and re-exports no types.
- **Consumers:** exactly one. `src/app/songs/[id]/fast-view/page.tsx:10` imports it and
  renders it at L1511-L1516 with `key={activeTabId} tabId repertoireId fileUrl`, inside
  the `isPdfStageMode && activeTabUrl && activeTabId && activeTabRepertoireId` branch.
  The only other mentions in the tree are a prose comment in `src/lib/pdfWorker.ts:18`
  and the source-scanning guard `src/lib/__tests__/erasePersistence.test.ts` (verified by
  `grep -rn "TabDrawingStage" src e2e`); neither imports the component.
- **`tabId` / `repertoireId` are used for nothing else.** Once both action calls move
  out, the two props are dead and are removed.

### AppLayout / ContextSwitcher

- **What it fetches:** `getBandsAction()` at `src/components/layout/AppLayout.tsx:57`,
  inside `ContextSwitcherComponent`'s mount effect (L56-L71, deps `[]`). The result is
  cast `as unknown as Band[]` into local state, and the same callback reconciles the
  persisted band context with the DB row: when `useBandContextStore.getState().context`
  is a band that is present in the fetched list and its `color` or `name` differs, it
  calls `setBandContext(activeBand.id, activeBand.name, dbColor)` with
  `dbColor = activeBand.color ?? DEFAULT_BAND_COLOR`.
- **The cast is a lie worth removing:** `getBandsAction(): Promise<Band[]>`
  (`src/app/actions/bands.ts:19`) returns the `Band` rows of `src/types/database.ts:81`,
  which have no `role` field, while the local `interface Band` at
  `src/components/layout/AppLayout.tsx:13-18` declares `role: 'admin' | 'member'`. `role`
  is never read. Only `id`, `name` and `color` are used (L62-L66, L135-L148).
- **Where it renders:** `ContextSwitcher` is
  `dynamic(() => Promise.resolve(ContextSwitcherComponent), { ssr: false })` (L158-L160),
  rendered at L235 as `<ContextSwitcher isBandMode={isBandMode} />`, inside the desktop
  sidebar only.
- **Consumers:** `src/components/layout/ConditionalLayout.tsx:27` renders
  `<AppLayout>{children}</AppLayout>` for every route that is not `/login`, `/signup`,
  `/forgot-password`, `/reset-password` or `/join/`; `src/app/layout.tsx:39` renders
  `<ConditionalLayout>`. `grep -rn "ContextSwitcher" src` shows it is declared, typed and
  rendered only inside `AppLayout.tsx` - it is not exported and has no other consumer.

### Gate baselines measured at a493731

- `./node_modules/.bin/tsc --noEmit` exits 0 and prints nothing. (`npx tsc` is
  intercepted by a shell hook in this environment; use the direct binary path.)
- `npx eslint .` reports `29 problems (12 errors, 17 warnings)`. Per file among the ones
  this task touches: `src/components/layout/AppLayout.tsx` 2 errors, 0 warnings, both
  `react-hooks/set-state-in-effect` at `54:21` and `171:21` (the two
  `useEffect(() => { setMounted(true); }, [])` calls, which this task does not touch);
  `src/app/songs/[id]/fast-view/page.tsx` 2 errors, 3 warnings
  (`@typescript-eslint/no-unused-vars` at 15 and twice at 150, `prefer-const` at 18,
  `@typescript-eslint/no-explicit-any` at 839); `src/components/tabs/TabDrawingStage.tsx`,
  `src/components/layout/ConditionalLayout.tsx` and `src/app/layout.tsx` are clean.
- `npm run lint:dead` clean; `npm run lint:dup` 19 clones / 239 duplicated lines
  (0.91 %); `npm run audit` 0 vulnerabilities.
- `npx vitest run` 55 files / 717 tests / 0 skipped, with Postgres at
  `postgresql://postgres:postgres@127.0.0.1:54322/postgres` and a non-empty
  `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
- `npx next build` ok; `npx playwright test e2e/ssr-smoke.spec.ts` 4 passed.
- `vitest.config.ts` `coverage.include` is `src/lib/**/*.ts`, `src/app/actions/*.ts`,
  `src/hooks/**/*.ts`, `src/proxy.ts`. **No file this task touches is in the coverage
  universe** (`src/components/**`, `src/app/**/page.tsx`, `src/app/AppShell.tsx` and
  `src/types/**` are all outside it), so the denominator does not move and the
  statements 80 / branches 65 / functions 78 / lines 80 thresholds are unaffected.

### Constraints discovered while auditing (do not learn these the hard way)

1. **`react-hooks/set-state-in-effect` is an error in this config.** A setState called
   synchronously in an effect body is flagged *even behind an early return* - I verified
   this with a throwaway probe file. A setState inside a `.then()` callback is not
   flagged, and a ref assignment in an effect is not flagged. Every new effect this task
   introduces must therefore set state only from a promise callback, or set no state at
   all. The eslint total must land back on exactly 29 problems (12 errors, 17 warnings).
2. **`src/lib/__tests__/erasePersistence.test.ts` reads `TabDrawingStage.tsx` as text.**
   It requires that `commitStroke`, `eraseAt`, `handleUndo` and `handleClearConfirm` all
   still exist as component-inner declarations written exactly as `  function name(` and
   closed by a line that is exactly `  }`, that each assigns
   `annotationsRef.current[...] = ...`, that each such function also contains the literal
   `scheduleSave()`, that `eraseAt` reads
   `= annotationsRef.current[String(pageNumber)]`, and that the identifier
   `erasedDuringGesture` never comes back. Do not rename or re-indent those four
   functions, and do not add a new `  function` that writes `annotationsRef.current[...]`
   without calling `scheduleSave()`.
3. **jsdom cannot import `react-pdf`.** `pdfjs-dist` touches `DOMMatrix` at module load
   and throws `ReferenceError: DOMMatrix is not defined`. The stage suite must
   `vi.mock('react-pdf', ...)` and `vi.mock('@/lib/pdfWorker', () => ({}))`.
4. **jsdom has no `ResizeObserver`.** The stage suite must `vi.stubGlobal` a stub class
   with `observe()` and `disconnect()`. With a stub that never fires, `baseFitWidth`
   stays 0, `renderWidth` stays `undefined` and the `<Document>` subtree never renders -
   which is what makes the suite fast and deterministic. The toolbar renders regardless.
5. **`AppLayout` transitively imports `@/app/actions/repertoire`** through
   `@/store/repertoireStore`. The AppLayout suite mocks `@/store/repertoireStore`, which
   removes that module from the graph entirely (and lets the suite assert `loadSongs` was
   called). Mocking `@/store/repertoireStore`, `@/lib/auth-client` and `next/navigation`
   is expected; mocking any `@/app/actions/*` module in either new suite is not.
6. I verified with throwaway probe suites (since deleted) that `AppLayout` renders under
   jsdom with `next/dynamic` and the zustand stores intact, and that a
   render -> toggle drawing -> Undo -> debounced save round trip on `TabDrawingStage`
   works under jsdom. Both refactors below were also compiled through
   `./node_modules/.bin/tsc --noEmit` and `npx eslint` as probe files before this spec was
   written; the shapes given here are the ones that pass.

## Approach

### 1. `src/types/database.ts` - one shared prop type

Add, next to the existing `Band` interface:

```ts
/** The minimal band shape the app chrome's context switcher renders (RH-46). */
export interface BandOption {
  id: string;
  name: string;
  color?: string | null;
}
```

`Band` is structurally assignable to `BandOption`, so `getBandsAction()`'s `Band[]` flows
into the new prop with no cast. Delete the local `interface Band` in `AppLayout.tsx` and
the `as unknown as Band[]` cast with it.

### 2. `src/app/AppShell.tsx` (new) - owns the band fetch

A `'use client'` component that sits between the root layout and `ConditionalLayout`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { getBandsAction } from '@/app/actions/bands'
import ConditionalLayout from '@/components/layout/ConditionalLayout'
import { useBandContextStore } from '@/store/bandContextStore'
import { DEFAULT_BAND_COLOR } from '@/lib/bandColors'
import type { BandOption } from '@/types/database'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session } = authClient.useSession()
  const userId = session?.user?.id ?? null
  const [bands, setBands] = useState<BandOption[]>([])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    getBandsAction().then((fetched) => {
      if (cancelled) return
      setBands(fetched)
      // Moved verbatim from ContextSwitcher: keep the persisted band context's
      // name/colour in step with the row the database actually holds.
      const currentCtx = useBandContextStore.getState().context
      if (currentCtx.type === 'band') {
        const activeBand = fetched.find((x) => x.id === currentCtx.id)
        if (activeBand) {
          const dbColor = activeBand.color ?? DEFAULT_BAND_COLOR
          if (currentCtx.color !== dbColor || currentCtx.name !== activeBand.name) {
            useBandContextStore.getState().setBandContext(activeBand.id, activeBand.name, dbColor)
          }
        }
      }
    })
    return () => { cancelled = true }
  }, [userId])

  return <ConditionalLayout bands={bands}>{children}</ConditionalLayout>
}
```

Notes for the implementer: `setBands` is called from the promise callback, never from the
effect body, so constraint 1 above is satisfied. `authClient.useSession()` shares one
nanostore atom with the call `AppLayout` already makes, so this adds no second session
request. Gating on `userId` means the fetch no longer fires on `/login` and friends or
for a signed-out visitor; today it fires from `ContextSwitcher`'s mount effect regardless
of session, which is the one deliberate behaviour delta in this task and it strictly
removes a doomed request. `src/app/AppShell.tsx` is not a reserved App Router filename,
so it creates no route.

`src/app/layout.tsx` swaps `ConditionalLayout` for `AppShell` (import path
`@/app/AppShell`, or `./AppShell`), keeping the `<Analytics />` sibling and the
`force-dynamic` export exactly as they are.

### 3. `src/components/layout/ConditionalLayout.tsx` - pure pass-through

```ts
interface ConditionalLayoutProps {
  children: React.ReactNode;
  bands: BandOption[];
}
```

The auth-route early return is unchanged; the other branch becomes
`<AppLayout bands={bands}>{children}</AppLayout>`.

### 4. `src/components/layout/AppLayout.tsx` - pure

- Delete the `@/app/actions/bands` import, the local `interface Band`, the
  `const [bands, setBands] = useState<Band[]>([])` state and the whole `getBandsAction`
  effect (L56-L71).
- `interface AppLayoutProps { children: React.ReactNode; bands: BandOption[] }` and
  `interface ContextSwitcherProps { isBandMode: boolean; bands: BandOption[] }`.
- `AppLayout` renders `<ContextSwitcher isBandMode={isBandMode} bands={bands} />`.
- Everything else - the `mounted` guards, `dynamic(..., { ssr: false })`, the outside
  click handler, `switchContext`, the band-mode theming, the mobile nav - is untouched.
  Both `setMounted` effects stay exactly where they are, so this file keeps its two
  baseline `react-hooks/set-state-in-effect` errors and the repo total does not move.

### 5. `src/components/tabs/TabDrawingStage.tsx` - pure

New prop contract (the `tabId` and `repertoireId` props are removed):

```ts
interface TabDrawingStageProps {
  fileUrl: string
  /** `null` while the parent is still loading them; `{}` for a tab with none. */
  annotations: TabAnnotations | null
  /** Load-failure message from the parent, rendered in the stage's own error panel. */
  annotationsError?: string | null
  onSaveAnnotations: (
    pageNumber: number,
    strokes: Stroke[],
  ) => Promise<{ success?: boolean; error?: string }>
}
```

The mechanical changes, all verified to compile and lint clean:

- Drop the `@/app/actions/tabs` import. `Stroke` / `TabAnnotations` keep coming from
  `@/types/database`.
- `const annotationsRef = useRef<TabAnnotations>(annotations ?? {})`.
- Replace the `annotationsLoadedRef` ref and the `annotationsLoaded` state with a derived
  `const annotationsLoaded = annotations !== null`.
- Add `const onSaveRef = useRef(onSaveAnnotations)` plus
  `useEffect(() => { onSaveRef.current = onSaveAnnotations }, [onSaveAnnotations])`. Every
  save site calls `onSaveRef.current(...)`, and `onSaveAnnotations` never appears in a
  dependency array, so a parent that re-creates the callback cannot restart an effect.
- Replace the load effect (L120-L138) with a ref-seeding effect declared **before** the
  page-sync effect, so that on the commit where `annotations` arrives the ref is filled
  before `setStrokes` reads it:
  `useEffect(() => { if (annotations !== null) annotationsRef.current = annotations }, [annotations])`.
  This assigns `annotationsRef.current` whole (not `annotationsRef.current[page]`), so it
  is outside `erasePersistence.test.ts`'s write pattern, and it sets no state, so it is
  outside `react-hooks/set-state-in-effect`.
- The page-sync effect at L142-L145 is unchanged; it now reads the derived
  `annotationsLoaded`.
- `useState<SaveState>('saved')` as the initial save state, and the label becomes
  `const saveLabel = !annotationsLoaded ? 'Loading...' : <the existing ternary>` (keep the
  existing single-character ellipsis the file already uses). The badge therefore still
  reads "Loading" until annotations arrive and "Saved" afterwards, exactly as today.
- `performSave` calls `onSaveRef.current(page, strokesToSave)`; the unmount-flush effect
  calls `void onSaveRef.current(pageNumberRef.current, strokesRef.current)` and its
  dependency array becomes `[]`.
- The error panel at the bottom renders for either source:
  `{(localToast || annotationsError) && ...}` with body
  `{localToast?.message ?? annotationsError}`. A load error therefore stays visible
  instead of self-dismissing after 4 s (save errors keep their 4 s `localToast`
  behaviour); that is the second and last deliberate behaviour delta, and it is the
  cheapest shape that keeps the message inside the z-50 stage overlay rather than behind
  it in the page's own Toast.
- Nothing else changes: `commitStroke`, `eraseAt`, `handleUndo`, `handleClearConfirm`,
  `scheduleSave`, `flushSave`, `goToPage`, `handleToggleDrawing`, all pointer handlers,
  the toolbar markup and the clear-confirmation panel keep their exact current bodies and
  indentation.

### 6. `src/app/songs/[id]/fast-view/page.tsx` - owns the annotation data

Add `useCallback` to the `react` import, `getTabAnnotationsAction` and
`saveTabAnnotationsAction` to the existing `@/app/actions/tabs` import, and `Stroke` /
`TabAnnotations` to the existing `@/types/database` type import. Then, next to the other
stage-mode state:

```tsx
const [stageAnnotations, setStageAnnotations] = useState<
  { tabId: string; data: TabAnnotations; error: string | null } | null
>(null)

useEffect(() => {
  if (!isPdfStageMode || !activeTabId || !activeTabRepertoireId) return
  let cancelled = false
  getTabAnnotationsAction(activeTabId, activeTabRepertoireId).then((res) => {
    if (cancelled) return
    setStageAnnotations({ tabId: activeTabId, data: res.data ?? {}, error: res.error ?? null })
  })
  return () => { cancelled = true }
}, [isPdfStageMode, activeTabId, activeTabRepertoireId])

const stageAnnotationsForTab =
  stageAnnotations && stageAnnotations.tabId === activeTabId ? stageAnnotations : null

const handleSaveStageAnnotations = useCallback(
  async (pageNumber: number, strokes: Stroke[]): Promise<{ success?: boolean; error?: string }> => {
    if (!activeTabId || !activeTabRepertoireId) return { error: 'Tab not found' }
    return saveTabAnnotationsAction(activeTabId, activeTabRepertoireId, pageNumber, strokes)
  },
  [activeTabId, activeTabRepertoireId],
)
```

Keying the loaded payload by `tabId` is what makes a stale payload impossible without any
setState in an effect body: reopening the stage for another tab (or the same tab after a
close) renders `annotations={null}` - the loading state - until the fetch for *that* tab
resolves. `res.data ?? {}` reproduces today's behaviour on a load error exactly: the
component leaves the loading state, shows no strokes, and surfaces the message.

The call site at L1511 becomes:

```tsx
<TabDrawingStage
  key={activeTabId}
  fileUrl={activeTabUrl}
  annotations={stageAnnotationsForTab?.data ?? null}
  annotationsError={stageAnnotationsForTab?.error ?? null}
  onSaveAnnotations={handleSaveStageAnnotations}
/>
```

The enclosing `isPdfStageMode && activeTabUrl && activeTabId && activeTabRepertoireId &&`
guard, `closePdfStageMode`, the overlay sizing effects and the header are unchanged.

### 7. Test plan

Both suites follow the house pattern: `// @vitest-environment jsdom` as the literal first
line, `import { cleanup } from '@testing-library/react'` with an explicit
`afterEach(cleanup)` (because `globals: false`), and plain-property assertions
(`toBeDefined()`, `.textContent`) since there is no jest-dom.

**`src/components/tabs/__tests__/TabDrawingStage.test.tsx`** - mocks `react-pdf` and
`@/lib/pdfWorker`, stubs `ResizeObserver`, mocks no `@/app/actions` module. Fixtures: two
`Stroke` objects `A` and `B` on page `'1'`. `onSaveAnnotations` is a `vi.fn()` resolving
`{ success: true }`. Describe block `TabDrawingStage renders from props (RH-46)`:

1. `renders the page toolbar from props alone, with no annotation fetch` - render with
   `annotations={{}}`; the page indicator (text matching `/^Page 1 /`) and the toggle
   button `Toggle drawing` are present, and the save badge text matches `/^Saved$/`.
2. `shows the loading badge while the annotations prop is null` - render with
   `annotations={null}`; the save badge text matches `/^Loading/`.
3. `calls onSaveAnnotations with the remaining strokes when Undo is pressed` - render
   with `annotations={{ '1': [A, B] }}`, click `Toggle drawing`, click the button whose
   text matches `/Undo$/`, and `await waitFor` until `onSaveAnnotations` was called once
   with `(1, [A])`.
4. `calls onSaveAnnotations with an empty page when Clear page is confirmed` - same
   setup, click `Toggle drawing`, `Clear page`, then `Clear`; `onSaveAnnotations` is
   called with `(1, [])`.
5. `renders the annotationsError prop inside the stage` - render with
   `annotationsError="Tab not found"`; that text is in the document.
6. `flushes a pending save through onSaveAnnotations when it unmounts` - click
   `Toggle drawing` then Undo, call `unmount()` before the 800 ms debounce elapses, and
   assert `onSaveAnnotations` was called with `(1, [A])`.

**`src/components/layout/__tests__/AppLayout.test.tsx`** - mocks `@/lib/auth-client`
(`useSession` + `signOut`), `next/navigation` (`usePathname`, `useRouter`) and
`@/store/repertoireStore` (via `vi.hoisted` so the `loadSongs` spy can be referenced from
the factory), and mocks no `@/app/actions` module. `beforeEach` resets the persisted band
context with `useBandContextStore.getState().setUserContext()`. `ContextSwitcher` is
`ssr: false` dynamic, so reach it with `await screen.findByText(...)`. Describe block
`AppLayout renders from props (RH-46)`:

1. `renders its children and both navigation landmarks from props alone` - render with
   `bands={[]}`; the child text is present and `screen.getAllByRole('navigation')` has
   length 2.
2. `lists every band in the bands prop inside the context switcher` - render with two
   `BandOption`s, open the switcher, and assert both names are in the document.
3. `switches the band context to the band the user picks` - click the second band; the
   store's `context` becomes `{ type: 'band', id, name, color }` for that band and the
   mocked `loadSongs` was called.
4. `renders only its children once the session resolves to no user` - `useSession`
   returns `{ data: null }`; after mount the child text is present and
   `screen.queryAllByRole('navigation')` is empty.

Ten new tests in two new files, taking the suite from 55 files / 717 tests to 57 / 727.

## Expected Results

ER1 - The static gates are all green at the merge commit, from the repository root.
`./node_modules/.bin/tsc --noEmit` exits 0 and prints nothing (use that exact binary path;
`npx tsc` is intercepted by a shell hook in this environment). `npx eslint .` reports
exactly 29 problems, 12 errors and 17 warnings, which is the unchanged baseline of commit
`a493731`. Within that total: `npx eslint src/components/layout/AppLayout.tsx` reports
exactly 2 errors and 0 warnings, both `react-hooks/set-state-in-effect`, on the two
`useEffect(() => { setMounted(true); }, [])` lines; `npx eslint "src/app/songs/[id]/fast-view/page.tsx"`
reports exactly 2 errors and 3 warnings; and
`npx eslint src/components/tabs/TabDrawingStage.tsx src/components/layout/ConditionalLayout.tsx src/app/AppShell.tsx src/app/layout.tsx src/types/database.ts`
reports 0 problems. `npm run lint:dead` exits 0 and reports no unused files, exports or
dependencies. `npm run lint:dup` exits 0 and prints a total duplication percentage below
2 %. `npm run audit` exits 0 and prints `found 0 vulnerabilities`.

ER2 - The two components no longer import from the App Router tree, and no third file
took the import over.
`grep -n "@/app/" src/components/tabs/TabDrawingStage.tsx src/components/layout/AppLayout.tsx`
prints nothing and exits 1. `grep -rn "@/app/" src/components src/lib src/hooks | grep -v __tests__`
prints exactly these three lines and nothing else (order is not significant):
`src/components/songs/SongForm.tsx:16:} from "@/app/actions/repertoire";`,
`src/components/songs/CorrectionModal.tsx:5:import { submitGlobalSongEditAction } from "@/app/actions/moderation";`,
`src/hooks/useBandAdmin.ts:11:} from "@/app/actions/bands";`. Additionally
`grep -n "as unknown as" src/components/layout/AppLayout.tsx` prints nothing and exits 1.

ER3 - `src/app/songs/[id]/fast-view/page.tsx` owns the annotation data and passes it
down. `grep -n "annotations={" "src/app/songs/[id]/fast-view/page.tsx"` and
`grep -n "onSaveAnnotations={" "src/app/songs/[id]/fast-view/page.tsx"` each print at
least one line, and both lines sit inside the single `<TabDrawingStage` element in that
file. `grep -n "getTabAnnotationsAction\|saveTabAnnotationsAction" "src/app/songs/[id]/fast-view/page.tsx"`
prints at least three lines (the import plus one call site each), while the same grep
against `src/components/tabs/TabDrawingStage.tsx` prints nothing and exits 1.
`grep -n "tabId=\|repertoireId=" "src/app/songs/[id]/fast-view/page.tsx"` prints nothing
and exits 1, because those two props no longer exist on the component.

ER4 - The band list is fetched above the component boundary and threaded down as a prop,
and `src/components/layout/AppLayout.tsx` stops mentioning the action entirely. The check
is by file name, not by line number, because the new file's line numbers are an
implementation detail: `grep -rl "getBandsAction" src '--include=*.tsx' '--include=*.ts' | grep -v __tests__ | sort`
prints exactly these three paths and nothing else - `src/app/AppShell.tsx`,
`src/app/actions/bands.ts`, `src/app/bands/page.tsx` - with
`src/components/layout/AppLayout.tsx` absent, which is the change this task makes. The
second and third paths are expected: they are the action's own declaration and the Bands
page's own pre-existing import, neither touched by this task nor on the ER13 whitelist.
(Quote the two `--include` flags as shown; unquoted they abort under zsh with `no matches
found`.) Per file, `grep -c "getBandsAction" src/app/AppShell.tsx` prints `2`, one import
line and one call site; `grep -c "getBandsAction" src/app/actions/bands.ts` prints `1` and
`grep -c "getBandsAction" src/app/bands/page.tsx` prints `1`, both unchanged from
`a493731`. `grep -n "bands={" src/app/AppShell.tsx src/components/layout/ConditionalLayout.tsx src/components/layout/AppLayout.tsx`
prints one line per file: `AppShell` passing `bands` to `ConditionalLayout`,
`ConditionalLayout` passing it to `AppLayout`, and `AppLayout` passing it to
`ContextSwitcher`. `grep -n "useState<BandOption\[\]>\|useState<Band\[\]>" src/components/layout/AppLayout.tsx`
prints nothing and exits 1.

ER5 - `src/components/tabs/__tests__/TabDrawingStage.test.tsx` exists, its literal first
line is `// @vitest-environment jsdom`, it calls `afterEach(cleanup)`, and
`npx vitest run src/components/tabs/__tests__/TabDrawingStage.test.tsx` passes with
exactly 6 tests and 0 failures. The six test names are, verbatim: `renders the page
toolbar from props alone, with no annotation fetch`; `shows the loading badge while the
annotations prop is null`; `calls onSaveAnnotations with the remaining strokes when Undo
is pressed`; `calls onSaveAnnotations with an empty page when Clear page is confirmed`;
`renders the annotationsError prop inside the stage`; `flushes a pending save through
onSaveAnnotations when it unmounts`. The third asserts the `onSaveAnnotations` spy was
called with the page number `1` and an array holding exactly the first of the two stroke
objects the test passed in through `annotations`; the fourth asserts it was called with
`1` and an empty array; the sixth asserts it was called with `1` and the remaining
strokes after `unmount()`, before the 800 ms debounce could have elapsed.

ER6 - `src/components/layout/__tests__/AppLayout.test.tsx` exists, its literal first line
is `// @vitest-environment jsdom`, it calls `afterEach(cleanup)`, and
`npx vitest run src/components/layout/__tests__/AppLayout.test.tsx` passes with exactly 4
tests and 0 failures. The four test names are, verbatim: `renders its children and both
navigation landmarks from props alone`; `lists every band in the bands prop inside the
context switcher`; `switches the band context to the band the user picks`; `renders only
its children once the session resolves to no user`. The second renders the component with
a two-element `bands` prop and asserts both band names appear after the context switcher
is opened, with no network or action call of any kind involved.

ER7 - Neither new suite mocks a Server Action module.
`grep -n "@/app/actions" src/components/tabs/__tests__/TabDrawingStage.test.tsx src/components/layout/__tests__/AppLayout.test.tsx`
prints nothing and exits 1, and
`grep -c "vi.mock" src/components/tabs/__tests__/TabDrawingStage.test.tsx` counts only
mocks of `react-pdf` and `@/lib/pdfWorker` while
`grep -c "vi.mock" src/components/layout/__tests__/AppLayout.test.tsx` counts only mocks
of `@/lib/auth-client`, `next/navigation` and `@/store/repertoireStore`, as confirmed by
reading the `vi.mock(` lines in each file.

ER8 - Stage Mode behaviour is provably unchanged: the pre-existing guards over the
drawing surface still pass untouched.
`npx vitest run src/lib/__tests__/erasePersistence.test.ts src/lib/__tests__/noBrowserDialogs.test.ts src/lib/__tests__/stageInteraction.test.ts src/lib/__tests__/annotationMath.test.ts src/lib/__tests__/pdfWorkerAsset.test.ts src/lib/__tests__/tabs.test.ts src/app/actions/__tests__/tabs.test.ts`
reports 7 passed files and 0 failures, and
`git diff a493731 -- src/lib/__tests__/erasePersistence.test.ts src/lib/__tests__/noBrowserDialogs.test.ts src/lib/__tests__/stageInteraction.test.ts src/lib/__tests__/annotationMath.test.ts src/lib/__tests__/pdfWorkerAsset.test.ts src/lib/__tests__/tabs.test.ts src/app/actions/__tests__/tabs.test.ts src/app/actions/tabs.ts src/lib/tabs.ts`
prints nothing, proving those guards were satisfied rather than adjusted and that the
action and lib layers were not touched.

ER9 - The whole suite is green. With Postgres running at
`postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied
(`npm run db:migrate`) and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` or the
environment, `npx vitest run` exits 0 reporting at least 57 test files and at least 727
tests passed, with 0 failed and 0 skipped. Without those two preconditions six DB-backed
files skip 51 tests and the run does not count.

ER10 - The coverage gate still passes and its universe did not move. With the same
Postgres and `SUPABASE_SERVICE_ROLE_KEY` preconditions as ER9, `npm run test:coverage`
exits 0 with all four thresholds met (statements 80, branches 65, functions 78, lines 80).
`git diff --name-only a493731 -- src/lib src/hooks src/app/actions src/proxy.ts` prints
nothing, confirming no file inside `vitest.config.ts`'s `coverage.include`
(`src/lib/**/*.ts`, `src/app/actions/*.ts`, `src/hooks/**/*.ts`, `src/proxy.ts`) was
added, removed or modified by this task.

ER11 - The app still builds and server-renders. `npx next build` exits 0, and
`npx playwright test e2e/ssr-smoke.spec.ts` reports `4 passed`.

ER12 - The version was bumped and the landing page was left alone. `node -p "require('./package.json').version"`
prints a string matching `^0\.1\.73-20[0-9]{10}$` (patch 73, then a 12-digit
`YYYYMMDDHHmm` local-time stamp), which is strictly greater than the `0.1.72-202609070958`
at `a493731`. This task ships no user-facing feature - it is an internal dependency
inversion - so it is not a selling point, and
`git diff --stat a493731 -- src/components/landing src/i18n/dictionaries` prints nothing.

ER13 - Nothing outside the task's footprint was touched. `git diff --name-only a493731`
prints a subset of exactly this whitelist: `docs/tasks/RH-46-spec.md`,
`docs/suggestions-log.md`, `package.json`, `src/types/database.ts`, `src/app/AppShell.tsx`,
`src/app/layout.tsx`, `src/app/songs/[id]/fast-view/page.tsx`,
`src/components/layout/ConditionalLayout.tsx`, `src/components/layout/AppLayout.tsx`,
`src/components/layout/__tests__/AppLayout.test.tsx`,
`src/components/tabs/TabDrawingStage.tsx`,
`src/components/tabs/__tests__/TabDrawingStage.test.tsx`. In particular it contains no
path under `src/components/songs/`, no `src/hooks/useBandAdmin.ts`, no
`eslint.config.mjs`, no path under `src/app/actions/`, no path under `migrations/` and no
path under `e2e/`.

## Out of Scope

- **RH-47 (part 3 of RH-37) owns everything else F21 named.** `src/components/songs/SongForm.tsx`,
  `src/components/songs/CorrectionModal.tsx` and `src/hooks/useBandAdmin.ts` keep their
  `@/app/actions/*` imports through this task, and the ESLint `no-restricted-imports`
  rule that will ban `@/app/*` under `src/components`, `src/lib` and `src/hooks` is not
  added here - it cannot reach zero violations until those three are inverted, and adding
  it now would break the pinned eslint baseline in ER1.
- No change to `src/app/actions/tabs.ts`, `src/app/actions/bands.ts`, `src/lib/tabs.ts`
  or `src/lib/bands.ts`. RH-45 settled those signatures and this task consumes them
  unchanged.
- No behavioural change to Stage Mode, the drawing/erasing/undo/clear model, the autosave
  timing, the band-mode theming or the navigation chrome. The only two accepted deltas are
  stated in the Approach: the band fetch is now gated on there being a session, and an
  annotation *load* error stays on screen instead of self-dismissing after 4 s.
- No server-side fetching of the band list in the root layout. It was considered (it would
  remove the client round trip entirely) and rejected for this task because it would add a
  session + database read to every request including unauthenticated ones, which is a
  behaviour change well beyond an inversion. It is recorded as a suggestion instead.
- No test for `src/app/AppShell.tsx` itself. It sits outside the coverage universe, holds
  only the fetch-and-reconcile effect moved verbatim out of `ContextSwitcher` (which was
  equally untested before), and is covered end to end by `e2e/ssr-smoke.spec.ts`.

## Post-merge checks (orchestrator)

- Confirm RH-47's dispatch prompt carries the corrected three-line `grep -rn "@/app/"`
  baseline from ER2, since RH-46 changes what "the remaining violations" means.
- `docs/plans/code-quality-review.md` F21 still claims "the two inward dependencies found
  by M4". Once RH-47 lands, F21 can be closed; until then its count remains wrong by
  three, as recorded in `.meridian/reports/RH-37-spec-1.md`.
