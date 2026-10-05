# RH-100 — Delete the unbuilt /songs/search route

## Scope

Remove the dead `/songs/search` route and every live reference to it. `src/app/songs/search/page.tsx` is eight lines rendering "Global song search coming soon" (it is the whole route — the directory holds no `layout.tsx`, `loading.tsx` or anything else), and nothing in the application links to it: a repo-wide grep for `songs/search` outside `docs/` and `.meridian/` matches only two test files and one comment in `serwist.config.js`. The search that works is the dashboard box (`docs/use-cases.md`, *Search for a song*), which this task does not touch.

**The one thing with real risk is already settled by inspection, and the answer is "change nothing".** The task brief says the deletion takes "its proxy matcher entry" with it. There is no such entry. `src/proxy.ts`'s twelve-entry allow-list covers this route through the catch-all `'/songs/(.*)'`, which is the same entry that covers `/songs/[id]/fast-view` — the only other page under `/songs/`. Removing it would stop turning signed-out visitors away from Fast View, which is exactly the widening the brief warns about. So `src/proxy.ts` is not edited at all, and the matcher stays at twelve entries. After the deletion, `/songs/search` keeps its signed-out 307 to `/login` (the proxy pattern still matches it) and answers 404 to a signed-in visitor, which is correct for a route that no longer exists.

Out of scope: building any catalog browse screen, pagination or artist filtering — that alternative was considered and declined ("tira, se não foi implementada ainda não faz sentido"); any change to `src/proxy.ts`; any change to the dashboard search or `searchGlobalSongs`; and the historical record in `docs/` (the RH-41/RH-61/RH-62/RH-63/RH-65/RH-71/RH-79 specs, `docs/suggestions-log.md`, `docs/reviews/feature-review.md`, `docs/plans/*`) — those documents record measurements taken at named commits and must keep naming `/songs/search`. No migration is needed.

## Approach

**Behavior.** The route ceases to exist. Nothing under `src/`, `e2e/`, `scripts/` or the root config files names it any more. The proxy's redirect behaviour for every surviving route is bit-for-bit what it is today, because the proxy is not touched. The production build no longer emits a prerendered document for the route, and the PWA precache guard no longer asserts against a URL that cannot be produced.

**Files touched.**

- `src/app/songs/search/page.tsx` — deleted; the now-empty `search/` directory goes with it.
- `src/lib/__tests__/proxy.test.ts` — two stale literals. The query-string-preservation test (`~line 78`) uses `/songs/search?q=hey&tag=rock` purely as a sample gated path; retarget it at a route that still exists, `/songs/abc/fast-view`, and update the expected `location` accordingly. The matcher allow-list test (`~line 137`) lists `/songs/search` among the paths the matcher must match; drop that entry — `/songs/abc/fast-view` is already in the same list, so `'/songs/(.*)'` stays covered. Leave the "exactly twelve matcher entries" test untouched.
- `src/lib/__tests__/pwaShell.test.ts` — two stale literals. Drop `/songs/search` from `FORBIDDEN_URLS` (~line 96): with the route gone, no page under `/songs/` is prerenderable, so there is no `/songs/*` document the precache could swallow and no honest substitute. In the matcher-regex sanity loop (~line 180) replace `/songs/search` with `/songs/abc/fast-view`, so the loop still proves the `/songs/(.*)` pattern compiles and matches.
- `serwist.config.js` — the doc comment lists the prerendered documents `precachePrerendered: true` would sweep in, "seven of which are in the `src/proxy.ts` matcher". Remove `/songs/search` from that list and correct the count to six. Prose only; no option changes.
- `package.json` — version bump per the AGENTS.md rule (patch plus `-YYYYMMDDHHmm`, strictly above `0.1.135-202610050942`).

Not a selling point: this removes a stub nobody could use, so the landing-page copy in both dictionaries is unchanged. `common.search` in the dictionaries is one of the 22 deliberately-unconsumed keys AGENTS.md says stay; leave it.

**Test criteria.** No new test is warranted — the guards that matter already exist and must stay green: `src/lib/__tests__/proxy.test.ts` (unchanged behaviour, twelve matcher entries, `/songs/(.*)` present), `src/lib/__tests__/pwaShell.test.ts`, and the whole `npm run test:coverage` run against its thresholds. `npm run lint:dead` (knip) must stay green — the deletion removes code, so it can only help. The proof that nothing widened or narrowed is `git diff -- src/proxy.ts` printing nothing.

## Expected Results

- [ ] ER1 — The route is gone: `src/app/songs/search/` does not exist, and `find src/app/songs -type f` prints exactly one line, `src/app/songs/[id]/fast-view/page.tsx`.
- [ ] ER2 — Protection did not move: `git diff -- src/proxy.ts` prints nothing, `grep -c "'/songs/(\.\*)'" src/proxy.ts` prints `1`, and the proxy suite's `lists exactly twelve matcher entries, each a valid regular-expression source` test passes unmodified.
- [ ] ER3 — No live reference survives: `grep -rn "songs/search" src e2e scripts next.config.ts serwist.config.js` prints nothing and exits non-zero. (`docs/` and `.meridian/` keep the historical record and are deliberately excluded.)
- [ ] ER4 — `src/lib/__tests__/proxy.test.ts` asserts the query-string behaviour on a live route: the request is `http://localhost/songs/abc/fast-view?q=hey&tag=rock` and the expected `location` is `http://localhost/login?q=hey&tag=rock&redirect=%2Fsongs%2Fabc%2Ffast-view`; the matcher allow-list array no longer contains `/songs/search` and still contains `/songs/abc/fast-view`.
- [ ] ER5 — `src/lib/__tests__/pwaShell.test.ts`'s `FORBIDDEN_URLS` has seven entries, none of them beginning `/songs/`, and the matcher-regex sanity loop asserts `/songs/abc/fast-view` is matched.
- [ ] ER6 — `grep -c "songs/search" serwist.config.js` prints `0`, and the same comment block states that six (not seven) of the swept documents are in the `src/proxy.ts` matcher.
- [ ] ER7 — `./node_modules/.bin/tsc --noEmit` exits `0` printing nothing; `npm run test:coverage` exits `0` with the configured thresholds met; `npm run lint:dead` exits `0`.
- [ ] ER8 — From a clean build, `rm -rf .next && npx next build` exits `0`; `ls .next/server/app/songs/search.html` exits non-zero; and `node -e "console.log(Object.keys(require('./.next/prerender-manifest.json').routes).sort().join(' '))"` prints a list that does **not** contain `/songs/search` and still contains `/login`, `/settings` and `/signup`.
- [ ] ER9 — `package.json`'s `version` is a patch bump with a `-YYYYMMDDHHmm` suffix, strictly greater than `0.1.135-202610050942`.

## Out of Scope

- Any catalog browse / global search screen. Declined; do not revive the route in another shape.
- Any edit to `src/proxy.ts`, including "tidying" the `/songs/(.*)` entry.
- The dashboard search path (`searchGlobalSongs`, `src/components/songs/RepertoireDashboard.tsx`) and the trigram/ranking work (F1.5).
- The `/songs/search` mentions in `docs/` and `.meridian/`, which are dated measurements and stay as written.
