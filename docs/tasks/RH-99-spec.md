# RH-98 — Fall back to personal context when the selected band is gone

> Board id RH-98; spec filename follows the project's board-id-plus-one convention.

## Scope

A persisted band context that no longer matches any band the server returns must revert
to personal instead of staying and poisoning every band-scoped call.

`src/app/AppShell.tsx` already fetches the band list once per signed-in session and
reconciles the persisted context against it — but only on the branch where the band **is**
found, where it refreshes the stored name and colour (`AppShell.tsx:35-43`). There is no
`else`. A context pointing at a band the user has left, was removed from, or that was
deleted survives in `localStorage`, and every band-scoped read and write then goes through
`resolveOwner` (`src/app/actions/repertoire.ts:25`) into `assertBandMember`
(`src/lib/bands.ts:36`), which throws `Access denied: not a member of this band`. Reloading
returns to the same state; the only exit is knowing to use the context switcher.

This task adds the missing branch, moves the whole decision into a pure, unit-tested
function, and reloads the repertoire once the context has changed so the dashboard is not
left showing (or failing to show) the gone band's songs.

**It does not** change `src/lib/bands.ts`, `resolveOwner`, or any authorization check — the
server-side `Access denied` is correct and stays. It does not touch `signOutAndPurge`
(`src/components/layout/SignOutButton.tsx:23`), which already clears the context before
`authClient.signOut()`. It needs no migration and changes no SQL.

## The `?bandId=` question — decided, and deliberately out of scope

Fast View takes its context from the URL (`?bandId=`, read at
`src/app/songs/[id]/fast-view/page.tsx:65` and passed into `useSongEntry` and
`usePlaylistNav`), independent of the store. The decided rules, which the implementation
must preserve rather than change:

1. **The URL wins for Fast View's own reads.** It is an explicit navigation target, the
   server authorizes it independently through `resolveOwner`, and the page's seven
   controllers already share it. The store is not consulted there and must not start
   being consulted.
2. **A stale link writes nothing.** Fast View never calls `setBandContext`/`setUserContext`
   (verified: the only writers are `AppShell`, `ContextSwitcher`, `AppLayout`'s exit-band
   button, `useBandEdit` and `SignOutButton`). So a shared or bookmarked link carrying a
   band the viewer cannot read cannot corrupt the persisted context, and the fallback this
   task adds cannot be defeated by one.
3. **A stale link cannot be rescued into personal context, and the existing "Song not
   found" screen is the right outcome.** `?bandId=` accompanies a *band* repertoire row
   id; `getSongEntry` (`src/lib/songs.ts:207`) matches `r.id = $1 AND r.band_id = $2`, and
   that row has no personal equivalent to fall back to — the user's own row for the same
   song is a different `repertoire.id`. Retrying the read without the `bandId` therefore
   resolves nothing. `useSongEntry` already lands such a link on `SongNotFound` (or
   `OfflineUnavailable` offline) via its `catch`, which is a dead end but an honest one.

Making that screen *say* why ("you are no longer in that band") is a separate deliverable:
it requires distinguishing an authorization refusal from a missing row across the Server
Action boundary, where thrown messages are redacted in production builds, i.e. a result
envelope change in `getSongEntryAction` and its callers. It is not part of this task.

## Approach

**Behavior**

- A new pure module decides the reconciliation from the persisted context plus the fetched
  band list, with exactly four outcomes: personal context → no change; band found with
  matching name and colour → no change; band found with a different name or colour →
  refresh (today's behaviour, colour defaulted through `DEFAULT_BAND_COLOR`); band **absent
  from the list** → reset to personal.
- `AppShell` applies that decision inside the existing `getBandsAction().then(...)`
  success path, after `setBands`. On `reset` it calls the store's `setUserContext()` and
  then `useRepertoireStore.getState().loadSongs()` once, so the dashboard replaces the
  band's rows (or the failed band read) with the personal repertoire. It does **not**
  navigate — the user stays on the page they are on.
- The reset fires only when the band list is authoritative, i.e. only in the resolved path.
  A rejected `getBandsAction()` must leave the persisted context exactly as it was; the
  current promise has no rejection handler at all, so one is added that logs through
  `logger` (`L1`/`P1` conventions) and changes no state.
- An empty resolved list is authoritative: a band context with `bands === []` resets.
- The reset is silent — the feedback is the context switcher relabelling itself from the
  band name to the user's own, and the chrome dropping out of band mode (`AppLayout`
  already derives both from the store). See Out of Scope.

**Files touched**

- `src/lib/bandContext.ts` — new. The pure decision function and its result type. Imports
  `BandContext` from `@/store/bandContextStore` and `BandOption` from `@/types/database`
  as types only (no value import, so no zustand or `pg` is pulled in), plus
  `DEFAULT_BAND_COLOR` from `@/lib/bandColors`. Exported as a `function` declaration, per
  the naming guard.
- `src/app/AppShell.tsx` — calls the new function and applies its outcome; adds the reset
  branch, the `loadSongs()` after a reset, and the rejection handler. The name/colour
  refresh logic moves out of the component and into the new module.
- `src/lib/__tests__/bandContext.test.ts` — new. Unit tests for the decision function.
- `src/app/__tests__/AppShell.test.tsx` — new DOM test (`// @vitest-environment jsdom`
  first line, `afterEach(cleanup)`), mocking `@/lib/auth-client` and
  `@/app/actions/bands`, following `src/components/layout/__tests__/AppLayout.test.tsx`.

**Test criteria**

- The decision function is covered for all four outcomes, including: a band whose colour is
  `null` in the list against a stored `DEFAULT_BAND_COLOR` context (no change, not a
  refresh loop), an empty list with a band context (reset), and a personal context with an
  empty list (no change).
- The `AppShell` test drives the real `bandContextStore`: with a persisted band context and
  a fetched list that omits it, the store ends at `{ type: 'user' }` and `loadSongs` was
  called once; with the band present but renamed, the store keeps `type: 'band'` with the
  fetched name/colour and `loadSongs` is **not** called; with `getBandsAction` rejecting,
  the store still holds the original band context and `loadSongs` is not called.
- `npm run test:coverage` stays above its thresholds (the new module is inside
  `coverage.include`), and `npm run lint:dead` reports no unused export.

## Expected Results

- [ ] ER1 — A new pure module `src/lib/bandContext.ts` exports one `function` declaration
      that maps a persisted `BandContext` plus a `BandOption[]` to one of exactly three
      outcomes — keep, refresh (name/colour), reset to personal — and imports
      `BandContext`/`BandOption` with `import type` only.
- [ ] ER2 — Given a persisted band context whose id is absent from the list
      `getBandsAction()` resolves with, `AppShell` leaves `bandContextStore` holding
      `{ type: 'user' }`.
- [ ] ER3 — The same case is also true for an empty resolved list: a band context with
      `bands === []` resets to personal.
- [ ] ER4 — Given a persisted band context whose id **is** in the list but whose name or
      colour differs, `AppShell` keeps `type: 'band'` and updates the stored name and
      colour to the fetched values (colour defaulted to `DEFAULT_BAND_COLOR` when the
      fetched row's colour is `null`); a context already matching the fetched row triggers
      no store write.
- [ ] ER5 — When `getBandsAction()` rejects, the persisted context is left untouched (no
      reset, no refresh) and the failure is reported through `logger`, not `console`, and
      not as an unhandled rejection.
- [ ] ER6 — After a reset, `useRepertoireStore.getState().loadSongs()` is called exactly
      once so the personal repertoire replaces the band's, and no navigation is triggered
      (`router.push` is not called by `AppShell`).
- [ ] ER7 — `src/lib/__tests__/bandContext.test.ts` exists and passes, covering keep,
      refresh, reset, the `null`-colour equivalence case and the personal-context case.
- [ ] ER8 — `src/app/__tests__/AppShell.test.tsx` exists and passes, asserting ER2, ER4,
      ER5 and ER6 against the real `bandContextStore` with `@/app/actions/bands` and
      `@/lib/auth-client` mocked.
- [ ] ER9 — No authorization behaviour changed: `src/lib/bands.ts`,
      `src/app/actions/repertoire.ts` and `src/components/layout/SignOutButton.tsx` are
      unmodified by this task, and no file under `src/` reads `?bandId=` from the store or
      writes the store from a URL parameter.
- [ ] ER10 — `npm run test:coverage` passes with its configured thresholds, `npm run
      lint:dead` and `npm run lint:dup` pass, and
      `src/lib/__tests__/complexityBudget.test.ts` passes with no new entry in the
      complexity-budget override list.
- [ ] ER11 — `package.json`'s version is bumped per the AGENTS.md versioning rule.

## Out of Scope

- **No migration and no SQL change.** Nothing here is persisted server-side.
- **No user-visible notification of the reset.** `AppShell` owns no toast surface and the
  switcher label plus the chrome leaving band mode are the feedback; adding a banner would
  mean introducing a cross-route notification surface, which is its own task.
- **No change to the `?bandId=` Fast View path**, including the wording of `SongNotFound`
  for a stale link — see the decision section above.
- **Not a selling point** (AGENTS.md Landing Page Rule): this is a defect fix in session
  state handling, so the landing copy and both dictionaries stay untouched.
- **No interactive mockup.** The task introduces no new UI and asks no visual question; the
  only visible change is existing chrome (the switcher and band-mode theme) reverting to
  its existing personal state.
