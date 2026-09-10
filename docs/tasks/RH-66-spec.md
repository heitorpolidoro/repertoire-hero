# RH-66 — PlaylistDetailPage part 1/6: the characterization e2e net for /playlists/[id], and F13's derived currentUserId

Parent: RH-53 (F11/F13, part 1 of 6). Siblings RH-67..RH-71 are chained after
this one and refactor the page against the net this task lands.
Baseline for every measurement in this document: `a17dd2b`
(`fix(RH-72): run the dev server on Turbopack so Fast View survives the E2E job`),
tree clean.

## Scope

Two deliverables, in the order that matters:

1. **The regression net.** A new Playwright spec, `e2e/playlist-detail.spec.ts`,
   that drives `/playlists/[id]` through the ten behaviours the next five parts
   are going to move: opening a playlist from `/playlists`, adding a song
   through the picker on the catalog path, removing a song, cycling a mastery
   status, adding and removing a song tag, adding a playlist tag, renaming the
   playlist inline, filtering by text and filtering by tag. Today
   `grep -rn "playlists/" e2e/*.ts` prints nothing and there is no
   `src/app/playlists/[id]/__tests__` directory: 1344 lines of UI with nothing
   under them. Parts 2-6 are behaviour-preserving moves, and a
   behaviour-preserving move with no test is a rewrite.
2. **The whole of F13** (`docs/plans/code-quality-review.md:343`): the
   `currentUserId` session mirror becomes a derived `const`, the review doc gets
   its `Status:` line including the sweep for other mirrors, and the page's
   `complexity-budget/override` entry is re-pinned to the three freshly measured
   numbers.

Behaviour is preserved exactly. Not one attribute of the page's markup changes:
no `aria-label` is added, no `data-testid` is added, no class changes. The spec
locates everything through the accessible names and placeholders the page
already has (see "Locator contract"), which is deliberate — those names become
the contract parts 2-6 must preserve when the same markup moves into
`src/components/playlists/`.

Nothing else changes. No Server Action, no `src/lib`, no `src/app/api/**`, no
`src/store/**`, no `playwright.config.ts`, no new unit test, no new
`complexity-budget/override` entry.

## Audit at a17dd2b

### The page

`grep -c "" 'src/app/playlists/[id]/page.tsx'` prints `1344`;
`grep -c "useState" ...` prints `24`. Its override, `eslint.config.mjs:74`:

```
{ name: "complexity-budget/override", files: ["src/app/playlists/\\[id\\]/page.tsx"],
  rules: { complexity: ["error", 34], "max-lines-per-function": ["error", 1072], "max-lines": ["error", 1344] } }
```

`rtk proxy npx eslint 'src/app/playlists/[id]/page.tsx'` exits `0` with no
output: the file contributes nothing to the repo total of
`22 problems (8 errors, 14 warnings)`, because those three numbers absorb its
three violations. `grep -c "complexity-budget/override" eslint.config.mjs`
prints `20`, `MAX_OVERRIDES = 20` in `src/lib/__tests__/complexityBudget.test.ts:49`,
and AGENTS.md:97 ends on "the list growing past 20 entries" — the list is a
ratchet on its **length**, and the guard additionally fails "on an override
ceiling that is not exactly the file's current worst number", so whatever the
three numbers measure at after the edit is what must be written, in the same
commit.

### F13, precisely

Three lines, all inside `PlaylistDetailPage`:

- `277` `const { data: session } = authClient.useSession();`
- `291` `const [currentUserId, setCurrentUserId] = useState<string | null>(null);`
- `343` `setCurrentUserId(session?.user?.id ?? null);`, inside `refreshPlaylist`
- `349` the `useCallback` dependency list, which carries `session?.user?.id`

One writer, one reader (`902`, the ownership gate on the playlist tag bar),
tied to the success of an unrelated network call.
`grep -n "session" 'src/app/playlists/[id]/page.tsx'` prints exactly lines 277,
343 and 349. Once the copy at 343 is gone, `refreshPlaylist` no longer reads the
session at all, so the dependency entry at 349 becomes a
`react-hooks/exhaustive-deps` "unnecessary dependency" warning if it is not
removed with it — which would take the repo total to 23 problems. The `session`
binding at 277 itself stays, because the derived `const` this task adds under it
reads it (see "The F13 edit").

### The sweep the remediation asks for

`grep -rn "useState" src/hooks src/app src/components | grep -v __tests__ | grep -iE "session|userid|currentuser"`
prints **exactly one line at `a17dd2b`**: page line 291. The other five
`authClient.useSession()` call sites (`src/app/AppShell.tsx:22`,
`src/app/page.tsx:625`, `src/components/layout/AppLayout.tsx:39` and `:146`,
`src/hooks/useBandAdmin.ts:126`) read the session directly; `useBandAdmin.ts:127`
is already `const currentUserId = session?.user?.id ?? null`, which RH-64
(`6aa099c`) put there. So the sweep result is the empty set the moment this
task's own line is fixed, and F13 needs nothing from RH-67..RH-71.

### The e2e suite

`npx playwright test --list` prints `Total: 22 tests in 6 files`
(`auth`, `bands-confirm`, `fast-view-mobile`, `server-pages`, `songs-crud`,
`ssr-smoke`). `playwright.config.ts` has `retries: 2` and `workers: 1` on CI
only, a 30 s test timeout, `globalSetup: ./e2e/global-setup.ts` (which signs the
`e2e-test@example.com` user up and in through the Better Auth HTTP endpoints and
writes cookies to `e2e/.auth/user.json`), and a `webServer` whose command is
`process.env.PLAYWRIGHT_WEB_SERVER ?? 'npm run dev'`. The `mobile` project has
`testMatch: '**/fast-view-mobile.spec.ts'`, so a new spec file runs in the
`chromium` project only, once.

`e2e/helpers.ts` already holds the RH-44 idempotency doctrine: `uniqueSongTitle`
with a module-level counter plus `Date.now()` and `process.pid`, documented as
callable only from inside a test body because a retry runs in the same worker;
`addSong` / `editSong` / `deleteSong` / `goHome` / `songCard`; and the
hydration-race pattern `await expect(async () => { click; expect(dialog).toBeVisible({timeout: 2_000}) }).toPass({ timeout: 30_000 })`,
which is how a cold Turbopack route is handled without a `waitForTimeout`.

Storage state is **not** in `use:` at config level; every spec opts in with
`test.use({ storageState: AUTH_STATE_PATH })` (`AUTH_STATE_PATH` is exported by
`e2e/global-setup.ts:20`).

Three gates cannot move because of a new file under `e2e/`, and it is worth
saying so once instead of leaving it to be re-derived: `.jscpd.json` has
`"path": ["src"]`, so the clone baseline cannot see the new spec;
`tsconfig.json:33` excludes `e2e/**` and `**/*.spec.ts`, so `tsc --noEmit`
never type-checks it; and `knip.json`'s `ignoreExportsUsedInFile` keeps the new
`uniqueFixtureName` helper out of `npm run lint:dead`'s unused-export report.

### What a playlist fixture costs

There is no SQL seed and no Server Action shortcut available from a spec: the
playlist is created through the UI that RH-63 built. `/playlists` renders
`+ New Playlist` (`src/components/playlists/PlaylistsView.tsx:96`), which opens
`role="dialog"` `aria-label="New Playlist"` holding `#modal-playlist-name` and a
`Create` button (`CreatePlaylistModal.tsx:144,176,220`); the resulting card is a
`role="button"` with `aria-label={`Open ${playlist.name}`}`
(`PlaylistCard.tsx:113`) whose click pushes `/playlists/<id>`
(`PlaylistsView.tsx:122`). Songs come from `addSong` on the home page, which
writes both `global_songs` and the user's repertoire with
`status DEFAULT 'unknown'` (`migrations/0001_initial_schema.sql:222`);
`searchGlobalSongs` is `title ILIKE '%q%' OR artist ILIKE '%q%'`
(`src/lib/songs.ts:178-195`), so a full unique title typed into the picker
matches exactly one catalog row.

The e2e browser context starts with no `localStorage`, so
`useBandContextStore((s) => s.bandId())` is `null` and the page is in personal
mode — which is the mode where the status badge is a button rather than the
read-only band span (page 1160-1178).

## Approach

### The net: one serial journey, eleven checkpoints

`e2e/playlist-detail.spec.ts`, `chromium` only, `test.use({ storageState: AUTH_STATE_PATH })`
and `test.describe.configure({ mode: 'serial', timeout: 90_000 })` (the timeout
for the same reason `bands-confirm.spec.ts` raises it: the first hit on a route
pays Turbopack's compile). Three module-level `let` bindings hold the fixture —
two song titles, one playlist name, the detail URL — and every one of them is
**computed inside the first test body**, never at module scope, exactly as
`uniqueSongTitle`'s doc comment requires; a retry restarts the serial group at
test 1 and mints fresh names.

Each test after the first starts with `page.goto(playlistUrl)`, so every
behaviour is verified against a freshly loaded page rather than against state
another test left in the DOM. That is what makes the file useful to part 6,
which changes how the page loads.

The eleven tests, in order, with what each asserts:

1. `creates a playlist and opens it from the playlists page` — mints the two
   song titles and the playlist name; `goHome` + `addSong` twice; `createPlaylist`;
   `openPlaylist`; asserts the URL matches `/playlists/<id>`, the `h1` carries
   the playlist name, and the body shows the `No songs yet` empty state. Records
   `playlistUrl`.
2. `adds two catalog songs to the playlist through the picker` — opens the
   picker with `Add songs`, types the first full title, clicks that picker row's
   `Add`, waits for the row to appear in the song list; repeats for the second;
   closes the picker; asserts the song list holds exactly two rows and that
   after a reload it still does (the add is persisted, not optimistic-only).
3. `cycles the mastery status of a playlist song` — asserts the first song's
   status button is named `Status: Unknown. Click to advance.`, clicks it,
   asserts it becomes `Status: Learning. Click to advance.`. `handleStatusCycle`
   (page 555-566) writes `setRepertoireMap` *before* awaiting
   `updateSongStatus`, so that first assertion proves nothing about persistence
   and a reload fired straight after it races the in-flight Server Action: the
   test therefore waits for the action's response
   (`page.waitForResponse` on the POST to the current URL) **before**
   `page.reload()`, then asserts the button is still `Learning`.
4. `adds a tag to a playlist song` — mints a lowercase unique tag, opens the
   row's `Add tag` affordance, types the tag, presses `Enter`; asserts the chip
   and its `Remove tag <tag>` button exist in that row, that the tag filter bar
   now offers a button named exactly `<tag>`, and that both survive a reload.
5. `filters the playlist by title text` — types the first song's title into the
   filter, asserts one row and that the second song is gone; types a string that
   matches nothing and asserts the `No songs matching "..."` message; clears the
   field with `fill('')` and asserts both rows return.
6. `filters the playlist by tag` — clicks the tag-filter button named after the
   tag from test 4, asserts only the tagged row remains and that the clear
   button appears; clicks the clear button and asserts both rows return and the
   clear button is gone.
7. `removes the tag from the playlist song` — clicks `Remove tag <tag>` in the
   row, asserts the chip is gone, the tag filter bar no longer offers it, and
   both hold after a reload.
8. `adds a tag to the playlist itself` — clicks `Add tag to playlist` **first**,
   then asserts `page.getByPlaceholder('new tag')` has `toHaveCount(1)`, i.e.
   the only open tag input on the page is the playlist-level one and no per-song
   input was left open (both inputs are conditionally rendered, so before the
   click the count is `0`; the assertion is only meaningful after it). Then
   types a second unique tag, presses `Enter`, asserts the playlist tag bar
   carries the chip and still does after a reload.
9. `renames the playlist inline` — clicks `Rename playlist`, fills the
   `Playlist name` textbox with the name plus a suffix, clicks `Save`, asserts
   the heading changed and survives a reload, and updates the module-level name
   so the teardown deletes the right card.
10. `removes a song from the playlist` — clicks
    `Remove <title> from playlist` for the second song, asserts one row is left
    and the removed title is gone after a reload.
11. `deletes the playlist and the seeded songs` — `Delete playlist`, then `Yes`,
    waits for `/playlists`, asserts the `Open <name>` card is gone; then
    `goHome` and `deleteSong` for both titles, asserting each card count is `0`.

Idempotency, RH-44 style: nothing is named by a constant, so a second
back-to-back run cannot collide with the first run's rows; test 11 is the
teardown, so a green run leaves no playlist and no repertoire row behind (the
`global_songs` catalog rows survive, exactly as `songs-crud.spec.ts` leaves
them, which is why the next run mints new titles). A run that dies in the middle
skips the teardown and leaks a playlist named after that run — harmless by
construction, and preferable to a best-effort `afterAll` that can turn a real
product failure into a cleanup error.

No `waitForTimeout` anywhere: the 500 ms picker debounce is absorbed by a
`toBeVisible({ timeout: 15_000 })` on the picker row. No `retries` and no
`test.setTimeout` beyond the one `describe.configure` above, and
`playwright.config.ts` is not touched.

**Assertion timeouts on cold routes.** `test.describe.configure({ timeout: 90_000 })`
raises the *test* timeout only; `playwright.config.ts:12` keeps
`expect: { timeout: 5_000 }` for every assertion. The detail route renders a
loading state until `refreshPlaylist` resolves and the first hit pays a
Turbopack compile, so the heading assertion inside `openPlaylist` and the first
assertion after each `page.goto(playlistUrl)` carry an explicit
`{ timeout: 15_000 }`, the value `server-pages.spec.ts:70` already uses for the
same reason.

### Locator contract

Every locator below already resolves at `a17dd2b`; the spec adds nothing to the
page to make one work. Parts 2-6 must keep these names alive when the markup
moves.

| What | Locator | Source |
|---|---|---|
| Playlist card on `/playlists` | `getByRole('button', { name: \`Open ${name}\` })` | `PlaylistCard.tsx:113` |
| Create modal | `getByRole('dialog', { name: 'New Playlist' })`, `#modal-playlist-name`, `getByRole('button', { name: 'Create' })` | `CreatePlaylistModal.tsx:144,176,220` |
| Playlist title | `getByRole('heading', { name })` | page 769 |
| Song list | `getByRole('region', { name: 'Songs in this playlist' })` | page 1057-1059 |
| One song row | that region's `getByRole('listitem').filter({ hasText: title })` | page 1083 |
| Picker toggle | `getByRole('button', { name: 'Add songs' })` | page 781 |
| Picker input | `getByPlaceholder('Search catalog and Spotify')` (substring) | page 1284 |
| Picker list | `locator('ul[aria-live="polite"]')` | page 1287-1290 |
| Picker row Add | that list's `getByRole('listitem').filter({ hasText: title }).getByRole('button', { name: 'Add', exact: true })` | page 128-135 |
| Status badge | row's `getByRole('button', { name: /^Status: / })` | page 1173 |
| Remove song | region's `getByRole('button', { name: \`Remove ${title} from playlist\` })` | page 1185 |
| Song tag add | row's `getByRole('button', { name: 'Add tag', exact: true })` | page 1262 |
| Song tag input | row's `getByPlaceholder('new tag')` | page 1252 |
| Remove a tag | scope's `getByRole('button', { name: \`Remove tag ${tag}\` })` | page 919 and 1219 |
| Playlist tag add | `getByRole('button', { name: 'Add tag to playlist' })` | page 962 |
| Playlist tag input | `getByPlaceholder('new tag')` at page level | page 952 |
| Text filter | `getByPlaceholder('Filter playlist by title or artist')` (substring: the real placeholder ends in `...`) | page 996 |
| Tag filter button | `getByRole('button', { name: tag, exact: true })` | page 1029-1042 |
| Tag filter clear | `getByRole('button', { name: 'clear' })` (substring) | page 1045-1051 |
| Rename | `getByRole('button', { name: 'Rename playlist' })`, `getByRole('textbox', { name: 'Playlist name' })`, `getByRole('button', { name: 'Save', exact: true })` | page 810, 749, 758 |
| Delete | `getByRole('button', { name: 'Delete playlist' })` then `getByRole('button', { name: 'Yes', exact: true })` | page 848, 834 |

Four ambiguities the spec resolves rather than papering over, each of which is
the reason a locator above carries `exact` or a scope:

- `Add tag` is a prefix of `Add tag to playlist`, so the per-song affordance is
  matched with `exact: true` **and** scoped to its row.
- The `new tag` placeholder is shared by the playlist-level input (page 952) and
  the per-song input (page 1252), and **both are conditionally rendered** —
  behind `addingPlaylistTag` and `addingTagForSong === ps.song_id`
  respectively — so at rest neither exists. The per-song case is row-scoped; the
  playlist-level case (test 8) clicks `Add tag to playlist` first and only then
  asserts `await expect(page.getByPlaceholder('new tag')).toHaveCount(1)`, so a
  regression that leaves a song input open fails loudly on that assertion
  instead of silently typing into the wrong field. Asserted before the click the
  count would be `0` and the test would fail deterministically; the order is
  click, then count, then type.
- `Remove tag <tag>` exists in both tag bars; both uses are scoped (row, or the
  playlist tag bar's chip) and the two tags minted by the run are different
  strings anyway.
- The tag chip inside a song row is a `span` whose only descendant button is
  named `Remove tag <tag>`, so `getByRole('button', { name: tag, exact: true })`
  can only be the tag-filter button.

The remove-tag buttons are `opacity-0 group-hover:opacity-100`. Playwright
treats an `opacity: 0` element with a bounding box as visible and clickable, so
no hover step is needed; this is stated here because it looks like a bug when a
reviewer reads the class list.

### New helpers in `e2e/helpers.ts`

Additive only; every existing export keeps its name and behaviour.

- `uniqueFixtureName(prefix)` — the body of today's `uniqueSongTitle`, promoted
  so playlist names and tags share the one counter.
  `uniqueSongTitle(prefix)` becomes a one-line delegation to it and keeps its
  doc comment, so `songs-crud.spec.ts` and `ssr-smoke.spec.ts` are untouched and
  unaffected.
- `createPlaylist(page, name)` — `/playlists`, the hydration-retry click on
  `+ New Playlist`, fill, `Create`, wait for the `Open <name>` card.
- `openPlaylist(page, name)` — clicks that card, `waitForURL(/\/playlists\/[^/]+$/)`,
  asserts the heading with `{ timeout: 15_000 }`, returns `page.url()`. Unlike
  `createPlaylist` it does **not** need the hydration-retry wrapper: it is only
  ever called immediately after `createPlaylist`, on a page that is already
  hydrated. A doc comment says so, so the asymmetry does not read as an
  oversight.
- `deletePlaylistFromDetail(page)` — `Delete playlist`, `Yes`,
  `waitForURL(/\/playlists$/)`.

Row-level locators (`songList`, `songRow`, `pickerRow`) stay in the spec file:
they describe one page, and `e2e/helpers.ts` is shared by every spec.

### The F13 edit

Three lines out, two lines in, on the page and nowhere else:

- line 277 (`const { data: session } = authClient.useSession();`) **stays as it
  is**, and a new line is inserted directly under it:
  `const currentUserId = session?.user?.id ?? null;`
- line 291 (the `useState` pair) is deleted
- line 343 (`setCurrentUserId(...)`) is deleted
- line 349's dependency list drops `session?.user?.id`, becoming
  `}, [playlistId, router, bandId]);`

This is the two-line shape the remediation asks for verbatim
(`docs/plans/code-quality-review.md:346`: "A one-line
`const currentUserId = session?.user?.id ?? null` is strictly better in every
dimension") and the shape RH-64 (`6aa099c`) already landed for the same finding
at `src/hooks/useBandAdmin.ts:126-127`. The value stays `string | null`, so the
ownership gate at 902 compares exactly what it compares today.
`git diff --numstat` for the page is `2` insertions and `3` deletions, nothing
else.

The collapsed alternative — `authClient.useSession().data?.user?.id ?? null` on
one line, dropping the `session` binding — was **rejected**. It measures the
same complexity (35, verified), so it buys no metric, and it would depart from
both the remediation's wording and the `useBandAdmin` precedent for style alone.

Measured on the edited file with the real config
(`rtk proxy npx eslint --stdin --stdin-filename 'src/app/playlists/[id]/page.tsx' --rule '{"complexity":["error",1],"max-lines":["error",1],"max-lines-per-function":["error",1]}'`),
the edit applied to a scratch copy only:

| | at `a17dd2b` | after |
|---|---|---|
| `max-lines` | 1344 | **1343** |
| `max-lines-per-function` (`PlaylistDetailPage`) | 1072 | **1071** |
| `complexity` (`PlaylistDetailPage`) | 34 | **35** |
| `complexity` (the `refreshPlaylist` arrow, at `335:48` both times) | 6 | **3** |
| `useState` in the file (`grep -c`) | 24 | **23** |

**The override's `complexity` ceiling goes up, 34 -> 35, and this task states it
in the open.** ESLint's `complexity` rule counts `?.` and `??` alike: the
component body loses the two optional chains that were in the `useCallback`
dependency list (`-2`) and gains the three in the new derived `const` (`+3`),
while `refreshPlaylist` loses all three (`6 -> 3`). The file's total branch
count falls; the outer function's own count rises by one because the coalescing
moved into it. Re-pinning is not optional and is not a loosening of the ratchet:
`src/lib/__tests__/complexityBudget.test.ts` fails on any ceiling that is not
*exactly* the file's current worst number, so leaving `34` in place while the
file measures `35` fails the guard. AGENTS.md:97's "may only shrink" is about
the **entry list**, and no entry is added or removed here —
`grep -c "complexity-budget/override" eslint.config.mjs` prints `20` before and
after. RH-67 takes this number down when the picker leaves the page.

Also rejected: writing `const currentUserId = session?.user?.id;` (no
`?? null`), which measures complexity `34` and would leave the ceiling
untouched. It buys the nicer number by changing the derived type from
`string | null` to `string | undefined` in the one task whose whole purpose is
to freeze behaviour before five refactors. Pinning a metric is not a reason to
change a value's type.

Verified on the scratch copy: with the three ceilings set to `35 / 1071 / 1343`
the edited file lints clean through the real config (exit `0`, no output at
all), which also proves the dependency-list edit leaves no
`react-hooks/exhaustive-deps` warning behind — the repo total stays at
`22 problems (8 errors, 14 warnings)`.

### The F13 `Status:` line

One line appended to the F13 block in `docs/plans/code-quality-review.md`,
immediately after its `**Remediation:**` line (the last line before
`### F14`), in the voice of the F14 and F15 `Status:` lines already there and
opening exactly the way every other one in the file does (lines 289, 307, 324,
341, 359, ...): `**Status:** Resolved by RH-66 (\`<sha>\`)`. It records: the
derived `const` on the line under the `session` binding and the deleted
`useState` pair; that the copy at 343 and its dependency entry went with it,
while the `session` binding itself stays because the derived `const` reads it;
the three re-pinned override numbers `35 / 1071 / 1343` with the plain statement
that the `complexity` ceiling went **up**, 34 -> 35, why (the coalescing moved
out of `refreshPlaylist` and into the component body), and that RH-67 takes it
back down; a clause noting that the T8 close-out further down the same file
(line 564, "F13 ... stays open ... owned end to end by RH-53 (F11)") describes
the state before this commit, so the next reader does not believe it; the new
e2e net as the thing that lets RH-67..RH-71 move this code safely; and the
sweep, quoted as the command
`grep -rn "useState" src/hooks src/app src/components | grep -v __tests__ | grep -iE "session|userid|currentuser"`
with its result — one line at `a17dd2b` (this page), none after, RH-64 having
already turned `useBandAdmin`'s copy into a derived `const` at `6aa099c`.

The RH-41 close-out paragraph further down the same file (the one saying F13
"stays open" and belongs to RH-53) is **not** edited: it records what RH-41's
scope was, not what F13's state is. The section-5 summary row for F13 is not
edited either; F11's row and `Status:` line belong to RH-71.

### Whitelist

Required:

```
docs/plans/code-quality-review.md
docs/tasks/RH-66-spec.md
e2e/helpers.ts
e2e/playlist-detail.spec.ts
eslint.config.mjs
package.json
src/app/playlists/[id]/page.tsx
```

Permitted but not required, and nothing else:

```
docs/suggestions-log.md
```

**Landing Page Rule decision.** A characterization test suite and a derived
constant are internal work: no capability a musician or band would choose the
app for. Playlists are already a landing selling point. The landing copy and
both dictionaries must not change, and ER8 asserts it mechanically.

**Version.** Bump `package.json` to `0.1.101-YYYYMMDDHHmm` with a real local
timestamp, from `0.1.100-202609100006`. The three-digit patch is not a
regression: `0.1.101 > 0.1.100` numerically, even though it sorts below as a
plain string.

## Expected Results

ER1 - The characterization net exists and is repeatable. A new file `e2e/playlist-detail.spec.ts` (absent at `a17dd2b`, where `ls e2e/playlist-detail.spec.ts` fails and `grep -rn "playlists/" e2e/*.ts` prints nothing) declares `test.use({ storageState: AUTH_STATE_PATH })` and `test.describe.configure({ mode: 'serial', timeout: 90_000 })` and contains exactly eleven tests, in this order and with these titles: `creates a playlist and opens it from the playlists page`, `adds two catalog songs to the playlist through the picker`, `cycles the mastery status of a playlist song`, `adds a tag to a playlist song`, `filters the playlist by title text`, `filters the playlist by tag`, `removes the tag from the playlist song`, `adds a tag to the playlist itself`, `renames the playlist inline`, `removes a song from the playlist`, `deletes the playlist and the seeded songs`. With Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied, a `.env.local` present and nothing listening on port 3000, `npx playwright test e2e/playlist-detail.spec.ts --workers=1 --reporter=list` exits 0 and prints `11 passed` with no `failed` and no `flaky` line; running the identical command a second time immediately afterwards, with no database cleanup in between, again exits 0 and prints `11 passed` (this is what proves the fixture names are minted per run and that test 11 cleans up after itself). `grep -c "waitForTimeout" e2e/playlist-detail.spec.ts` prints 0.

ER2 - The suite grew by exactly that file and nothing else moved. `npx playwright test --list` prints `Total: 33 tests in 7 files`; at `a17dd2b` the same command prints `Total: 22 tests in 6 files`. The new spec is listed under the `chromium` project only and never under `mobile`. `npx playwright test --workers=1 --reporter=list` exits 0 and prints `33 passed`, with no `failed` and no `flaky` line (`22 passed` at `a17dd2b`). `git diff a17dd2b -- e2e/auth.spec.ts e2e/bands-confirm.spec.ts e2e/fast-view-mobile.spec.ts e2e/server-pages.spec.ts e2e/songs-crud.spec.ts e2e/ssr-smoke.spec.ts e2e/global-setup.ts playwright.config.ts` prints nothing at all.

ER3 - The shared helper file grew additively and no existing caller had to change. `grep -n "^export" e2e/helpers.ts` lists, unchanged from `a17dd2b` in name and signature, `SongData`, `uniqueSongTitle`, `goHome`, `addSong`, `openEditDialog`, `editSong`, `deleteSong` and `songCard`, plus exactly four new exports: `uniqueFixtureName`, `createPlaylist`, `openPlaylist` and `deletePlaylistFromDetail`. `uniqueSongTitle(prefix)` still returns a unique title and is now a delegation to `uniqueFixtureName`, keeping the doc comment that forbids calling it at module scope. `git diff a17dd2b -- e2e/helpers.ts` shows no deleted export and no changed signature, and `npx playwright test e2e/songs-crud.spec.ts e2e/ssr-smoke.spec.ts --workers=1 --reporter=list` exits 0 with the same pass count as at `a17dd2b`.

ER4 - F13 is closed inside the page, as the two-line derived form. In `src/app/playlists/[id]/page.tsx`: `grep -c "setCurrentUserId" 'src/app/playlists/[id]/page.tsx'` prints 0 (it printed 2 at `a17dd2b`, at lines 291 and 343); the line `const { data: session } = authClient.useSession();` is still present and is immediately followed by `const currentUserId = session?.user?.id ?? null;`; the `useCallback` dependency list of `refreshPlaylist` reads `}, [playlistId, router, bandId]);` (it read `}, [playlistId, router, session?.user?.id, bandId]);` at `a17dd2b`); `grep -c "useState" 'src/app/playlists/[id]/page.tsx'` prints 23 (24 at `a17dd2b`) and `grep -c "" 'src/app/playlists/[id]/page.tsx'` prints 1343 (1344 at `a17dd2b`). `git diff --numstat a17dd2b -- 'src/app/playlists/[id]/page.tsx'` prints exactly one row for that single path, with `2` insertions and `3` deletions, so no other line of that 1344-line file moved. The sweep the remediation asks for now returns the empty set: `grep -rn "useState" src/hooks src/app src/components | grep -v __tests__ | grep -iE "session|userid|currentuser"` prints nothing at all, where at `a17dd2b` it printed exactly one line, `src/app/playlists/[id]/page.tsx:291`.

ER5 - The complexity budget entry states the file's real numbers and the guard is green. The `complexity-budget/override` entry for `src/app/playlists/[id]/page.tsx` in `eslint.config.mjs` reads `complexity: ["error", 35]`, `"max-lines-per-function": ["error", 1071]` and `"max-lines": ["error", 1343]`; at `a17dd2b` it read `34`, `1072` and `1344`. The `complexity` ceiling going up by one, 34 to 35, is expected and is the only number in this task that rises: the coalescing moves out of the `refreshPlaylist` callback (whose complexity falls 6 to 3) and into the component body, and `src/lib/__tests__/complexityBudget.test.ts` requires each ceiling to equal the file's current worst number exactly, so 34 would fail. `rtk proxy npx eslint 'src/app/playlists/[id]/page.tsx'` exits 0 printing nothing (as at `a17dd2b`). `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` exits 0 with no failed test. The list length is untouched: `grep -c "complexity-budget/override" eslint.config.mjs` prints 20 (20 at `a17dd2b`) and `grep -c "MAX_OVERRIDES = 20" src/lib/__tests__/complexityBudget.test.ts` prints 1, unchanged. No entry is added to that list and none is removed.

ER6 - The review document records F13 as resolved, with the sweep and the raised ceiling in writing. In `docs/plans/code-quality-review.md`, the `### F13` block gains exactly one line, placed immediately after its `**Remediation:**` line (which was the last line of the block before `### F14` at `a17dd2b`), beginning with the string `**Status:** Resolved by RH-66 (` followed by the commit sha, the same opening every other `Status:` line in that file uses. That line quotes the sweep command `grep -rn "useState" src/hooks src/app src/components | grep -v __tests__ | grep -iE "session|userid|currentuser"` with its result (one line at `a17dd2b`, this page; none after, RH-64 having already turned `useBandAdmin`'s copy into a derived `const` at `6aa099c`), names the three re-pinned numbers `35 / 1071 / 1343` and says plainly that the complexity ceiling rose from 34 to 35 and that RH-67 takes it back down, and contains a clause pointing at the T8 close-out at line 564 of the same file, which says F13 "stays open" and describes the state before this commit. `git diff --numstat a17dd2b -- docs/plans/code-quality-review.md` prints exactly one row for that path, with `1` insertion and `0` deletions: one line added, none removed, so neither the T8 close-out nor the section-5 summary rows were edited.

ER7 - Every repository gate holds at its `a17dd2b` value. With Postgres at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (migrations applied) and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`: `rtk proxy npx vitest run` exits 0 and prints `Test Files  108 passed (108)` and `Tests  1211 passed (1211)`, with no failed and no skipped entry, identical to `a17dd2b` (this task adds no unit test). `rtk proxy npx eslint .` prints `22 problems (8 errors, 14 warnings)`, identical to `a17dd2b`, so the deleted dependency entry left no `react-hooks/exhaustive-deps` warning behind. `./node_modules/.bin/tsc --noEmit` exits 0 printing nothing. `npm run lint:dead` exits 0 and knip prints nothing. None of these four numbers may move in either direction.

ER8 - Release hygiene and a closed change set. `git diff --name-only a17dd2b | sort` lists only paths drawn from this closed set and no others: `docs/plans/code-quality-review.md`, `docs/tasks/RH-66-spec.md`, `e2e/helpers.ts`, `e2e/playlist-detail.spec.ts`, `eslint.config.mjs`, `package.json`, `src/app/playlists/[id]/page.tsx`, and optionally `docs/suggestions-log.md`; any other path fails this result, and in particular no file under `src/` other than that one page is modified and no file is deleted. The `version` field of `package.json` is `0.1.101-YYYYMMDDHHmm` with a real local timestamp, up from `0.1.100-202609100006` at `a17dd2b`. `git diff a17dd2b -- src/components/landing src/i18n/dictionaries` prints nothing at all: the landing copy and both dictionaries did not move, because a characterization test suite and a derived constant add no capability a musician would choose the app for.

## Out of Scope

- Any extraction from `src/app/playlists/[id]/page.tsx` — the picker (RH-67),
  the song row and list (RH-68), `useTagEditor` (RH-69), the header, the Spotify
  sync, the focus effects and the panel reducer (RH-70), and the Server
  Component conversion that deletes the override entry (RH-71). This task adds
  one line to that file and deletes or rewrites three, and nothing else.
- Adding any `aria-label`, `data-testid`, `role` or class to the page to make a
  locator easier. The net must describe the page as it is; every locator above
  resolves at `a17dd2b`.
- The F11 `Status:` line, the section-5 summary rows and the `MAX_OVERRIDES`
  constant — all RH-71's.
- Deleting the `complexity-budget/override` entry or lowering the entry count
  below 20 — RH-71's, after the page stops needing it.
- Unit tests. `src/app/**/page.tsx` is outside the coverage universe by
  AGENTS.md:92, and there is nothing pure to extract here; the vitest totals
  therefore stay at `108` files / `1211` tests.
- The Spotify half of the picker. `handlePickerAddSpotify` depends on live
  Spotify credentials and on a track existing in the Spotify catalog, which no
  CI job can guarantee; the spec exercises the catalog path only and the Spotify
  path stays covered by manual QA (RH-67 covers its logic with unit tests when
  it moves into `src/lib`).
- Band mode. The read-only status badge at page 1160-1166 needs a band context
  in `localStorage`, i.e. a second fixture and a second user story; the net
  covers personal mode, which is the mode every one of the ten behaviours runs
  in today.
- The delete-playlist and remove-song **failure** paths, the error banner, the
  Spotify sync strip and the `Sure? / No` cancel branch.
- `playwright.config.ts` (no new project, no timeout change, no retry change),
  `e2e/global-setup.ts`, and the other six spec files.
- Fixing anything in the pre-existing `22 problems (8 errors, 14 warnings)`;
  none of them is in a file this task touches.
