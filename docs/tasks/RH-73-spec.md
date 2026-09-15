# RH-72 — Fix the stale-response race in `repertoireStore.loadSongs`

> **Filename mapping.** This file is `docs/tasks/RH-73-spec.md` but specifies **board task RH-72**.
> `docs/tasks/RH-72-spec.md` was already taken by an earlier task, so in this repository the spec
> filenames run one ahead of the board id. Read `RH-73-spec.md` as "the spec for RH-72".

## Scope

`src/store/repertoireStore.ts` has no request-ordering discipline: `loadSongs` awaits
`getRepertoireAction(bandId)` and unconditionally writes the result into `songs`. Any response that
is still in flight when something else changes the list wins the last write. Three observable
consequences, all in scope:

1. **Delete is undone.** `removeSong` optimistically filters the song out; a `loadSongs` started
   before the delete resolves afterwards with the pre-delete list and the deleted row reappears.
   Same for the optimistic `updateStatus` write.
2. **Context switch flips back.** `AppLayout` calls `loadSongs()` when the user switches band
   context and then `router.push('/')`; if the previous context's response lands last, the list
   shows the wrong repertoire.
3. **Duplicate mount load.** `src/app/page.tsx` loads on mount while `AppLayout.switchContext`
   has just fired its own `loadSongs()`, so two identical requests race for the same slot (and in
   React StrictMode dev the mount effect runs twice).

Out of scope: anything below the store (`src/lib/songs.ts`, the Server Actions), the shape of the
data, pagination/caching, any UI or visual change, and the `AppLayout` / `page.tsx` call sites
themselves — they keep calling `loadSongs()` exactly where they do today; the store is made to
tolerate it. This is an internal correctness fix, **not** a landing-page selling point, so the
dictionaries under `src/i18n/dictionaries/` are not touched.

No UI surface changes, therefore no HTML mockup accompanies this spec.

## Approach

### Behavior

`loadSongs` becomes ordered and self-invalidating. The bookkeeping lives in module-scoped
variables in `repertoireStore.ts` (not in `RepertoireState` — it is not UI state and nothing
renders it):

- **Request generation.** Every `loadSongs` call takes a monotonically increasing request id and
  records it as the current one. When its `await` resolves, it writes `songs` **only if** its id is
  still the current one; otherwise it returns without touching `songs`. A stale response never
  writes `songs`, under any circumstances.
- **`isLoading` is owned by the last request to settle, winner or not.** `isLoading` tracks "is any
  read in flight", not "did my read win". The store keeps a count of requests actually issued
  (deduped calls that adopt an in-flight promise are not counted again): `loadSongs` increments it
  before `await` and sets `isLoading: true`; in `finally` it decrements and sets
  `isLoading: false` **only when the count reaches zero**. Consequences, both required:
  - a stale response that is superseded by a still-in-flight newer `loadSongs` leaves
    `isLoading === true` (count > 0), so the spinner is not switched off underneath the newer load;
  - a stale response that is the *last* in-flight request still clears `isLoading` (count reaches
    zero). This is the case a generation bump with no successor produces — mutation invalidation
    (`removeSong`/`updateStatus`) and a band-context switch with no second `loadSongs` — and it is
    why `src/app/page.tsx` can never be stranded rendering "Loading..." forever.
- **Band context re-check.** A response is also discarded if `useBandContextStore.getState().bandId()`
  no longer equals the `bandId` the request was issued with — a context switch invalidates an
  in-flight read even if no second `loadSongs` followed it.
- **Mutation invalidation.** `removeSong` and `updateStatus` bump the generation before applying
  their optimistic write, so every read in flight at that moment is already stale when it lands.
  This is what actually fixes the headline bug: in the delete scenario the racing read is the
  *newest* read, so a sequence number alone would not discard it. `updateStatus`'s rollback path
  (`await get().loadSongs()`) is unaffected — it starts a fresh request with a fresh id.
- **In-flight dedupe.** While a request for a given `bandId` is in flight, a further `loadSongs()`
  for the same `bandId` reuses the in-flight promise instead of issuing a second
  `getRepertoireAction` call; the entry is cleared when the request settles. Generation bumps
  (mutations) clear it too, so a `loadSongs()` issued after a mutation always starts a fresh
  request and never adopts an invalidated one. This removes the duplicate mount/context-switch
  request rather than merely tolerating it.
- Error behavior is unchanged: `loadSongs` still has no `catch`; a rejection propagates to the
  caller, and the `finally` block runs the same in-flight-count decrement as the success path, so a
  rejection clears `isLoading` exactly when it is the last request in flight.

### Files touched

- `src/store/repertoireStore.ts` — request generation, band-context re-check, mutation
  invalidation and in-flight dedupe inside `loadSongs`/`removeSong`/`updateStatus`. Public store
  API (`RepertoireState`) unchanged.
- `src/store/__tests__/repertoireStore.test.ts` — **new**. Node environment (no DOM needed),
  `vi.mock('@/app/actions/repertoire')` with hand-resolved deferred promises to control ordering,
  `useRepertoireStore.setState` / `useBandContextStore.setState` to reset between cases.
- `package.json` — version bump per the AGENTS.md workflow rule.

### Test criteria

The new unit test file drives the ordering explicitly (no timers, no real network):

1. *Older response arriving last is ignored*: start a load for band A, switch the band context and
   start a load for band B, resolve B then resolve A — `songs` equals B's list.
2. *Delete survives a racing read*: start a load whose promise stays pending, call `removeSong(id)`
   (resolved action), then resolve the load with a list that still contains `id` — `songs` does not
   contain `id`.
3. *Dedupe*: two `loadSongs()` calls in the same tick for the same context produce exactly one
   `getRepertoireAction` call, and both promises resolve with the list applied once.
4. *Loading flag, newer load in flight*: a discarded stale response leaves `isLoading === true`
   while a newer load is still in flight; the winning response sets it to `false`.
5. *Loading flag, invalidated with no successor*: start a single load, call `removeSong(id)` (which
   bumps the generation) while it is pending, then resolve the load — `songs` does not contain `id`
   (the stale response is discarded) **and** `isLoading === false`. Repeat the same assertion for a
   band-context switch with no second `loadSongs`: after the pending response resolves,
   `isLoading === false` and `songs` is unchanged.

The existing vitest suite and the full Playwright e2e suite must stay green; no e2e spec is added
or modified.

## Expected Results

- [ ] `src/store/repertoireStore.ts` `loadSongs` discards responses from superseded requests
      (request-generation token), so a slow response never overwrites a newer list.
- [ ] A `removeSong` (or `updateStatus`) invalidates every `loadSongs` in flight at that moment, so
      a read that started before the mutation cannot resurrect the removed/stale row.
- [ ] A stale response does not clear `isLoading` while a newer `loadSongs` is still in flight.
- [ ] When an in-flight read is invalidated with no successor request (a `removeSong`/`updateStatus`
      generation bump, or a band-context switch with no second `loadSongs`), that response still
      sets `isLoading` to `false` when it settles while leaving `songs` untouched — the store never
      ends with `isLoading === true` and no request in flight.
- [ ] Duplicate `loadSongs()` calls for the same band context while a request is in flight issue
      only one `getRepertoireAction` call; `src/app/page.tsx` and `src/components/layout/AppLayout.tsx`
      keep their existing call sites unchanged.
- [ ] `src/store/__tests__/repertoireStore.test.ts` exists and proves, in at least one named test,
      that an older response arriving last is ignored.
- [ ] `npm run test:coverage` passes with its thresholds unchanged.
- [ ] The full Playwright e2e suite passes.
- [ ] `package.json` version bumped above `0.1.107-202609150158` in `X.Y.Z-YYYYMMDDHHmm` form.

## Out of Scope

- Changing `src/lib/songs.ts`, `src/app/actions/repertoire.ts`, or the `Repertoire` shape.
- Any visual/UI change, new e2e spec, or landing-page copy (internal fix, not a selling point).
- Turning `repertoireStore` into a server-data cache (AGENTS.md: stores hold UI state, not a cache).
