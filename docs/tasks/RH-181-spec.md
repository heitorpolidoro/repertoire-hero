# RH-181 — Let the musician switch between personal and band mode on mobile

Mockup: `docs/tasks/RH-181-mock.html`. It shows the personal bar, the sheet, the band bar's switch, Fast View (no switch), and the open placement question as options A (top bar, the spec's pick) and B (a bottom-nav entry).

## Scope

Below the `md` breakpoint a musician has no way to change context: `ContextSwitcher` lives only in the desktop sidebar (`hidden md:flex`, `src/components/layout/AppLayout.tsx`), and the RH-180 band bar offers only Exit, which can leave band mode but never enter it. This task adds a mobile control that lists Personal and every band the user belongs to and switches between them, writing the same persisted `band-context` store the desktop switcher writes.

Covered: the mobile trigger, the mobile picker sheet, a shared switch routine for desktop and mobile, tests (vitest + one Playwright mobile spec), and the registry/AGENTS.md lines.

Not covered:
- The desktop switcher's look or behaviour (it only starts calling the shared routine).
- How the context is stored or reconciled (`bandContextStore.ts`, `bandContext.ts`, `AppShell` stay as they are).
- Filtering `/playlists` by context. Today it lists personal and every band's playlists, grouped by owner, in either mode (registry: "Playlists are listed grouped by owner, personal and per band"). A band's group appears there only once the band has a playlist (`buildPlaylistGroups`, `src/lib/playlistList.ts`). That stays as it is. Whether to filter is asked as an operator question.
- Switching from inside Fast View or Stage Mode, which are addressed by URL (`?bandId=`). There the RH-180 bar keeps only Exit.
- Translating the new copy. The rest of the app chrome is English-only; RH-180's indicator copy is the documented exception and stays the only one.

## Approach

**Behavior**
- **Trigger, personal mode.** Below `md`, once hydrated and signed in, with at least one band in the `bands` prop, a slim bar sits at the top of the content wrapper in normal flow (it scrolls away, unlike the sticky band bar). It shows `👤 Personal` and a `Switch ▾` button: `data-testid="mobile-context-trigger"`, `aria-haspopup="dialog"`, accessible name "Switch mode". With zero bands there is nothing to switch to, so the bar does not render.
- **Placement (open question).** The spec takes option A from the mock: a top bar in personal mode. Option B, a "Mode" entry in the bottom nav, was not taken. The nav already holds six items (seven for a system admin), and a seventh or eighth would shrink every label. If the operator picks B, the personal-mode trigger moves into the nav and ER6 drops its non-overlap check for that trigger. The sheet, the band-bar switch and the other results do not change.
- **Trigger, band mode.** The RH-180 `BandModeIndicator` gets an optional `onSwitch` prop. When given, the band name becomes a button with the same test id, accessible name "Switch mode" and a `▾`. Exit is unchanged and gets `data-testid="band-indicator-exit"`. The indicator is one component at every width. With `onSwitch`, the name is a button below `md` and stays plain text at `md+`, where the sidebar switcher already exists.
- **Not on Fast View.** On `/songs/*/fast-view` the personal bar is not rendered and the indicator gets no `onSwitch`.
- **Sheet.** Tapping the trigger opens a bottom sheet (`role="dialog"`, `aria-label="Switch mode"`, `data-testid="mobile-context-sheet"`) above the bottom nav, with a backdrop. It lists one `Personal` option (the user's name below it), then a "Bands" heading and one option per band with its colour dot. The active option has `aria-current="true"` and a ✓. Backdrop tap, a Close button and Escape dismiss it without changing anything.
- **Switching.** Choosing an option does exactly what the desktop switcher does today: `setUserContext()` or `setBandContext(id, name, color)`, then `loadSongs()`, then `router.push('/')`, then the sheet closes. Choosing the already-active option just closes the sheet. This routine moves into one new hook, `useContextSwitch`, and both `ContextSwitcherComponent` and the mobile sheet call it. No switch logic is copied.
- **One store.** Both controls read and write `useBandContextStore` (localStorage key `band-context`). A choice made on one is what the other shows after reload, and it survives reload at any width.
- **No overlap.** The sheet and both triggers never cover a bottom-nav link while closed. The sheet sits at `z-30` (above the bar's `z-20` and the nav's `z-10`) only while open.

**Files touched**
- `src/hooks/useContextSwitch.ts`: new. Returns `switchTo(target)` for `{ type: 'user' } | { type: 'band', id, name, color? }`: store write, `loadSongs`, push `/`.
- `src/components/layout/MobileContextSwitcher.tsx`: new. Personal bar, sheet, option list. Props: bands, the open/close state owner, the current context, the user's display name.
- `src/components/layout/BandModeIndicator.tsx`: optional `onSwitch` and the mobile-only name button, plus the Exit test id.
- `src/components/layout/AppLayout.tsx`: renders the personal bar and passes `onSwitch` below `md` outside Fast View. `ContextSwitcherComponent` calls `useContextSwitch`. It must stay at or under 400 lines with no new complexity override; move the sheet's open state into `MobileContextSwitcher` if needed.
- `src/hooks/__tests__/useContextSwitch.test.ts`, `src/components/layout/__tests__/MobileContextSwitcher.test.tsx` (jsdom): new.
- `src/components/layout/__tests__/AppLayout.test.tsx`: personal bar present or absent cases, and the indicator's switch button.
- `e2e/context-switch-mobile.spec.ts`: new. `playwright.config.ts` adds it to the `mobile` project's `testMatch` and the `chromium` project's `testIgnore`.
- `e2e/band-indicator-mobile.spec.ts`: Exit is clicked by `band-indicator-exit` (the bar now holds two buttons, so `getByRole('button')` would be ambiguous). The header comment saying there is no mobile switcher is corrected.
- `AGENTS.md`: the hooks list gains `useContextSwitch.ts`, and the layout directory line names `MobileContextSwitcher`. `docs/behavior.md`: the line below.

**Test criteria**
- `useContextSwitch` (vitest): a band target calls `setBandContext` with id, name and colour, then `loadSongs`, then `push('/')`. A user target calls `setUserContext`.
- `MobileContextSwitcher` (jsdom): it lists Personal and every band from the prop, marks the active one `aria-current`, closes on backdrop, Close and Escape without a store write, and switches through the hook when an option is tapped. It renders nothing with zero bands.
- `AppLayout` (jsdom): there is a personal bar in personal mode with bands, none on a Fast View pathname, and the indicator's switch button is present in band mode.
- Playwright, `mobile` project, viewport 375×812. Create a band through the UI (as `band-indicator-mobile.spec.ts` does). On `/`, `/playlists`, `/bands`, `/profile` and `/settings` the trigger is visible and its box does not intersect the bottom nav's. From `/`, open the sheet: it lists "Personal" and the band. Choose the band: the heading is `🎸 <band>` and `band-indicator` is visible. On `/playlists`, create a playlist through `+ New Playlist`. It lands in the `section[aria-label="Band: <band>"]` group, which proves the band is the active owner. A new band has no playlists, so its group does not exist before this step. Reload: still the band. Set the viewport to 1280×800 and reload: the desktop sidebar switcher shows the band's name. Back at 375, choose Personal from the indicator's trigger: the heading is "My Repertoire" and the indicator count is 0. Reload: still personal. Delete the band.
- `npm run lint` (exit code checked out of band, see AGENTS.md), `lint:dead`, `lint:dup`, the full vitest suite and `band-indicator-mobile.spec.ts` stay green.

## Behavior changes

- added: Bands and admin — Below the md breakpoint, outside Fast View, a user in at least one band has a "Switch mode" control (a personal bar, or the band name in the band-mode bar) that opens a sheet listing Personal and each band; choosing one writes the same persisted context as the desktop switcher and returns to the repertoire home. (src/components/layout/MobileContextSwitcher.tsx, src/hooks/useContextSwitch.ts, e2e/context-switch-mobile.spec.ts) (RH-181)

## Expected Results
- [ ] At a 375px-wide viewport on `/`, for a user in at least one band, `[data-testid="mobile-context-trigger"]` is visible and opens a sheet listing "Personal" and every band the user belongs to.
- [ ] Choosing a band in the sheet makes the Repertoire heading read "🎸 <band name>", and a playlist then created on `/playlists` appears under `section[aria-label="Band: <band name>"]`.
- [ ] Choosing "Personal" in the sheet makes the Repertoire heading read "My Repertoire" and removes `[data-testid="band-indicator"]` from the DOM.
- [ ] A band chosen in the mobile sheet is the name shown by the desktop sidebar switcher at 1280px after reload, because both read the `band-context` localStorage entry.
- [ ] At 375px, the context chosen in the mobile sheet is still active after `page.reload()`.
- [ ] At 375px the trigger is visible on `/`, `/playlists`, `/bands`, `/profile` and `/settings` without entering Fast View or Stage Mode, and its bounding box does not intersect the bottom navigation's.
- [ ] `e2e/context-switch-mobile.spec.ts`, run by the `mobile` Playwright project at 375×812, switches personal → band → personal through the control and passes, and `e2e/band-indicator-mobile.spec.ts` still passes.

## Out of Scope
- Filtering `/playlists` by the active context.
- A mode switch inside Fast View or Stage Mode.
- Translating the new copy, and the desktop switcher's look.

## Operator Results Coverage
- "Visible control lists personal and every band at 375px" → Behavior (trigger, sheet) → ER1.
- "Selecting a band sets the context; repertoire and playlists show the band's data" → Behavior (switching) → ER2. The repertoire is context-scoped and changes. `/playlists` already lists every owner's group in both modes, so the check is that a playlist created after switching is owned by the band and shown in its group. Filtering is a separate change, raised as an operator question.
- "Selecting personal returns to personal data" → Behavior (switching) → ER3.
- "Mobile and desktop share the stored context, reflected after reload" → Behavior (one store) → ER4.
- "Persists across reload on mobile" → Behavior (one store) → ER5.
- "Reachable from the main mobile layout without Fast View or Stage Mode" → Behavior (triggers, not on Fast View) → ER6.
- "An e2e test at a mobile viewport switches personal → band → back and passes" → Test criteria (Playwright) → ER7.
