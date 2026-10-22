# RH-180 — Show a visual indicator of band mode on mobile

## Scope

On a phone a musician must see, on every main screen and without opening a menu, that the app is browsing a band's repertoire, and which band.

`AppLayout` (`src/components/layout/AppLayout.tsx`) already renders two inline band-mode pieces: a sticky strip at the top of the content wrapper ("Band Mode · <name>" with Exit) and a second strip inside the mobile bottom nav. Both are English-only literals, are not covered by a test at a phone width, and the reported symptom (no cue on a phone) was not reproduced from the code alone. The developer's first step is to open the app at 390x844 in band context on Home, Playlists, Bands, Profile, Settings and Fast View and record which of these screens lacks a visible cue (Fast View, whose root is `min-h-screen`, is the first suspect). The fix below holds regardless of the cause.

This task replaces the two inline pieces with one extracted component, `BandModeIndicator`, makes it the single persistent band cue on screens narrower than the `md` breakpoint, gives it translated copy, and pins it with tests. It does not touch the desktop sidebar badge, the context switcher, the band colour model, or the in-app copy of anything else.

Not covered: translating the rest of the app (see Internationalisation in `AGENTS.md`), any change to how band context is stored or reconciled.

## Approach

**Behavior**
- In band context, below `md`, one top bar is always on screen: a band icon, a localized "Band mode" label, the band name (truncated, never wrapped), and the existing Exit control. It is `sticky top-0` in the content wrapper with a z-index above page content, and uses the band's colour via `getBandThemeStyles`, so it differs from personal mode by colour and icon, not text alone.
- In personal context (and while signed out or before hydration) the component renders nothing: no element with `data-testid="band-indicator"` exists in the DOM.
- The bottom-nav band strip is removed, so the bottom nav holds only its five links and Sign out; the indicator never overlaps or covers a nav control, and the page content is not pushed under it.
- Switching context (switcher, Exit button, or reconcile) updates the bar through the zustand store with no reload. Exit keeps its current behaviour (`setUserContext`, `loadSongs`, route to `/`).
- Desktop (`md` and up) keeps the sidebar "Band Mode" badge and the existing top strip's look; the top bar is rendered by the same component at every width, so no second copy of the markup remains.
- Copy: add a `bandIndicator` block (`label`, `exit`) to `src/i18n/dictionaries/en.json` and `pt-BR.json` (PT-BR: "Modo banda", "Sair"). A new `getBandIndicatorCopy(locale)` in `src/lib/i18n.ts` returns one locale's copy. The root layout must stay static (reading `cookies()` or `headers()` there would make every route dynamic and break the prerendered `/offline` page the service worker precaches, RH-78), so it does not resolve the locale: `getBandIndicatorCopies()` builds both locales' copy on the server and the root layout passes that map down as the `bandIndicatorCopies` prop through `ConditionalLayout` to `AppLayout`. In the browser `AppLayout` picks the locale with `resolveBrowserLocale` (the `NEXT_LOCALE` cookie, then `navigator.languages`, then the pt-BR default) and hands that locale's copy to `BandModeIndicator`. No component calls `getDictionary`, so `namingConventions.test.ts` still holds. The band name and the desktop sidebar badge are unchanged.

**Files touched**
- `src/components/layout/BandModeIndicator.tsx` — new; the bar, props `{ band, theme, copy, onExit }`.
- `src/components/layout/AppLayout.tsx` — use the component, drop both inline strips, accept the copies prop and pick the browser's locale (keep it under the 400-line budget; it may not grow an override).
- `src/components/layout/ConditionalLayout.tsx` and `src/app/layout.tsx` — thread the `bandIndicatorCopies` prop (both locales' copy).
- `src/lib/i18n.ts`, `src/i18n/dictionaries/en.json`, `src/i18n/dictionaries/pt-BR.json` — copy and accessor.
- `src/components/layout/__tests__/AppLayout.test.tsx` — band-mode cases (below).
- `src/lib/__tests__/i18n.test.ts` — accessor returns both locales' copy; `landingCopy.test.ts` already pins equal key sets.
- `e2e/band-indicator-mobile.spec.ts` — new; `playwright.config.ts` adds it to the `mobile` project `testMatch` and to the `chromium` `testIgnore`.
- `AGENTS.md` (Internationalisation: name this as a second spec-mandated exception beside RH-111) and `docs/behavior.md`.

**Test criteria**
- Vitest/jsdom (`AppLayout.test.tsx`): with a band in the store the indicator shows the band name and the localized label; in personal context `queryByTestId('band-indicator')` is null; calling the store's `setUserContext` then `setBandContext` re-renders it without remounting the page; the bottom nav contains no band strip.
- Playwright `mobile`-style project at a 390x844 viewport, band selected (create or join one via the UI as `bands-confirm.spec.ts` does; the persisted store is reconciled against real bands): the indicator is visible on `/`, `/playlists`, `/bands`, `/profile`, `/settings` and a Fast View page, its bounding box does not intersect the bottom nav's, and after tapping Exit it is absent from the DOM with no reload. The `ContextSwitcher` lives only in the desktop sidebar (`hidden md:flex`) and this task adds no mobile switcher, so at 390px Exit is the only control and there is no UI path back to band mode without leaving the page. The test therefore proves "no reload" with a sentinel: before tapping Exit it sets `window.__rh180Sentinel = true` via `page.evaluate`, and after Exit asserts the sentinel still holds (a reload would clear it), the URL is `/`, and the indicator count is 0. The "returns" half is split: in Playwright, `page.reload()` after Exit must keep the indicator absent (personal persisted); the band-restoring switch (`setBandContext` re-rendering the bar in place) is proven in the vitest `AppLayout` case above, where the store is driven directly.
- `i18n` test: PT-BR returns "Modo banda", EN returns "Band mode".
- `npm run lint`, `lint:dead`, `lint:dup` and the full vitest suite stay green.

## Behavior changes

- added: Bands and admin — In band context a persistent top bar with a band icon, the localized "Band mode" label, the band name and an Exit control is shown on every screen below the md breakpoint, and is absent in personal context. (src/components/layout/BandModeIndicator.tsx, src/components/layout/AppLayout.tsx, e2e/band-indicator-mobile.spec.ts) (RH-180)
- added: Internationalisation — The band-mode indicator copy has pt-BR and en entries, built on the server and passed down as a prop; the browser picks the locale from the NEXT_LOCALE cookie, then its languages. (src/lib/i18n.ts, src/i18n/dictionaries/en.json) (RH-180)

## Expected Results
- [ ] At a 390px-wide viewport with a band selected, an element `[data-testid="band-indicator"]` showing the band name is visible on `/`, `/playlists`, `/bands`, `/profile`, `/settings` and a Fast View page, without opening any menu.
- [ ] In personal context at 390px, `[data-testid="band-indicator"]` does not exist in the DOM.
- [ ] The indicator carries a band icon and the band's colour as background, asserted in the vitest `AppLayout` test, so it differs from personal mode by more than text.
- [ ] At 390px, tapping Exit removes the indicator with no page reload (Playwright: a `window` sentinel set before Exit survives), and the vitest `AppLayout` test shows `setUserContext` then `setBandContext` removes and restores it in place.
- [ ] The Playwright test at 390px asserts the indicator's bounding box does not intersect the bottom navigation's, and that every nav link remains clickable.
- [ ] `getBandIndicatorCopy('pt-BR').label` is "Modo banda" and `getBandIndicatorCopy('en').label` is "Band mode", both dictionaries keep identical key sets (`landingCopy.test.ts` passes), and the rendered indicator shows the locale's label.

## Out of Scope
- Translating any other application copy; the desktop sidebar badge text.
- Changing band colour presets, context storage, or reconcile logic.
- Redesigning the bottom navigation.

## Operator Results Coverage
- Persistent band name on every main screen at 390px → Approach/Test criteria (Playwright) → ER1.
- Absent from DOM in personal mode → Behavior bullet 2 → ER2.
- More than text alone → Behavior bullet 1 (colour + icon), vitest → ER3.
- Band→personal→band updates without reload → Test criteria: Playwright sentinel for Exit, vitest for the restore (no mobile switcher exists at 390px) → ER4.
- No overlap with navigation at 390px → Playwright bounding boxes → ER5.
- Label translated in PT-BR and EN → Copy bullet → ER6.
