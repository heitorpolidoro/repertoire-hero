# Code Quality Review - RH-25

A structural code-quality review of Repertoire Hero, pinned to commit `13da8b2`
(the tip after RH-24) and measured on 2026-09-05. Scope: good practice, SOLID,
DRY and KISS across `src/app`, `src/lib`, `src/components`, `src/hooks` and
`src/proxy.ts`.

This document is the whole deliverable of RH-25. It changes no source file. Its
26 findings and 10 proposed tasks are the backlog that the fixes will be drawn
from; nothing here is applied in this task.

## 1. Method and Reproducibility

Every claim below is traceable to a command anyone can re-run. This section
lists them verbatim; section 2 quotes their output at `13da8b2`.

**Environment preconditions.** Repository root, clean working tree at `13da8b2`,
`npm ci` already run. The test command additionally needs a live PostgreSQL at
`DATABASE_URL` (default `postgresql://postgres:postgres@127.0.0.1:54322/postgres`)
with `npm run db:migrate` applied, plus a non-empty `SUPABASE_SERVICE_ROLE_KEY`
in the environment or `.env.local`; without them six DB-backed files skip 51
tests. The "production file set" used throughout is the git-tracked `.ts`/`.tsx`
files under `src/` excluding `__tests__`.

**M1 - production file sizes**

```bash
git ls-files 'src/*' | grep -E '\.tsx?$' | grep -v '__tests__' | xargs wc -l | sort -rn
```

**M2 - cyclomatic complexity / depth / function length / arity**

ESLint's `complexity`, `max-depth`, `max-lines-per-function` and `max-params`
rules are not in `eslint.config.mjs`. They can be switched on from the CLI over
the project's existing flat config, so the TypeScript parser still resolves and
no config file has to be touched:

```bash
npx eslint 'src/**/*.ts' 'src/**/*.tsx' --rule '{"complexity":["warn",10],"max-depth":["warn",3],"max-lines-per-function":["warn",120],"max-params":["warn",4]}' -f json
```

Redirect its stdout to `/tmp/rh25-complexity.json` when running it, then
aggregate:

```bash
node -e "const r=require('/tmp/rh25-complexity.json');const R=['complexity','max-depth','max-lines-per-function','max-params'];const m=r.flatMap(f=>f.messages.filter(x=>R.includes(x.ruleId)).map(x=>({f:f.filePath.split('repertoire_hero/')[1],r:x.ruleId,l:x.line,msg:x.message})));const by={};m.forEach(x=>by[x.r]=(by[x.r]||0)+1);console.log(m.length,JSON.stringify(by));m.filter(x=>x.r==='complexity').sort((a,b)=>parseInt(/complexity of (\d+)/.exec(b.msg)[1])-parseInt(/complexity of (\d+)/.exec(a.msg)[1])).slice(0,15).forEach(x=>console.log(x.f+':'+x.l,x.msg))"
```

`npx eslint` exits non-zero here because of the 12 pre-existing errors. That is
expected and irrelevant; the JSON report is what is read.

**M3 - typing quality**

```bash
SRC=$(git ls-files 'src/*' | grep -E '\.tsx?$' | grep -v '__tests__')
for p in ': any' 'as any' 'as unknown as' '@ts-ignore' '@ts-expect-error'; do
  printf '%s\t%s\n' "$p" "$(echo "$SRC" | xargs grep -n -- "$p" | wc -l)"
done
echo "$SRC" | xargs grep -nE '[A-Za-z_$)\]]![.[]' | wc -l   # non-null assertions
```

**M4 - layering / dependency direction**

```bash
grep -rn "from '@/app" src/lib src/hooks src/components | grep -v __tests__
grep -c 'query(' src/app/actions/*.ts
grep -rn "from '@/components\|from '@/app" src/lib | grep -v __tests__
```

**M5 - Server Action session resolution**

```bash
for f in src/app/actions/*.ts; do
  echo "$f exports=$(grep -cE '^export (async )?(function|const)' "$f") requireCalls=$(grep -c 'getRequiredUserId()' "$f")"
done
```

**M6 - React surface**

```bash
for f in $(git ls-files 'src/**/*.tsx' | grep -v __tests__); do
  echo "$(grep -c 'useState' "$f") $(grep -c 'useEffect' "$f") $f"
done | sort -rn
```

**M7 - data access**

```bash
grep -rnE '\$\{[^}]+\}' src/lib/*.ts src/app/actions/*.ts | grep -iE 'select|insert|update|delete|from |where '
grep -rn -B3 'await ' src/lib/*.ts src/app/actions/*.ts | grep -E 'for \(|for await|\.map\(async'
grep -rln 'BEGIN' src --include='*.ts' | grep -v __tests__
```

**M8 - the existing static gates**

```bash
npx tsc --noEmit
npx vitest run
npx eslint .
npm run lint:dead
npm run lint:dup
```

## 2. Measured Baseline

All figures below were produced by re-running M1-M8 on a clean tree at
`13da8b2` on 2026-09-05.

### 2.1 Static gates - all clean, all must stay clean

| Gate | Command | Result at `13da8b2` |
|---|---|---|
| Types | `npx tsc --noEmit` | exit 0, no output |
| Tests | `npx vitest run` | 40 test files / 478 tests passed, 0 failed, 0 skipped |
| Lint | `npx eslint .` | 30 problems: 12 errors, 18 warnings (pre-existing; lint is not required to exit 0) |
| Dead code | `npm run lint:dead` | exit 0 |
| Duplication | `npm run lint:dup` | exit 0 - 19 clones, 239 duplicated lines (1.08%), threshold 2 |

### 2.2 Size (M1)

**79 production `.ts`/`.tsx` files outside `__tests__`, totalling 14661 lines.**
Top ten:

```
1586  src/app/songs/[id]/fast-view/page.tsx
1344  src/app/playlists/[id]/page.tsx
 899  src/app/playlists/page.tsx
 817  src/components/tabs/TabDrawingStage.tsx
 721  src/app/profile/page.tsx
 626  src/app/page.tsx
 575  src/components/songs/SongForm.tsx
 506  src/app/bands/[id]/page.tsx
 375  src/lib/songs.ts
 363  src/components/layout/AppLayout.tsx
```

The four largest are `src/app/songs/[id]/fast-view/page.tsx` at 1586 lines,
`src/app/playlists/[id]/page.tsx` at 1344, `src/app/playlists/page.tsx` at 899
and `src/components/tabs/TabDrawingStage.tsx` at 817. Roughly a third of the
production line count sits in four React components.

### 2.3 Complexity (M2)

**104 total rule violations**, broken down as **complexity 43,
max-lines-per-function 40, max-depth 19, max-params 2.**

Worst production offenders (test files excluded from this list):

```
src/app/songs/[id]/fast-view/page.tsx:92    FastViewPage        complexity 82
src/app/playlists/[id]/page.tsx:273         PlaylistDetailPage  complexity 34
src/app/bands/[id]/page.tsx:18              BandDetailPage      complexity 30
src/app/playlists/[id]/page.tsx:1076        (arrow)             complexity 29
src/app/api/spotify/playlists/[id]/sync/route.ts:19  POST       complexity 27
src/app/profile/page.tsx:33                 BandProfileView     complexity 23
src/components/layout/AppLayout.tsx:162     AppLayout           complexity 21
src/lib/moderation.ts:80    reviewGlobalSongEdit            complexity 21
src/lib/songs.ts:277        createAndAddSong                complexity 21
```

`FastViewPage` at `src/app/songs/[id]/fast-view/page.tsx:92`, with a cyclomatic
complexity of **82**, is the single worst function in the repository and the
headline number of this review. Behind it: `PlaylistDetailPage` at 34,
`BandDetailPage` at 30, the Spotify sync route `POST` handler at 27 and
`BandProfileView` at 23.

### 2.4 Typing (M3)

Over the 79 production files:

| Pattern | Occurrences |
|---|---|
| `: any` | 3 |
| `as any` | 1 |
| `as unknown as` | 3 |
| non-null assertions (`x!.` / `x![`) | 0 |
| `@ts-ignore` | 0 |
| `@ts-expect-error` | 0 |

This is genuinely good and worth saying plainly: there is no `any` epidemic and
no suppression-comment habit here. There are ~44 `as <Type>` structural casts,
most of them either the sanctioned E1 Postgres error-code form from AGENTS.md or
row-shape assertions on query results. The severity budget is spent elsewhere;
the two typing findings below (F16, F17) are about *where the casts come from*,
not about their count.

### 2.5 Layering and Server Action authorization (M4, M5)

`grep -c 'query(' src/app/actions/*.ts`:

| File | `query(` call sites |
|---|---|
| `src/app/actions/bands.ts` | 0 |
| `src/app/actions/moderation.ts` | 0 |
| `src/app/actions/playlists.ts` | 2 |
| `src/app/actions/profile.ts` | 0 |
| `src/app/actions/repertoire.ts` | 6 |
| `src/app/actions/tabs.ts` | 7 |

Inward dependencies from the component tree into the App Router tree
(`grep -rn "from '@/app" src/lib src/hooks src/components`): two, at
`src/components/tabs/TabDrawingStage.tsx:6` and
`src/components/layout/AppLayout.tsx:8`. The reverse direction is clean:
`src/lib` imports nothing from `@/app` or `@/components`.

Exported symbols vs. `getRequiredUserId()` call sites per action file:

| File | exports | `getRequiredUserId()` |
|---|---|---|
| `src/app/actions/bands.ts` | 11 | 5 |
| `src/app/actions/moderation.ts` | 3 | 3 |
| `src/app/actions/playlists.ts` | 9 | 4 |
| `src/app/actions/profile.ts` | 3 | 3 |
| `src/app/actions/repertoire.ts` | 14 | 2 |
| `src/app/actions/tabs.ts` | 5 | 5 |

The gap is not a false positive. `bands.ts` and `playlists.ts` really do export
mutations that never resolve a session (F1, F2), and `repertoire.ts` resolves one
through a shared helper that then discards it (F3). `moderation.ts`, `profile.ts`
and `tabs.ts` are clean: every export resolves a session, and `tabs.ts` follows it
with a row-level access check.

### 2.6 Data access (M7)

Three modules issue `BEGIN` - `src/lib/songs.ts`, `src/lib/profile.ts`,
`src/lib/moderation.ts` - all through the pool-level `query()` helper (F4).
Every `${...}` interpolation found inside a SQL string is either an owner-column
name chosen from a boolean (`isBand ? 'band_id = $2' : 'user_id = $2'`), a
`$${paramIndex}` placeholder number, or a `SET` clause list assembled from a
hard-coded column allow-list in `src/lib/sqlUpdate.ts`. **No user-controlled
value is concatenated into SQL anywhere in `src/lib` or `src/app/actions`** -
parameterisation discipline is sound, and no SQL-injection finding is raised.
Sequential `await` inside `for` loops appears at `src/lib/bands.ts:248` (a
bounded 3-attempt retry, fine) and `src/lib/spotifyPlaylistSync.ts:149` (an
unbounded per-member loop, F19).

## 3. Findings

Findings are ordered by severity: F1-F7 High, F8-F22 Medium, F23-F26 Low.

### F1 - deleteBandAction, updateBandAction and removeBandMemberAction perform no authorization

**Location:** `src/app/actions/bands.ts:38-61`, `src/lib/bands.ts:94-164`
**Why it matters:** A Server Action is a public POST endpoint reachable by anyone who can reach the page it is bound to. `deleteBandAction` calls `deleteBand(bandId)`, which runs `DELETE FROM bands WHERE id = $1`; `updateBandAction` and `removeBandMemberAction` are the same shape. Neither the action nor the `src/lib` function resolves a session or checks band membership, let alone the `admin` role. Any caller who learns or guesses a band id can destroy that band and every playlist and repertoire row cascading from it, and `removeBandMemberAction(memberId)` takes a `band_members` row id with no band scoping at all. The UI hides the buttons behind `isAdmin`, which is a client-side ornament. This also breaks the single-responsibility split the codebase otherwise keeps: `regenerateBandInviteCode` at `src/lib/bands.ts:226` proves the intended pattern - it takes a `userId`, reads the member row and rejects non-admins - and these three simply do not follow it.
**Severity:** High
**Effort:** M
**Remediation:** Resolve `getRequiredUserId()` in each action and pass it down to `deleteBand(bandId, userId)`, `updateBand(bandId, userId, data)` and `removeBandMember(memberId, userId)`, each of which must require an `admin` row in `band_members` for the owning band before mutating, throwing the same user-facing message shape `regenerateBandInviteCode` already uses. Scope `removeBandMember` by `(memberId, bandId)`. Add a regression test per action asserting a non-admin and an unauthenticated caller are both rejected.

### F2 - Playlist mutations are exported as Server Actions with no session and no ownership check

**Location:** `src/app/actions/playlists.ts:29-56`, `src/lib/playlists.ts:63-163`
**Why it matters:** `updatePlaylistAction`, `deletePlaylistAction`, `removeSongFromPlaylistAction` and `getPlaylistWithSongsAction` are four of the nine exports in that file and none of them calls `getRequiredUserId()`. `deletePlaylist(id)` is `DELETE FROM playlists WHERE id = $1` with no `user_id`/`band_id` predicate, so any caller can delete any playlist by id, and `getPlaylistWithSongsAction` leaks any playlist's full contents. The asymmetry inside the same file is the tell: `getUserPlaylistsAction`, `createPlaylistAction` and `addSongToPlaylistAction` do resolve a session, so the omission is an oversight rather than a deliberate public surface. Fail-open authorization spread across a layer boundary is exactly the defect that makes a codebase unsafe to change, because the next author reasonably assumes the layer already checks.
**Severity:** High
**Effort:** M
**Remediation:** Thread `userId` into all four and push the predicate into SQL: every playlist statement should carry `AND (user_id = $n OR band_id IN (SELECT band_id FROM band_members WHERE user_id = $n))`, returning a not-found error when `rowCount` is 0 so existence is not leaked either. Cover each with a test asserting a non-owner is rejected.

### F3 - resolveOwner trusts a client-supplied bandId, so every band repertoire action is cross-tenant

**Location:** `src/app/actions/repertoire.ts:21-24`
**Why it matters:** `resolveOwner` resolves the session and then throws the result away when a `bandId` is present: it returns `{ bandId }` without ever checking that the authenticated user is a member of that band. Eight exported actions funnel through it - `getRepertoireAction`, `addSongAction`, `updateSongStatusAction`, `updateSongTagsAction`, `removeSongAction`, `getSongEntryAction`, `updateSongAction`, `createAndAddSongAction` - and each takes `bandId` as a plain argument from the browser. Any authenticated user can therefore read, mutate and delete any band's shared repertoire by passing that band's id. This is the most leveraged authorization defect in the tree because a single four-line helper is the only thing standing between the session and eight mutations; it is also the cheapest to fix for the same reason. The measurement in section 2.5 reads `repertoire.ts` as 14 exports / 2 `getRequiredUserId()` call sites precisely because the check is centralised here and then incomplete.
**Severity:** High
**Effort:** S
**Remediation:** In `resolveOwner`, when `bandId` is supplied, verify membership with `SELECT 1 FROM band_members WHERE band_id = $1 AND user_id = $2` and throw `Access denied` otherwise (the message form `src/lib/moderation.ts` already establishes). Add tests for a member, a non-member and an unauthenticated caller.

### F4 - Transactions are opened on the pool, so BEGIN, the statements and COMMIT may run on different connections

**Location:** `src/lib/db.ts:23-25`, `src/lib/songs.ts:223-271`, `src/lib/profile.ts:73-79`, `src/lib/moderation.ts:159-181`
**Why it matters:** `query()` is `pool.query()`, which checks out an arbitrary idle connection per call and returns it immediately. `await query('BEGIN')` therefore starts a transaction on whichever connection it happened to get; the following `UPDATE` statements may be served by a different connection and are autocommitted; and `COMMIT`/`ROLLBACK` may land on a third. The three call sites that look transactional - `updateSong`, `updateEmail`, `reviewGlobalSongEdit` - are not atomic, which is a data-integrity risk in each: an approved moderation edit can update `global_songs` without marking `global_song_edits` reviewed, and `updateEmail` can rewrite the Better Auth `"user"` row without the matching `profiles` row. Worse, the connection that received `BEGIN` goes back to the pool *idle in transaction*, holding its locks and its snapshot until `idleTimeoutMillis` (30 s) reaps it; with `max: 10` a burst of these can exhaust the pool. The code reads as correct, which is why this survives review.
**Severity:** High
**Effort:** M
**Remediation:** Add `withTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T>` to `src/lib/db.ts` that does `pool.connect()`, `BEGIN`, runs `fn` with the checked-out client, `COMMIT`/`ROLLBACK`, and `client.release()` in a `finally`. Convert the three call sites to pass the client through, and forbid bare `BEGIN` through `query()`.

### F5 - The Spotify playlist route handlers never check that the caller owns the playlist

**Location:** `src/app/api/spotify/playlists/[id]/sync/route.ts:19-98`, `src/app/api/spotify/playlists/[id]/import/route.ts:25`, `src/app/api/spotify/playlists/[id]/tracks/route.ts`, `src/lib/spotifyRouteAuth.ts:18`
**Why it matters:** `resolveSpotifyRouteAccess()` answers "is there a session, and does that user have a Spotify token" - it deliberately says nothing about the playlist in the URL, and the routes never add that check. The sync handler then does `SELECT * FROM playlists WHERE id = $1` on the raw path parameter and, on a `pull`, runs `DELETE FROM playlist_songs WHERE playlist_id = $1` before re-inserting from Spotify. Any authenticated user with any Spotify connection can therefore point `POST /api/spotify/playlists/<someone-elses-id>/sync` at another user's or another band's playlist and overwrite its contents with their own Spotify data. It also reads `playlist.band_id` and writes into that band's repertoire via `ensureInRepertoire`, so the blast radius reaches every member's personal repertoire. The helper is well-factored; the gap is that authentication was mistaken for authorization at the point where the two were separated.
**Severity:** High
**Effort:** M
**Remediation:** Extend `resolveSpotifyRouteAccess` (or add a sibling `resolvePlaylistAccess(userId, playlistId)`) that loads the playlist and returns a 404 unless `user_id = userId` or `band_id` is one of the caller's bands, and make all three `[id]` routes go through it before any read or write. Add route-level tests for the non-owner case.

### F6 - FastViewPage is a single 1586-line client component with a cyclomatic complexity of 82

**Location:** `src/app/songs/[id]/fast-view/page.tsx:92`
**Why it matters:** One function holds 40 `useState` calls, 5 `useEffect` blocks and roughly 1300 lines of JSX, and it simultaneously owns: entry loading, band-vs-personal entry reconciliation, tab upload with destination choice, PDF stage mode with visual-viewport measurement and scroll-host locking, lyrics editing and auto-import, status cycling, link add/delete, playlist navigation with swipe gestures, and a drawer. Complexity 82 means there is no realistic path to reasoning about its states, and 40 pieces of `useState` in one closure means most bugs here will be state-coordination bugs that no type checker can see. It is also invisible to the RH-24 coverage gate by design (page components are outside `coverage.include`), so CI has nothing to say about it either - which is the honest reason a component reached 82 without anyone noticing. This single function is the largest obstacle to safe change in the repository.
**Severity:** High
**Effort:** L
**Remediation:** Extract in layers rather than all at once: first the pure decision logic into `src/lib` modules in the style `annotationMath.ts` and `stageInteraction.ts` already establish; then controller hooks (`useSongEntry`, `useTabUpload`, `useLyricsEditor`, `usePlaylistNav`, `useStageMode`) in `src/hooks`; then split the JSX into `src/components/fastview/*` presentational components taking props. Target no function over complexity 15 and no file over 400 lines, and unit-test the extracted `src/lib` modules as they land.
**Correction (RH-38):** Three numbers in the heading and rationale above need dating. The complexity of 82 was accurate at this document's pinned baseline `13da8b2` and had drifted to 88 by `c8665cd`, the commit the remediation branched from. The `1586-line` figure is the file's length, not the function's: `FastViewPage` itself measured 1495 lines at `13da8b2` and 1534 lines at `c8665cd`, where the file had reached 1625 lines. And the `40 useState calls, 5 useEffect blocks` counts were 39 and 4 at `13da8b2` (measured with `grep -o 'useState[<(]'` and `grep -o 'useEffect('`); they reached 40 and 5 only by `c8665cd`.
**Status:** Resolved by RH-48 (`a49a295`), RH-49 (`6b30ddb`), RH-50 (`bf0c97e`), RH-51 (`aaf9a21`) and RH-52 (`e985ba5`), in five vertical slices rather than the three horizontal layers proposed above; each slice still landed its own pure logic in `src/lib`, its controller in `src/hooks` and its markup in `src/components/fastview`. The page went 1625 lines / complexity 88 at `c8665cd`, then 1427/76, 1091/67, 964/54, 658/30, and finally 222 lines with `FastViewPage` at complexity 6 at `e985ba5`, where it holds no `useState`, no `useEffect` and no data access at all. At `e985ba5` the whole feature - the page, 27 components under `src/components/fastview`, the four `src/app/fastView*Actions.ts` files, seven hooks and nine `src/lib` modules - passes `complexity` 15, `max-lines-per-function` 200 and `max-depth` 4 with no file over 400 lines, and the sixteen new `src/lib` and `src/hooks` modules carry sixteen new unit-test files inside the RH-24 coverage gate.

### F7 - updateSongLinksAction rewrites the shared global catalog with no session and no moderation

**Location:** `src/app/actions/repertoire.ts:127-163`
**Why it matters:** The action takes an id, resolves it to a `global_songs` row and runs `UPDATE global_songs SET links = $1 WHERE id = $2`. It calls neither `getRequiredUserId()` nor `resolveOwner`, so it is an unauthenticated write to a wiki-style table shared by every user of the app - an anonymous caller can replace any song's link list with arbitrary URLs, which are then rendered as clickable links for everyone who has that song. It also side-steps the moderation queue that RH-15/RH-27 built for exactly this table (`submitGlobalSongEditAction` -> `global_song_edits` -> admin review), so the one field with the highest abuse potential is the one field that bypasses review. The polymorphic `repertoireIdOrSongId` parameter compounds it: the action accepts either kind of id, which is what removed the natural place to scope the write to an owner.
**Severity:** High
**Effort:** M
**Remediation:** Require a session, split the polymorphic parameter into two explicitly-named actions, and route catalog-level link changes through `submitGlobalSongEdit` so they land in the moderation queue like every other `global_songs` field; keep the direct write only for the repertoire-scoped case, predicated on the caller's ownership of that repertoire row. Add tests asserting an unauthenticated caller is rejected and that a catalog edit produces a pending `global_song_edits` row.

### F8 - Fifteen SQL statements live in the Server Action layer

**Location:** `src/app/actions/repertoire.ts:100-186`, `src/app/actions/tabs.ts:11-190`, `src/app/actions/playlists.ts:67-83`
**Why it matters:** AGENTS.md places all data access in `src/lib/*`, and the M4 count is 6 `query(` sites in `repertoire.ts`, 7 in `tabs.ts` and 2 in `playlists.ts`. The consequence is not stylistic. These statements are unreachable from `src/lib` tests, they duplicate ownership predicates that `src/lib/songs.ts` already expresses (`updateLyricsAction` re-derives the `band_id`/`user_id` branch by hand), and `tabs.ts` keeps its own `checkAccess` authorization helper - a good one - inside a `'use server'` file where nothing else can reuse it. The layer that should be a thin session-resolving adapter has become a second, partial data-access layer, which is the mechanism by which F1, F2 and F7 became possible: there is no single place where "a repertoire write is scoped to its owner" is stated once.
**Severity:** Medium
**Effort:** M
**Remediation:** Move each statement into the matching `src/lib` module (`updateLyrics` into `songs.ts`; the whole tab data-access set plus `checkAccess` into a new `src/lib/tabs.ts`; the playlist-entry query into `playlists.ts`), leaving the actions as session resolution plus delegation plus `revalidatePath`. The moved code then falls inside the RH-24 coverage universe automatically.
**Correction (RH-37):** The counts above were accurate at this document's pinned baseline `13da8b2` and had drifted before the remediation started. At `059d4c3`, the commit RH-45 branched from, the count was thirteen, not fifteen (`repertoire.ts` 5, `tabs.ts` 6, `playlists.ts` 2), and the `checkAccess` helper described above no longer existed: RH-34 had already replaced it with `assertRepertoireAccess` in `src/lib/songs.ts`, which every tab action already called, so no authorization helper had to be re-homed.
**Status:** Resolved by RH-45 (`a493731`). Every statement now lives in `src/lib` (`tabs.ts`, `songs.ts`, `playlists.ts`, `devProfiles.ts`) and the actions are session resolution plus delegation plus `revalidatePath`; at `201a090`, `grep -c "query(" src/app/actions/*.ts` prints `0` for all six files and `grep -rn "@/lib/db" src/app/actions/*.ts` prints nothing. Re-entry is blocked by `src/app/actions/__tests__/actionDataAccessGuard.test.ts`.

### F9 - The Spotify pull resync deletes every playlist row before re-inserting, outside a transaction

**Location:** `src/app/api/spotify/playlists/[id]/sync/route.ts:93-98`
**Why it matters:** A `pull` runs `DELETE FROM playlist_songs WHERE playlist_id = $1` and then, in a separate statement, bulk-inserts the Spotify ordering. Any failure between the two - a Postgres error, a serverless timeout, an invalid bulk insert - leaves the playlist permanently empty with no record of what it contained. Because the delete happens after a long sequence of network calls to Spotify and per-track upserts, the window is not theoretical. Destroy-then-rebuild is also the wrong shape for the stated intent ("re-order and sync to match Spotify exactly"): it churns every row's id on every sync, so anything that ever references a `playlist_songs` id breaks silently.
**Severity:** Medium
**Effort:** M
**Remediation:** Wrap the delete and the insert in the `withTransaction` helper from F4, or replace both with an upsert that sets `position` per `(playlist_id, song_id)` and deletes only the rows no longer present. Add a test that a failing insert leaves the original rows intact.

### F10 - The middleware session gate treats the root route as public and fails open on timeout

**Location:** `src/proxy.ts:3-39`
**Why it matters:** Three things compound. `pathname === '/'` is unconditionally public, but `/` is the dashboard and is also the URL that Server Actions bound to the dashboard POST to, so the middleware gate contributes nothing there - which is survivable only because actions are supposed to resolve their own session, and F1/F2/F7 show several do not. The session is resolved by `fetch`ing the app's own `/api/auth/get-session` over HTTP on every matched request, adding a full round trip (and a second Node cold start on serverless) to every navigation; the comment explains *why* it is not an import, but not why the result is never cached for the request. And the `catch` at line 28 treats any failure or 3-second timeout as unauthenticated, which is fail-safe for redirects but means a slow database turns the whole app into a redirect loop to `/login`. Middleware is the one place in the app where every request is observable, and here it is neither an authorization boundary nor a cheap one.
**Severity:** Medium
**Effort:** M
**Remediation:** State explicitly (in AGENTS.md and in the file) that `src/proxy.ts` is a redirect convenience and never an authorization boundary, so no action or route may rely on it. Narrow the matcher to the routes that actually need a redirect, and replace the self-`fetch` with a direct cookie/JWT validation or a request-scoped cache so a single navigation resolves the session once.

### F11 - PlaylistDetailPage is 1344 lines with complexity 34 and 24 useState calls

**Location:** `src/app/playlists/[id]/page.tsx:273`, `src/app/playlists/[id]/page.tsx:1076`
**Why it matters:** The second-worst function in the tree, and structurally the same failure as F6 at smaller scale: one component owns playlist loading, inline rename, tag editing for both the playlist and each song, a debounced dual-source (catalog + Spotify) add-song picker with per-row error state, Spotify sync, deletion confirmation and the entire rendering. A nested arrow inside it reaches complexity 29 on its own. Four separate `useEffect` blocks exist only to move focus into an input when a panel opens - a state change driving a DOM effect that belongs in the event handler that opened the panel. Twenty-four independent `useState` values with no reducer means every new feature adds another axis to a state space nobody can enumerate.
**Severity:** Medium
**Effort:** L
**Remediation:** Extract the add-song picker (query state, debounce, dual-source results, per-row errors) into `src/components/playlists/SongPicker.tsx` with its own hook; extract tag editing into a shared `useTagEditor`; collapse the four focus effects into the handlers that set the corresponding flag. Group the remaining panel flags into one `useReducer` over an explicit panel union.

### F12 - updateEmail rewrites the login identity with no verification and no validation

**Location:** `src/lib/profile.ts:70-83`, `src/app/actions/profile.ts:22-25`
**Why it matters:** The function updates the Better Auth `"user"` table and `profiles` directly, and its own comment records that this deliberately bypasses Better Auth's email-verification route. The action does resolve a session, so this is not the unauthenticated hole of F1 - the risk is different: a user can move their account onto an address they do not control, and nothing validates the string is even an email or checks it is unused before the write. Combined with F4 (this is one of the three fake transactions), a partial failure can leave the auth table and the profile table disagreeing about who the user is, which is the worst possible pair of rows to have diverge. The comment says "for admin use", but the only caller is a user-facing settings action.
**Severity:** Medium
**Effort:** M
**Remediation:** Route the user-facing path through Better Auth's `changeEmail` so the verification email is sent, and keep the direct write only behind a system-admin check (`checkSystemAdmin`, already in `src/lib/moderation.ts`). Validate format and uniqueness before writing, and run both updates inside the F4 transaction helper.

### F13 - The session is mirrored into component state instead of being derived

**Location:** `src/app/playlists/[id]/page.tsx:277`, `src/app/playlists/[id]/page.tsx:291`, `src/app/playlists/[id]/page.tsx:343`
**Why it matters:** The component already has the session from `authClient.useSession()` at line 277, then declares `const [currentUserId, setCurrentUserId] = useState<string | null>(null)` at 291 and copies `session?.user?.id` into it at 343, inside the data-loading callback. The copy is the only writer and there is exactly one reader. This is the canonical "derived state stored in state" anti-pattern: it adds a render cycle, it makes the value stale for the whole first paint (during which the ownership-dependent UI at line 902 is hidden from the actual owner), and it ties an identity value to the success of an unrelated network call. A one-line `const currentUserId = session?.user?.id ?? null` is strictly better in every dimension.
**Severity:** Medium
**Effort:** S
**Remediation:** Replace the state pair with a derived `const`. Sweep the other large pages for the same shape while doing it.

### F14 - useBandAdmin returns 39 members, ten of them raw state setters

**Location:** `src/hooks/useBandAdmin.ts:304-344`, `src/app/bands/[id]/page.tsx:18`, `src/app/profile/page.tsx:33`
**Why it matters:** The hook was extracted (in RH-23) to share the band-detail controller between `/bands/[id]` and the profile band tab, and that sharing is the right call. But its interface is the hook's entire internal state plus `setBand`, `setError`, `setEditing`, `setEditName`, `setEditDesc`, `setEditColor`, `setCopied`, `setShowNewPlaylist`, `setNewPlaylistName` and `setPendingAction`. Exposing setters instead of behaviour means the invariants the hook maintains are only maintained while callers behave, both consumers must destructure 30+ names to render anything, and the encapsulation the extraction was supposed to buy is given straight back. It is also why `BandDetailPage` and `BandProfileView` score complexity 30 and 23: they receive a bag of primitives and have to re-derive the meaning locally.
**Severity:** Medium
**Effort:** M
**Remediation:** Shrink the surface to data plus intent-named commands (`startEdit`, `changeName`, `saveEdit`, `cancelEdit`, `requestDelete`, `confirmPending`, `dismissPending`, `createPlaylist`), grouping the edit-modal fields into a single `editDraft` object with an `updateDraft(patch)`. Keep the two pages' markup separate as they are today.

### F15 - Twelve of fourteen pages are client components that fetch in useEffect

**Location:** `src/app/layout.tsx:12`, `src/app/page.tsx`, `src/app/playlists/page.tsx`, `src/app/bands/page.tsx`, `src/app/admin/moderation/page.tsx`
**Why it matters:** Only `src/app/join/[code]/page.tsx` and `src/app/songs/search/page.tsx` are Server Components; every other route is `'use client'` and loads its data from a `useEffect` calling a Server Action. The app is a Next.js 16 App Router application using almost none of the App Router: each navigation ships the page's JS, mounts it, renders a spinner, then makes a round trip that could have happened during the server render, and every one of those loading/error states is hand-written state (which is a large share of the `useState` counts behind F6 and F11). `export const dynamic = "force-dynamic"` in the root layout then disables static generation for the whole tree, including `/login`, `/signup` and the marketing landing page, none of which need per-request rendering. Server Actions are being used as a data-fetching RPC transport, which is the use they are least suited to.
**Severity:** Medium
**Effort:** L
**Remediation:** Convert page-level reads to Server Components that call `src/lib` directly and pass data as props to a smaller `'use client'` island, starting with the pages that only read (`/bands`, `/playlists`, `/admin/moderation`). Move `dynamic = "force-dynamic"` from the root layout down to the segments that need it, so the auth and landing routes can be static again. This is the change that makes F6 and F11 tractable, so sequence it alongside them.

### F16 - The query helper defaults its row type to any, so untyped rows fan out across the codebase

**Location:** `src/lib/db.ts:22-25`
**Why it matters:** `export async function query<T extends QueryResultRow = any>(text: string, params?: any[])` has an `any` default type argument, `any[]` parameters, and an inferred return type - and it carries an `eslint-disable` for the explicit-any rule. Practically no caller supplies `T`, so essentially every row in the application arrives as `any` and is then re-asserted at the use site (`res.rows as Band[]`, `rows[0] as RepertoireTab`, and ~44 such casts overall). Those casts are unchecked: the M3 counts in section 2.4 look excellent precisely because the weakness is concentrated in one signature rather than sprinkled around. A column rename in `migrations/` type-checks cleanly today and fails at runtime. `params?: any[]` additionally accepts any value where `unknown[]` would be both safe and sufficient.
**Severity:** Medium
**Effort:** M
**Remediation:** Change the signature to `query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>` with no default, so callers must name the row shape; declare row interfaces next to each SQL string in `src/lib` and drop the corresponding `as` assertions. Roll it out module by module - the compiler enumerates the work.
**Correction (RH-40):** The remediation above does not do what it says. `query<T extends QueryResultRow>` with no default types nothing: `@types/pg` declares `QueryResultRow` as `{ [column: string]: any }`, and when a type argument is omitted and cannot be inferred TypeScript falls back to the parameter's constraint, so rows stay `any`-valued and no caller is under any pressure to name `T`. Measured before the remediation started: that signature produces exactly one compiler error in the whole repository, against 29 errors across 10 files for the signature actually delivered, `export type DbRow = Record<string, unknown>` plus `query<T extends QueryResultRow = DbRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>`. Replacing the default is what has teeth; dropping it is cosmetic. The second half of the remediation was inverted too: `src/lib/songs.ts` sits at its RH-39 `max-lines` ceiling and cannot take even one import line, so the row interfaces live in one `src/lib/dbRows.ts` rather than next to each SQL string.
**Status:** Resolved by RH-54 (`f92c0f3`), RH-56 (`b293e82`), RH-57 (`9e37072`) and RH-58 (`55656fe`). `query()` and `Queryable.query()` default to `DbRow = Record<string, unknown>` with `params?: unknown[]` and an explicit `Promise<QueryResult<T>>`, and both `eslint-disable` comments are gone; every row-reading call site names its shape as a type argument (`query<never>` where no row is read), and the ten interfaces that are not already domain types live in `src/lib/dbRows.ts`. At `ca91de2` the untyped row-reading call sites are down from 80 at `246313f`, the commit this split branched from, to 0, and the DB-row cast inventory from 26 at `246313f` to 1; the survivor, `src/lib/spotify.ts:30`, is a cast on an HTTP JSON body rather than on a `QueryResult` row and is outside this finding. The one query call the finding does not cover is `src/lib/auth.ts:84`, an `INSERT ... ON CONFLICT DO NOTHING` issued on `pg`'s own `Pool.query` inside the Better Auth create hook, whose result is discarded so no column is ever read off it. Guarded by `src/lib/__tests__/dbRowTypes.test.ts`, and the convention is recorded in the `# Database Row Types` section of AGENTS.md.

### F17 - Moderation payload fields reach SQL without type narrowing

**Location:** `src/lib/moderation.ts:6-24`, `src/lib/moderation.ts:138-157`
**Why it matters:** `submitGlobalSongEdit` accepts `data: Record<string, unknown>` and stores it verbatim as `proposed_data`. On approval, `reviewGlobalSongEdit` narrows only three of the seven fields it applies: `title`, `artist` and `album` are checked with `typeof ... === 'string'` and sanitised, while `standard_key`, `cover_url`, `duration_seconds` and `links` are pushed into the parameter array on an `!== undefined` test alone. A submitted object, or a hand-crafted `global_song_edits` row, can therefore put a number in `standard_key`, an object in `cover_url`, or a non-numeric `duration_seconds` into the shared catalog - either failing with an opaque Postgres type error at approval time or writing nonsense that every user then sees. The inconsistency within one function is the smell: three fields were validated, four were not, and nothing marks the difference as intentional.
**Severity:** Medium
**Effort:** S
**Remediation:** Define a `GlobalSongEditPayload` type and one `parseGlobalSongEditPayload(data: unknown)` validator, call it in `submitGlobalSongEdit` (so bad input is rejected at submission) and again before the approval `UPDATE` (so historical rows are covered), and narrow every field the same way. Table-test the accept/reject cases.
**Status:** Resolved by RH-55 (`b024a87`). `src/lib/globalSongEditPayload.ts` exports `GlobalSongEditPayload` and one `parseGlobalSongEditPayload(data: unknown)` that validates all seven mutable `global_songs` columns with per-field messages and sanitises title and album through `songSanitizer`; `submitGlobalSongEdit` calls it before the INSERT so bad input never reaches the queue, and `reviewGlobalSongEdit` calls it again on `proposed_data` before the approval UPDATE, building its SET clause from the parsed payload, so a hand-crafted historical row is refused with the catalog row left untouched. The ad-hoc `typeof` block, the `!== undefined` pushes, the `any[]` and the `eslint-disable` are gone, and `moderation.ts` fell under the base complexity budget and lost its per-file override (24 entries down to 23). Covered by `src/lib/__tests__/globalSongEditPayload.test.ts` (17 table tests) and `src/lib/__tests__/moderationPayload.db.test.ts` (2 real-database tests).

### F18 - Playlist positions are computed with COUNT then INSERT, without a transaction or a constraint

**Location:** `src/lib/playlists.ts:113-149`
**Why it matters:** `addSongToPlaylist` runs `SELECT COUNT(*) ... WHERE playlist_id = $1`, adds one, and inserts that value as `position` - a read-modify-write across two round trips with nothing serialising them. Two concurrent adds to the same playlist both read the same count and both insert the same position, and the ordering the whole feature depends on becomes ambiguous. The same function also performs up to five statements (repertoire existence checks and inserts for the band and the caller, the count, the insert) with no transaction, so a failure part way through leaves the song in a repertoire but not in the playlist. It duplicates, in a third place, the repertoire-ensuring logic that `src/lib/spotifyPlaylistSync.ts` also implements.
**Severity:** Medium
**Effort:** M
**Remediation:** Compute the position in SQL - `INSERT ... SELECT $1, $2, COALESCE(MAX(position), 0) + 1 FROM playlist_songs WHERE playlist_id = $1` - and back it with a `UNIQUE (playlist_id, position)` constraint in a new migration so a race fails loudly instead of corrupting order. Run the whole function through the F4 transaction helper.

### F19 - ensureInRepertoire issues two queries per band member per track

**Location:** `src/lib/spotifyPlaylistSync.ts:131-170`, `src/app/api/spotify/playlists/[id]/sync/route.ts:71-78`
**Why it matters:** For a band playlist, `ensureInRepertoire` loops over every band member and runs a `SELECT` and possibly an `INSERT` for each. It is called once per Spotify track, inside another sequential `await` loop in the sync route, which itself also calls `findOrCreateGlobalSong` per track. A 100-track sync for a 5-member band is on the order of 1000+ sequential round trips, all on a pool capped at 10 connections, inside a serverless request. Beyond latency, the read-then-insert shape is a race that the code already knows about - it catches `23505` at each of the three insert sites - which is an admission that the check-then-act was never sound.
**Severity:** Medium
**Effort:** M
**Remediation:** Replace the per-member loop with one set-based statement: `INSERT INTO repertoire (user_id, song_id, status) SELECT user_id, $1, 'unknown' FROM band_members WHERE band_id = $2 ON CONFLICT DO NOTHING`, and the same for the band row. Batch `findOrCreateGlobalSong` across the track list rather than calling it in a sequential loop.

### F20 - The complexity budget exists only as an ad-hoc CLI invocation, so 104 violations are invisible to CI

**Location:** `eslint.config.mjs`, `.github/workflows`, `package.json`
**Why it matters:** The M2 sweep in section 2.3 works, is cheap, and reports 104 violations including a function at complexity 82 - but it only runs when somebody types it, because `complexity`, `max-depth`, `max-lines-per-function` and `max-params` are not in `eslint.config.mjs`. Every other quality dimension in this project is mechanically defended: knip for dead code, jscpd at threshold 2 for duplication, a four-metric coverage gate, and a vitest guard for error-handling style. Size and complexity are the one dimension with no ratchet, and they are the dimension that has actually degraded. Without a gate, F6 and F11 will be re-created by the next large feature even after they are fixed.
**Severity:** Medium
**Effort:** S
**Remediation:** Add the four rules to `eslint.config.mjs` as errors at thresholds the tree can pass today (they will need per-file overrides for the known offenders, listed with their current numbers), plus `max-lines` for files. Ratchet the thresholds down as F6, F11 and F15 land, and keep the override list shrinking rather than growing.

### F21 - Presentational components import Server Actions from the App Router tree

**Location:** `src/components/tabs/TabDrawingStage.tsx:6`, `src/components/layout/AppLayout.tsx:8`
**Why it matters:** The two inward dependencies found by M4. `src/components` is otherwise a leaf that depends only on `src/lib`, `src/hooks` and `src/types`, and `src/lib` is completely clean in the other direction. These two imports invert that: an 817-line drawing surface and the app shell each reach up into `@/app/actions/*` to fetch their own data, which makes them untestable without mocking the action module, unusable in any other context, and coupled to the route tree they happen to be rendered from. `AppLayout` calling `getBandsAction` is the more consequential of the two, because it means the chrome performs its own network fetch on every mount independently of whatever the page is already loading.
**Severity:** Medium
**Effort:** S
**Remediation:** Invert both: have the parent (the page or a hook it owns) fetch and pass `annotations`/`onSaveAnnotations` and `bands` down as props, leaving the components pure. Once done, add an ESLint `no-restricted-imports` rule banning `@/app/*` from `src/components`, `src/lib` and `src/hooks` so the direction is enforced rather than remembered.
**Correction (RH-37):** There were five inward dependencies, not two. The M4 command quoted in section 2.5 greps for `from '@/app` with a single quote, so it missed the double-quoted imports at `src/components/songs/SongForm.tsx:16`, `src/components/songs/CorrectionModal.tsx:5` and `src/hooks/useBandAdmin.ts:11`, all three of which were already present at `13da8b2`.
**Status:** Resolved by RH-46 (`51151d7`) and RH-47 (`201a090`). All five now receive their server calls as props or as one injected actions object, and at `201a090`, `grep -rn "@/app/" src/components src/lib src/hooks | grep -v __tests__` prints nothing. The rule this remediation asks for is the `no-restricted-imports` block in `eslint.config.mjs`, banning `@/app/*` and `@/app/**` under `src/components/**`, `src/lib/**` and `src/hooks/**` with `**/__tests__/**` exempt.

### F22 - A route handler opens its own Postgres client instead of using the shared pool

**Location:** `src/app/api/dev/profiles/route.ts:19-33`
**Why it matters:** Every other database access in the application goes through the single `Pool` in `src/lib/db.ts`, which exists so connection count, timeouts and the dev-mode global are managed in one place. This route constructs `new Client({ connectionString: process.env.DATABASE_URL })` per request and re-reads the env var directly, ignoring the `BETTER_AUTH_DATABASE_URL` fallback that `db.ts` implements - so it can fail while the rest of the app works. It is also the only place that queries a table (`"user"`) directly from a route handler rather than through `src/lib`. It is development-only and guarded by a `NODE_ENV` check, which caps the severity, but it is precisely the kind of exception that later gets copied into a non-dev route.
**Severity:** Medium
**Effort:** S
**Remediation:** Use `query()` from `src/lib/db.ts` and move the statement into a `src/lib` function (e.g. `listDevProfiles()`), keeping the `NODE_ENV` guard in the route. If a separate connection is genuinely wanted so dev tooling cannot exhaust the app pool, say so in a comment at the call site.
**Status:** Resolved by RH-45 (`a493731`). The route now calls `listDevProfiles()` from `src/lib/devProfiles.ts`, which uses the shared pool through `query()`, and keeps its `NODE_ENV` 404 guard; at `201a090`, `grep -rln "new Client" src` prints nothing.

### F23 - src/lib is split between two export styles, with one module the outlier

**Location:** `src/lib/bands.ts:6`, `src/lib/songs.ts`, `src/lib/playlists.ts`, `src/lib/moderation.ts`
**Why it matters:** Twenty-two modules under `src/lib` declare their API with `export function` / `export async function`. One - `bands.ts` - uses `export const name = async (...) => {}` for all twelve of its exports. Nothing breaks, but it is a 1-in-23 inconsistency in the most-read directory of the project, it costs hoisting and slightly worse stack traces, and it is exactly the kind of drift that makes a codebase feel like it has several authors and no rule. AGENTS.md documents error-handling conventions in detail and says nothing about this.
**Severity:** Low
**Effort:** S
**Remediation:** Convert `src/lib/bands.ts` to `export async function` and record the convention in AGENTS.md next to the error-handling section. A mechanical change with no behaviour impact.

### F24 - The bands module split and its Client/Server suffixes do not mean what they say

**Location:** `src/lib/bands.ts:211`, `src/lib/bands.server.ts:36`, `src/app/join/[code]/page.tsx:6-8`
**Why it matters:** AGENTS.md describes `bands.ts` / `bands.server.ts` as the "client-safe + server-only halves", but `bands.ts` imports `query` from `@/lib/db` at module scope, so it pulls `pg` in exactly like the `.server` half - neither is client-safe and the suffix promises an isolation that does not exist. Inside that, `joinBandByInviteClient` (in the supposedly client half) and `joinBandByInviteServer` (in the server half) both call the same `join_band_by_invite($1, $2)` SQL function and differ only in the shape they return; the `Client`/`Server` suffixes describe neither the runtime nor the behaviour. A reader trying to decide which one to call has no correct rule to apply, and a future author may reasonably import the "client-safe" module into a `'use client'` file and break the build in a confusing way.
**Severity:** Low
**Effort:** S
**Remediation:** Either merge the two modules and name the functions for what they return (`joinBandByInvite` returning the richer `JoinBandResult`, with the thin variant deleted), or make `bands.ts` genuinely dependency-free and move all `pg` access into `bands.server.ts`. Update the AGENTS.md directory description to match whichever is chosen.

### F25 - The i18n dictionary reaches 2 of 29 components

**Location:** `src/lib/i18n.ts`, `src/components/landing/LandingPage.tsx`, `src/components/layout/LanguageSelector.tsx`, `src/i18n/dictionaries/en.json`

**Why it matters:** An i18n layer exists, with `en` and `pt-BR` dictionaries and a language selector, but only the landing page and the selector itself consume it. The other 27 `.tsx` files hardcode English strings, including user-visible error text assembled in `src/lib` (`Failed to fetch bands: ...`) and every label in the four largest pages. The result is a language switcher that visibly changes only the marketing page - a worse experience than having none - and a growing pile of literals that any real localisation effort will have to extract later at much higher cost. Flagged Low because it is a product decision as much as a code one; the point is that the current half-state is the most expensive of the three options.
**Severity:** Low
**Effort:** L
**Remediation:** Decide explicitly, and record the decision in AGENTS.md: either scope i18n to the landing page and say so (and hide the selector elsewhere), or adopt it app-wide and extract strings page by page starting with the shared chrome. Do not leave it ambiguous.

### F26 - Route state is read from window.location instead of the router, and one action is a pure alias

**Location:** `src/app/songs/[id]/fast-view/page.tsx:259-260`, `src/app/songs/[id]/fast-view/page.tsx:298-299`, `src/app/actions/playlists.ts:98-104`
**Why it matters:** The Fast View page reads `bandId` and `returnTo` by constructing `new URLSearchParams(window.location.search)` inside its load effect, twice, rather than using `useSearchParams()`. Because the effect depends only on `[id]`, a client-side navigation that changes the query string without changing the route param leaves the page showing the previous context's data, and the `typeof window !== 'undefined'` guards it forces are noise in a `'use client'` file. Separately, `getPlaylistEntryIdsAction` is a `'use server'` export whose entire body is `(await getPlaylistDetailsWithEntriesAction(...)).entries` - a redundant public POST endpoint that widens the action surface for no behavioural gain.
**Severity:** Low
**Effort:** S
**Remediation:** Use `useSearchParams()` and include the values in the effect's dependency array so a context change refetches. Delete `getPlaylistEntryIdsAction` and have its two callers read `.entries` from `getPlaylistDetailsWithEntriesAction`.
**Status:** Resolved by RH-48 (`a49a295`) and RH-52 (`e985ba5`). RH-48 replaced the navigation and back-button reads with `useSearchParams()` and deleted `getPlaylistEntryIdsAction`, whose two callers now read `.entries` from `getPlaylistDetailsWithEntriesAction`; RH-52 moved the load-effect reads into `src/hooks/useSongEntry.ts`, whose effect dependency array carries the search-params-derived band id, so a query-string-only navigation refetches. At `e985ba5`, `grep -c "window.location" "src/app/songs/[id]/fast-view/page.tsx"` prints `0` where it printed `4` at `c8665cd`, and `grep -rn "getPlaylistEntryIdsAction" src` prints nothing.

**On the three probes RH-25 was required to reach a conclusion about:**
`deleteBandAction`, `updateBandAction` and `removeBandMemberAction` are all
findings - they are the subject of F1, and none of them is a false positive. Each
was read in full at `src/app/actions/bands.ts:38-61` together with its `src/lib`
counterpart, and confirmed to resolve no session and check no membership or role.

## 4. Prioritised Summary

| Rank | ID | Area | Severity | Effort | Finding |
|---|---|---|---|---|---|
| 1 | F1 | Security | High | M | deleteBandAction, updateBandAction and removeBandMemberAction perform no authorization |
| 2 | F2 | Security | High | M | Playlist mutations exported as Server Actions with no session or ownership check |
| 3 | F3 | Security | High | S | resolveOwner trusts a client-supplied bandId across eight repertoire actions |
| 4 | F4 | Data access | High | M | BEGIN/COMMIT issued on the pool, so transactions are not transactions |
| 5 | F5 | Security | High | M | Spotify playlist route handlers never check playlist ownership |
| 6 | F6 | Complexity | High | L | FastViewPage is 1586 lines with a cyclomatic complexity of 82 |
| 7 | F7 | Security | High | M | updateSongLinksAction rewrites the shared catalog unauthenticated and unmoderated |
| 8 | F8 | Module boundaries | Medium | M | Fifteen SQL statements live in the Server Action layer |
| 9 | F9 | Data access | Medium | M | Spotify pull resync deletes all playlist rows before re-inserting, outside a transaction |
| 10 | F10 | Next.js patterns | Medium | M | Middleware session gate treats the root route as public and fails open on timeout |
| 11 | F11 | Complexity | Medium | L | PlaylistDetailPage is 1344 lines with complexity 34 and 24 useState calls |
| 12 | F12 | Security | Medium | M | updateEmail rewrites the login identity with no verification or validation |
| 13 | F13 | React patterns | Medium | S | The session is mirrored into component state instead of being derived |
| 14 | F14 | React patterns | Medium | M | useBandAdmin returns 39 members, ten of them raw state setters |
| 15 | F15 | Next.js patterns | Medium | L | Twelve of fourteen pages are client components fetching in useEffect |
| 16 | F16 | Typing | Medium | M | The query helper defaults its row type to any |
| 17 | F17 | Typing | Medium | S | Moderation payload fields reach SQL without type narrowing |
| 18 | F18 | Data access | Medium | M | Playlist positions computed with COUNT then INSERT, without transaction or constraint |
| 19 | F19 | Data access | Medium | M | ensureInRepertoire issues two queries per band member per track |
| 20 | F20 | Complexity | Medium | S | The complexity budget exists only as an ad-hoc CLI invocation |
| 21 | F21 | Module boundaries | Medium | S | Presentational components import Server Actions from the App Router tree |
| 22 | F22 | Module boundaries | Medium | S | A route handler opens its own Postgres client instead of using the shared pool |
| 23 | F23 | Naming & consistency | Low | S | src/lib is split between two export styles, with one module the outlier |
| 24 | F24 | Naming & consistency | Low | S | The bands module split and its Client/Server suffixes do not mean what they say |
| 25 | F25 | Naming & consistency | Low | L | The i18n dictionary reaches 2 of 29 components |
| 26 | F26 | Next.js patterns | Low | S | Route state read from window.location; one Server Action is a pure alias |

## 5. Proposed Follow-up Tasks

Ten task proposals, ready for `meridian:new`. RH-25 proposes only; the operator
decides which are created. Nothing here duplicates RH-21 through RH-24: none of
these tasks is about adding tests, removing dead code, de-duplicating clones or
changing error-handling style, though each carries its own regression tests as
implementation detail.

### T1 - Fail-closed authorization on every Server Action

**Justification:** Server Actions are public POST endpoints, and six band, playlist and catalog mutations currently resolve no session or no ownership, so any caller can delete a band, delete a playlist, mutate another band's repertoire or rewrite the shared song catalog.
**Priority:** critical
**Covers:** F1, F2, F3, F7

### T2 - Authorize the Spotify playlist route handlers against the caller's playlists

**Justification:** The `/api/spotify/playlists/[id]/*` handlers authenticate the caller but never check that the playlist in the path belongs to them, so a destructive pull resync can be pointed at any playlist in the database.
**Priority:** critical
**Covers:** F5

### T3 - Introduce a real transaction helper and make multi-statement writes atomic

**Justification:** `BEGIN`/`COMMIT` are issued through the pool-level `query()` helper, so the three "transactional" code paths are not atomic and leak connections idle in transaction; the same absence makes the playlist resync and position assignment corruptible.
**Priority:** high
**Covers:** F4, F9, F18, F19

### T4 - Move data access out of the Server Action layer into src/lib

**Justification:** Fifteen SQL statements live in `src/app/actions/*`, restating ownership predicates the domain layer already owns and hiding an authorization helper inside a `'use server'` file; the same inversion has presentational components reaching up into the App Router tree and a route handler opening its own database client.
**Priority:** high
**Covers:** F8, F21, F22
**Status:** Delivered by RH-45 (`a493731`), RH-46 (`51151d7`) and RH-47 (`201a090`); integrated and verified by RH-37. All three findings it covers are closed.

### T5 - Decompose the Fast View page

**Justification:** A single 1586-line component with cyclomatic complexity 82 and 40 `useState` calls is the largest obstacle to safe change in the repository and is invisible to every existing CI gate.
**Priority:** high
**Covers:** F6, F26
**Status:** Delivered by RH-48 (`a49a295`), RH-49 (`6b30ddb`), RH-50 (`bf0c97e`), RH-51 (`aaf9a21`) and RH-52 (`e985ba5`); integrated and verified by RH-38. Both findings it covers are closed.

### T6 - Enforce complexity, depth and size budgets in eslint.config.mjs

**Justification:** The complexity sweep that found 104 violations runs only when a human types it; every other quality dimension in this project has a mechanical ratchet in CI and this one does not, so the largest components will simply be re-created after they are fixed.
**Priority:** medium
**Covers:** F11, F20

### T7 - Type the query helper and validate the moderation payload

**Justification:** `query()` defaults its row type to `any`, so essentially every database row enters the application untyped and is re-asserted with an unchecked cast at the use site; the moderation approval path narrows only three of the seven fields it writes into the shared catalog.
**Priority:** medium
**Covers:** F16, F17
**Status:** Delivered by RH-54 (`f92c0f3`), RH-55 (`b024a87`), RH-56 (`b293e82`), RH-57 (`9e37072`) and RH-58 (`55656fe`); integrated and verified by RH-40. Both findings it covers are closed.

### T8 - Load page data in Server Components and slim the client controllers

**Justification:** Twelve of fourteen routes are client components fetching through Server Actions in `useEffect`, which forgoes the App Router's data model, forces every loading state to be hand-written, keeps `force-dynamic` on the whole tree and leaves the shared band controller exposing 39 members including ten raw setters.
**Priority:** medium
**Covers:** F10, F13, F14, F15

### T9 - Require verification for email changes

**Justification:** `updateEmail` writes the Better Auth `"user"` row and the profile row directly, deliberately bypassing email verification and validating neither format nor uniqueness, so a user can move their login identity to an address they do not control.
**Priority:** high
**Covers:** F12

### T10 - Settle the naming, module-split and i18n conventions in AGENTS.md

**Justification:** One `src/lib` module out of twenty-three uses a different export style, the `bands.ts` / `bands.server.ts` "client-safe" split does not hold and its `Client`/`Server` function suffixes describe nothing, and the i18n dictionary reaches 2 of 29 components so the language switcher only changes the landing page.
**Priority:** low
**Covers:** F23, F24, F25

## 6. Already Addressed - Not Re-Litigated

These five tasks already solved their problem classes, and this review
deliberately does not re-open any of them. A finding that restated one of them
would be noise, so none is raised; where the subject matter is relevant it
appears only as context.

- **RH-21 - error-handling conventions.** Documented in the AGENTS.md "Error
  Handling Conventions" section (L1, L1a, A1, A2, R1, P1, S1, E1) and enforced by
  `src/lib/__tests__/errorHandlingStyle.test.ts`. This review raises no finding
  about `catch` shape, `console.error` versus `logger`, or thrown-message format.
- **RH-22 - dead code.** Removed, with `npm run lint:dead` (knip) enforced in CI
  and exiting 0 at `13da8b2`. No finding here proposes removing an unused export.
- **RH-23 - duplication.** 22 clones de-duplicated into shared modules
  (`useToast`, `AlertBanner`, `useBandAdmin`, `bandAdminLoad`, `spotifyRouteAuth`,
  `sqlUpdate`); jscpd holds at 19 clones / 239 duplicated lines / 1.08% against a
  threshold of 2. No finding proposes extracting a clone. Where repeated logic is
  mentioned (F18, F19) the point is atomicity and query count, not DRY.
- **RH-24 - test coverage.** The coverage gate (statements 80, branches 65,
  functions 78, lines 80 over `src/lib`, `src/app/actions`, `src/hooks` and
  `src/proxy.ts`) plus jsdom component tests. No task in section 5 is "add tests".
  The gate is cited once, in F6, only to explain *why* an 82-complexity page
  component is invisible to CI: page components are deliberately outside
  `coverage.include`.
- **RH-32 - SSR React duplication.** Fixed by removing `better-auth` from
  `serverExternalPackages` in `next.config.ts`, enforced by
  `src/lib/__tests__/serverExternalPackages.test.ts`. This review makes no
  proposal touching `serverExternalPackages`.

## 7. Out of Scope

- **Fixing anything this report finds**, including the F1/F2/F3/F5/F7
  authorization holes. They are severe, and they become critical-priority
  follow-up tasks (T1, T2) with their own specs, regression tests and QA passes.
  A security fix smuggled into a review task gets neither.
- **Creating the follow-up Meridian tasks.** Section 5 proposes them; the
  operator decides which are created.
- **Any change under `src/`, `e2e/`, `migrations/` or `scripts/`, and any config
  file** (`eslint.config.mjs`, `vitest.config.ts`, `.jscpd.json`, `knip.json`,
  `next.config.ts`, `tsconfig.json`, `.github/workflows/**`). The complexity sweep
  in section 1 is run from the CLI precisely so that no config file has to be
  touched; making it permanent is T6's job, not RH-25's.
- **The 12 pre-existing eslint errors and 18 warnings.** They are recorded as
  the baseline in section 2.1 and left exactly as found.
- **A full threat model.** This review records the authorization smells that M5
  and the route-handler reads surfaced. `docs/security-audit.md` remains the
  security document and is not modified here.
- **The landing page.** RH-25 ships no user-facing feature - an internal
  code-quality review is not something a musician or a band would choose the app
  for - so under the AGENTS.md Landing Page Rule the landing page is untouched.
  `src/components/landing/LandingPage.tsx` and the `landing.*` keys in
  `src/i18n/dictionaries/en.json` and `src/i18n/dictionaries/pt-BR.json` are
  unchanged. (F25 observes that i18n reaches almost nothing *else*; it proposes
  no change to the landing copy.)
- **`docs/plans/mobile-app-analysis.md`, `docs/security-audit.md` and
  `docs/test-coverage-plan.md`**, none of which is modified.

---

*Snapshot pinned to `13da8b2`, 2026-09-05. Re-run M1-M8 before treating any
number above as current.*
