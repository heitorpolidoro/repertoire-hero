# RH-73 — Fix the AppLayout remount when the session resolves (duplicated DOM for ~200 ms on every route)

> **Filename mapping**: this is the spec for board task **RH-73**. It is stored as
> `docs/tasks/RH-74-spec.md` because this repository's spec filenames run one ahead of the board id
> (`docs/tasks/RH-73-spec.md` already belongs to the previous task, RH-72).

## Scope

`src/components/layout/AppLayout.tsx` currently renders three structurally different trees for the
same route within the first few hundred milliseconds:

1. server render and the first client render — `mounted === false`, so the early return is skipped
   and the full chrome (`<div class="flex h-screen">` → sidebar → `<main>` → `children`) is emitted;
2. the render right after the mount effect — `mounted === true` while `authClient.useSession()` is
   still pending, so `if (mounted && !session?.user)` fires and the component returns
   `<>{children}</>`: `children` changes both parent element and tree position, so React unmounts the
   whole route subtree and mounts a fresh copy;
3. the render after the session resolves — the chrome comes back and the route subtree is unmounted
   and mounted a third time.

Every route therefore pays two full remounts per load (state reset, effects re-run, requests
re-issued), and during the transition the document briefly carries two copies of the route's
controls — which is why `e2e/helpers.ts:waitForPlaylistDetailHydrated` needs a `networkidle` wait
before it can trust a `toHaveCount(1)`.

This task makes `AppLayout` render **one stable element tree** across all three phases: `children`
always sit inside the same wrapper element, at the same position, and only the chrome elements and
the wrapper's classes/role vary. It also drops the `networkidle` crutch from the e2e helper.

Not covered: `AppShell`, `ConditionalLayout`, moving session resolution to the server, the
`ContextSwitcher` `ssr: false` dynamic import, any visual redesign of the chrome. No mockup
accompanies this spec — the fix must be visually indistinguishable from today in both the
signed-in and signed-out steady states.

## Approach

**Behavior**

- `AppLayout` has exactly one `return`. The early `return <>{children}</>` is removed; `children`
  are rendered in the same content wrapper element in every phase, so React never unmounts them
  when the session resolves.
- Chrome visibility is derived from the session only, never from `mounted`:
  chrome is rendered while the session is pending **and** when it resolves to a user, and is not
  rendered once it resolves to no user (`isPending || !!session?.user` from
  `authClient.useSession()`). This keeps the server-rendered HTML and the first client render
  identical to today's (chrome present), so nothing about first paint or hydration matching
  regresses; the only change is that the signed-out transition now removes the chrome *around*
  `children` instead of replacing the tree that holds them.
- The content wrapper stays the same element type in both states. It keeps the chrome layout
  classes (`flex-1 overflow-y-auto bg-gray-50 pb-16 md:pb-0`, and the outer `flex h-screen`) only
  while the chrome is shown; with the chrome hidden both the outer wrapper and the content wrapper
  are layout-neutral (Tailwind `contents`), so a chrome-less route such as the signed-out landing
  page lays out exactly as it does today with the early return.
- The `main` landmark is exposed only while the chrome is shown, so a chrome-less route does not
  gain a second `main` landmark around a page that already renders its own (`LandingPage`).
- `mounted` survives only for its documented purpose — the band-mode hydration guard
  (`isBandMode = mounted && context.type === 'band'`). It must not gate the session branch.

**Files touched**

- `src/components/layout/AppLayout.tsx` — single stable tree; chrome driven by the session state;
  early return removed; wrapper classes/role switched instead of the tree.
- `src/components/layout/__tests__/AppLayout.test.tsx` — existing `useSession` mocks gain an
  explicit `isPending`; new cases for tree stability and control uniqueness (below).
- `e2e/helpers.ts` — `waitForPlaylistDetailHydrated` drops
  `await page.waitForLoadState('networkidle', ...)`; the doc comment's paragraph explaining the
  duplicate-DOM window is rewritten to state that RH-73 removed the window and that the
  `toHaveCount(1)` probe is now sufficient.
- `eslint.config.mjs` — the `src/components/layout/AppLayout.tsx` entry in the
  `complexity-budget-overrides` block must be re-pinned to the file's new exact worst numbers
  (currently `complexity: 21`, `max-lines-per-function: 202`). The ratchet may only shrink: if the
  new numbers are lower the entry must be lowered to match exactly, and the change may not push
  either number above its current pin, nor the file past the global `max-lines: 400`.
- `package.json` — patch version bump with the `YYYYMMDDHHmm` suffix, per the AGENTS.md rule.

**Test criteria**

- A jsdom test renders `AppLayout` with `useSession` returning `{ data: undefined, isPending: true }`,
  captures the DOM node of a child control, re-renders with `{ data: SESSION, isPending: false }`,
  and asserts the captured node is the *same* node object (`toBe`) and still has a parent — proving
  no unmount/remount across session resolution.
- The same test asserts `screen.getAllByText(<child control>)` has length 1 in each phase (pending,
  resolved-with-user, resolved-without-user), i.e. never two copies.
- A test asserts that with `{ data: null, isPending: false }` the chrome is gone
  (`queryAllByRole('navigation')` is empty, `queryByRole('main')` is null) while the child is still
  rendered, and that with a user both navigation landmarks and the `main` landmark are present.
- The existing four `AppLayout` tests still pass unchanged apart from the added `isPending` field.
- `npm run test:coverage` passes with the thresholds intact, and the guard tests
  (`complexityBudget`, `namingConventions`, `errorHandlingStyle`) stay green.
- The full Playwright suite passes with the `networkidle` wait removed, including
  `playlist-detail.spec.ts`'s `filters the playlist by title text`, which is the spec that
  previously failed on two filter inputs at once.

## Expected Results

- [ ] `src/components/layout/AppLayout.tsx` contains no early `return <>{children}</>`; `children`
      are rendered from a single return, inside the same wrapper element in every render phase.
- [ ] A jsdom test in `src/components/layout/__tests__/AppLayout.test.tsx` proves the child node
      object is identical (`toBe`) before and after `authClient.useSession()` resolves from pending
      to a signed-in session.
- [ ] The same test file proves exactly one copy of a route control is in the DOM while the session
      is pending, after it resolves to a user, and after it resolves to no user.
- [ ] With the session resolved to no user, `AppLayout` renders no `navigation` landmark and no
      `main` landmark, and applies no chrome layout classes to the wrappers, while still rendering
      its children.
- [ ] `e2e/helpers.ts:waitForPlaylistDetailHydrated` no longer calls
      `page.waitForLoadState('networkidle')`, and its doc comment explains why the wait is no longer
      needed.
- [ ] The full Playwright suite passes with that wait removed.
- [ ] `npm run test:coverage` passes with the configured thresholds and all guard tests green,
      including `src/lib/__tests__/complexityBudget.test.ts` with the `AppLayout.tsx` override entry
      pinned to the file's exact current worst numbers and the override list no longer than today.
- [ ] `package.json` carries a bumped patch version with a `YYYYMMDDHHmm` suffix higher than any
      version already in `git log`.

## Out of Scope

- Resolving the session server-side (root layout / `AppShell` props) to eliminate the pending window
  entirely.
- Changes to `ConditionalLayout`'s route allow-list, to `ContextSwitcher`, or to any page component.
- Any visual redesign of the sidebar, bottom nav or band-mode banner.
