# RH-45 - Mover SQL das Server Actions para src/lib e usar o pool compartilhado na rota dev

Parent: RH-37 (part 1 of 3). Findings: RH-25 T4 F8 (SQL in the Server Action
layer) and F22 (a route handler opening its own Postgres client). Baseline:
`059d4c3`.

## Scope

This task moves every SQL statement that currently lives in
`src/app/actions/*.ts` into `src/lib`, and puts `src/app/api/dev/profiles/route.ts`
on the shared pool. Concretely:

- a new `src/lib/tabs.ts` owning all six `repertoire_tabs` statements, each one
  calling the existing `assertRepertoireAccess` from `@/lib/songs`;
- three new functions in `src/lib/songs.ts`: `updateLyrics`,
  `applySongLinkUpdate` (the `global_songs.links` read plus the additive write
  or moderation hand-off) and `getPersonalEntryForSong`;
- one new function in `src/lib/playlists.ts`: `getPlaylistDetailsWithEntries`
  (playlist name plus the ordered entries query, with its two authorization
  calls);
- a new `src/lib/devProfiles.ts` exporting `listDevProfiles()` on `query()` from
  `@/lib/db`, with the `NODE_ENV` guard staying in the route handler;
- `src/app/actions/tabs.ts`, `repertoire.ts` and `playlists.ts` reduced to
  session resolution, delegation and `revalidatePath`;
- a new mechanical guard in the `findViolations` / `actionScan.ts` pattern that
  fails when a `query(` call or an `@/lib/db` import reappears under
  `src/app/actions/*.ts`, or when a hand-rolled `pg` `Client` reappears anywhere
  under `src/`;
- retargeting the action test suites that mock `@/lib/db`, and adding unit
  suites for every moved function plus a real-database suite for the tab
  functions.

This task does not change any action signature, any action name, any envelope
shape, or any fail-closed mode. `src/components` and `src/hooks` are not touched
at all.

## Audit at 059d4c3

Verified at HEAD `059d4c3` (`fix(RH-36): real transaction helper and atomic
multi-statement writes`), version `0.1.71-202609070848`.

`grep -c "query(" src/app/actions/*.ts` prints `bands.ts:0`, `moderation.ts:0`,
`playlists.ts:2`, `profile.ts:0`, `repertoire.ts:5`, `tabs.ts:6` (13 sites).
`grep -rn "@/lib/db" src/app/actions/*.ts` prints `playlists.ts:15`,
`repertoire.ts:5`, `tabs.ts:4`. `grep -rln "new Client" src` prints exactly
`src/app/api/dev/profiles/route.ts`; `src/lib/db.ts` uses `new Pool`, not
`new Client`, so after this task the same grep must print nothing at all.

Correction carried over from the RH-37 split analysis: the `checkAccess` helper
that F8 describes as "hidden inside a `'use server'` file" no longer exists.
RH-34 replaced it with `assertRepertoireAccess` in `src/lib/songs.ts:12`, which
`src/app/actions/tabs.ts:5` already imports and every tab action already calls.
There is no authorization helper left to re-home; the work is purely moving SQL
and keeping the existing lib-level predicates as the single statement of
ownership.

### src/app/actions/tabs.ts

| Site | What it does | New owner | Ownership predicate it duplicates |
| --- | --- | --- | --- |
| L57 | `INSERT INTO repertoire_tabs (repertoire_id, title, file_url) ... RETURNING id, repertoire_id, title, file_url, created_at::text` | `src/lib/tabs.ts` `createTab` | None directly; the action already calls `assertRepertoireAccess` before the blob upload, and the write itself is unscoped once inside the action |
| L78 | `SELECT file_url FROM repertoire_tabs WHERE id = $1 AND repertoire_id = $2` | `src/lib/tabs.ts` `getTabFileUrl` | The `id + repertoire_id` pairing is a second, weaker restatement of "this tab belongs to a repertoire entry the caller may act on" |
| L93 | `DELETE FROM repertoire_tabs WHERE id = $1 AND repertoire_id = $2` | `src/lib/tabs.ts` `deleteTab` | Same pairing |
| L113 | `SELECT annotations FROM repertoire_tabs WHERE id = $1 AND repertoire_id = $2` | `src/lib/tabs.ts` `getTabAnnotations` | Same pairing |
| L147 | `UPDATE repertoire_tabs SET annotations = jsonb_set(annotations, $3, $4::jsonb, true) WHERE id = $1 AND repertoire_id = $2 RETURNING id` | `src/lib/tabs.ts` `saveTabAnnotations` | Same pairing |
| L166 | `SELECT ... FROM repertoire_tabs WHERE repertoire_id = $1 ORDER BY created_at DESC` | `src/lib/tabs.ts` `listTabs` | The bare `repertoire_id` scope, which is only safe because the action asserted access first |

### src/app/actions/repertoire.ts

| Site | What it does | New owner | Ownership predicate it duplicates |
| --- | --- | --- | --- |
| L108 / L113 | `UPDATE repertoire SET lyrics = $1 WHERE id = $2 AND band_id = $3` or `... AND user_id = $3`, chosen by a hand-rolled `'bandId' in owner` branch | `src/lib/songs.ts` `updateLyrics(owner, repertoireId, lyrics)` | An exact hand copy of the `isBand ? 'band_id = $3' : 'user_id = $3'` branch that `updateSongStatus` (`songs.ts:103`) and `updateSongTags` (`songs.ts:122`) already express |
| L153 | `SELECT links FROM global_songs WHERE id = $1` | `src/lib/songs.ts` `applySongLinkUpdate` | None; the ownership check is `assertRepertoireAccess` in the action, which stays there because it is what resolves `songId` |
| L179 | `UPDATE global_songs SET links = $1 WHERE id = $2` | `src/lib/songs.ts` `applySongLinkUpdate` | None (catalog-wide write, gated by the additive-vs-moderated decision) |
| L191 | `SELECT r.*, json_build_object(...) as song FROM repertoire r JOIN global_songs s ON r.song_id = s.id WHERE r.song_id = $1 AND r.user_id = $2` | `src/lib/songs.ts` `getPersonalEntryForSong(songId, userId)` | The `json_build_object` song projection is a verbatim copy of the one in `getRepertoire` (`songs.ts:38-56`) and `getSongEntry` (`songs.ts:197`); the `r.user_id = $2` scope restates the personal half of `RepertoireOwner` |

### src/app/actions/playlists.ts

| Site | What it does | New owner | Ownership predicate it duplicates |
| --- | --- | --- | --- |
| L77 | `SELECT name FROM playlists WHERE id = $1`, falling back to the literal name `Playlist` when there is no row | `src/lib/playlists.ts` `getPlaylistDetailsWithEntries` | Unscoped on purpose; it is safe only because `assertPlaylistAccess` ran first in the action |
| L93 | The ordered `playlist_songs JOIN global_songs JOIN repertoire` query with the `$1::uuid IS NOT NULL` band branch, `ORDER BY ps.position ASC` | `src/lib/playlists.ts` `getPlaylistDetailsWithEntries` | The band-or-user branch restates, in SQL, the same choice that `RepertoireOwner` expresses in TypeScript, and the `assertBandMember` call above it is what makes the band branch safe |

### src/app/api/dev/profiles/route.ts

L19 builds `new Client({ connectionString: process.env.DATABASE_URL })`,
connects, runs `SELECT id, email, name FROM "user" ORDER BY name`, maps
`name` to `full_name`, and closes the client in a `finally`. It ignores the
`BETTER_AUTH_DATABASE_URL` fallback that `src/lib/db.ts:3` implements, and its
catch returns the raw exception text with status 500. The `NODE_ENV !==
'development'` guard at L15 returns `{ error: 'Not found' }` with status 404;
that guard and that status stay exactly as they are.

### Tests that break when the SQL moves

`grep -rln "vi.mock('@/lib/db'" src/app/actions/__tests__` returns four files:

- `src/app/actions/__tests__/tabs.test.ts` - drives `getTabAnnotationsAction`
  and `saveTabAnnotationsAction` entirely through queued `vi.mocked(query)`
  results and asserts on `mock.calls[1][0]` SQL text. Must be retargeted.
- `src/app/actions/__tests__/playlists.test.ts` - the whole
  `getPlaylistDetailsWithEntriesAction` block reads
  `vi.mocked(query).mock.calls[1]`. Must be retargeted.
- `src/app/actions/__tests__/repertoire.test.ts` - the `updateLyricsAction`,
  `updateSongLinksAction` and `getPersonalEntryForSongAction` blocks assert on
  SQL text and parameters. Must be retargeted.
- `src/app/actions/__tests__/actionSessionGuard.test.ts` - mocks `@/lib/db` so
  that reaching the database without a session throws. This mock keeps working
  unchanged: the actions now reach `query` transitively through `src/lib/*`, and
  `vi.mock('@/lib/db')` intercepts that too. This file needs no functional
  change; only its header comment may be updated.

Two further suites must keep passing untouched in substance:
`src/app/actions/__tests__/actionAuthorizationGuard.test.ts` (its allowlist keys
must remain exactly `getPlaylistDetailsWithEntriesAction` and `resolveOwner`,
and its `band_members` scan must stay green) and
`src/app/actions/__tests__/thinActions.test.ts`.

## Approach

### 1. `src/lib/tabs.ts` (new)

```ts
import { query } from '@/lib/db'
import { logger } from '@/lib/logger'
import { assertRepertoireAccess } from '@/lib/songs'
import type { RepertoireTab, Stroke, TabAnnotations } from '@/types/database'

export async function createTab(repertoireId: string, userId: string, title: string, fileUrl: string): Promise<RepertoireTab>
export async function getTabFileUrl(tabId: string, repertoireId: string, userId: string): Promise<string | null>
export async function deleteTab(tabId: string, repertoireId: string, userId: string): Promise<void>
export async function getTabAnnotations(tabId: string, repertoireId: string, userId: string): Promise<TabAnnotations | null>
export async function saveTabAnnotations(tabId: string, repertoireId: string, userId: string, pageNumber: number, strokes: Stroke[]): Promise<boolean>
export async function listTabs(repertoireId: string, userId: string): Promise<RepertoireTab[]>
```

Rules for this module:

- `await assertRepertoireAccess(repertoireId, userId)` is the first statement of
  every one of the six functions, outside any wrapping `try`, so its
  `Access denied: not allowed on this repertoire entry` text survives verbatim
  (convention L1a). This is the single ownership predicate; no function
  re-derives it.
- "Not found" is never an exception here. `getTabFileUrl` and
  `getTabAnnotations` return `null` on zero rows and `saveTabAnnotations`
  returns `false`, so the calling action produces the exact same
  `{ error: 'Tab not found' }` envelope it produces today.
- The `pageNumber` precondition moves with the SQL it protects:
  `saveTabAnnotations` throws `new Error('Invalid page number')` when
  `!Number.isInteger(pageNumber) || pageNumber < 1`, outside the wrapping `try`
  (L1a), so the action's catch still yields `{ error: 'Invalid page number' }`.
- Database failures are wrapped per convention L1: `logger.error('Failed to
  <verb>', err, { ... })` and then `throw new Error('Failed to <verb>:
  ${err.message}')`. **This is a deliberate, documented behaviour delta**: today
  a raw `connection lost` reaches the tab envelopes unlogged; after the move the
  envelope reads `Failed to save annotations: connection lost` and the failure
  reaches Sentry. It is the only user-visible text change in this task, it is
  what the `src/lib` layer convention requires, and the retargeted tests assert
  the new text.
- jscpd risk: the six functions share the shape "assert, one parameterized
  statement, L1 wrapper". The baseline is 19 clones / 239 duplicated lines
  (0.96 %) against a 2 % threshold, so there is headroom, but do not let the L1
  wrapper become six copies of an eight-line block. If jscpd flags it, factor
  the wrapper into one local `runTabQuery(label, sql, params)` helper inside the
  module rather than raising the threshold.

### 2. `src/app/actions/tabs.ts`

Keeps `'use server'`, the `export type { Stroke, TabAnnotations }` re-export
(`src/components/tabs/TabDrawingStage.tsx` imports those types from this module
and must keep compiling), the `try/catch` envelopes (convention A1), the file
size and PDF magic-byte checks, the `@vercel/blob` `put`/`del` calls and
`revalidatePath('/')`. It loses the `@/lib/db` import and all six statements.

`uploadTabAction` and `deleteTabAction` keep their own
`await assertRepertoireAccess(repertoireId, userId)` call before touching Vercel
Blob. That is deliberate: without it the blob upload (or delete) would happen
before authorization. The lib function asserts again so it is safe when called
standalone; the extra round trip is the price of not moving a side effect ahead
of its check.

Mapping: `createTab` for upload, `getTabFileUrl` then `deleteTab` for delete,
`getTabAnnotations` for the read, `saveTabAnnotations` for the write, `listTabs`
for `getTabsAction` (which keeps its no-try/catch, throwing shape).

### 3. `src/lib/songs.ts` additions

```ts
export async function updateLyrics(owner: RepertoireOwner, repertoireId: string, lyrics: string): Promise<void>
export async function applySongLinkUpdate(userId: string, songId: string, links: SongLink[]): Promise<{ success: true; pending?: true }>
export async function getPersonalEntryForSong(songId: string, userId: string): Promise<Repertoire | null>
```

- `updateLyrics` mirrors `updateSongStatus` exactly: `const isBand = 'bandId' in
  owner`, `WHERE id = $2 AND ${isBand ? 'band_id = $3' : 'user_id = $3'}`, L1
  wrapper with `Failed to update lyrics`. It must **not** gain a `RETURNING id`
  row-count check. Today a non-matching id silently no-ops and the action
  resolves; adding a "not found" throw would be a behaviour change that is out
  of scope for a move.
- `applySongLinkUpdate` carries the whole body of today's
  `updateSongLinksAction` except the session resolution, the
  `assertRepertoireAccess` call and `revalidatePath`: read `links` from
  `global_songs`, throw `new Error('Song entry not found')` on zero rows
  (outside the wrapping try, L1a), auto-label blank labels through
  `fetchUrlTitle`, compute `isAdditive`, and then either
  `await submitGlobalSongEdit(userId, songId, { links: processedLinks })`
  returning `{ success: true, pending: true }`, or `UPDATE global_songs SET
  links = $1 WHERE id = $2` returning `{ success: true }`. `@/lib/linkFetcher`
  and `@/lib/moderation` become static imports of `songs.ts`; neither imports
  `songs.ts`, so there is no cycle (`moderation.ts` imports only `db`, `logger`
  and `songSanitizer`; `linkFetcher.ts` imports nothing).
- `getPersonalEntryForSong` is the L191 statement verbatim, returning `null` on
  zero rows and L1-wrapping a database failure.

### 4. `src/app/actions/repertoire.ts`

Loses the `@/lib/db` import. `resolveOwner` is unchanged (the
`actionAuthorizationGuard` allowlist depends on its name).

```ts
export async function updateLyricsAction(repertoireId: string, lyrics: string, bandId?: string | null) {
  const owner = await resolveOwner(bandId)
  await updateLyrics(owner, repertoireId, lyrics)
  revalidatePath('/')
}

export async function updateSongLinksAction(repertoireId: string, links: SongLink[]) {
  const userId = await getRequiredUserId()
  const { song_id: songId } = await assertRepertoireAccess(repertoireId, userId)
  const result = await applySongLinkUpdate(userId, songId, links)
  if (!result.pending) revalidatePath('/')
  return result
}

export async function getPersonalEntryForSongAction(songId: string): Promise<Repertoire | null> {
  try {
    const userId = await getRequiredUserId()
    return await getPersonalEntryForSong(songId, userId)
  } catch {
    return null
  }
}
```

`getPersonalEntryForSongAction` keeps its `try { ... } catch { return null }`
verbatim: it is the single `null` entry in `actionSessionGuard.test.ts`'s
fail-closed table and its fast-view call site has no rejection handler.
`revalidatePath` stays off the `pending` branch, exactly as today.

### 5. `src/lib/playlists.ts` addition

```ts
export interface PlaylistEntrySummary {
  repertoireId: string
  songId: string
  title: string
  artist: string | null
}

export async function getPlaylistDetailsWithEntries(
  playlistId: string,
  userId: string,
  bandId?: string | null,
): Promise<{ name: string; entries: PlaylistEntrySummary[] }>
```

Both authorization calls move into it, in the same order:
`await assertPlaylistAccess(playlistId, userId)` (already exported by this
module) and then `if (bandId) await assertBandMember(bandId, userId)` imported
from `@/lib/bands`. `bands.ts` does not import `playlists.ts`, so the new
lib-to-lib edge introduces no cycle. Then the name read with its `?? 'Playlist'`
fallback, then the ordered entries query with parameters
`[bandId ?? null, userId, playlistId]`, mapped to `PlaylistEntrySummary`.

`getPlaylistDetailsWithEntriesAction` becomes:

```ts
export async function getPlaylistDetailsWithEntriesAction(playlistId: string, bandId?: string | null) {
  const userId = await getRequiredUserId()
  return getPlaylistDetailsWithEntries(playlistId, userId, bandId)
}
```

It keeps calling `getRequiredUserId()` directly, so both RH-34 guards stay
satisfied and the allowlist key set is unchanged. Only the explanatory comment
beside the `getPlaylistDetailsWithEntriesAction` allowlist entry in
`actionAuthorizationGuard.test.ts` may be reworded (it currently says the action
"itself calls ... assertPlaylistAccess()"); the assertions and the key set stay
byte-identical. `getPlaylistEntryIdsAction` is unchanged.

### 6. `src/lib/devProfiles.ts` (new) and the dev route

```ts
export interface DevProfile { id: string; email: string; full_name: string | null }
export async function listDevProfiles(): Promise<DevProfile[]>
```

It runs `SELECT id, email, name FROM "user" ORDER BY name` through `query()`
from `@/lib/db` and maps `name` to `full_name`, so the JSON body the login page
consumes is byte-identical. L1 wrapper: `Failed to list dev profiles`.

A separate module rather than an addition to `src/lib/profile.ts`: this reads
the Better Auth `"user"` table, not the app's `profiles` table, and it is dev
tooling. Keeping it out of `profile.ts` keeps that module's API honest, and a
one-function module is trivially covered.

`src/app/api/dev/profiles/route.ts` keeps `export const dynamic =
'force-dynamic'` and keeps the `NODE_ENV !== 'development'` guard returning
`{ error: 'Not found' }` with status 404, unchanged. The body becomes
`return NextResponse.json(await listDevProfiles())` inside a `try`, with an R1
catch: `logger.error('[dev/profiles]', error instanceof Error ? error :
undefined)` and `NextResponse.json({ error: 'Unexpected error listing dev
profiles', code: 500 }, { status: 500 })`. That replaces today's raw-exception
500 body with the documented route-handler convention; it is a dev-only error
path and no caller reads that text.

### 7. The mechanical guard: `src/app/actions/__tests__/actionDataAccessGuard.test.ts` (new)

Modelled on `src/lib/__tests__/transactionGuard.test.ts` and reusing
`actionScan.ts` plus `findViolations` / `formatViolations` from
`src/lib/__tests__/test-helpers`. Three assertions plus a detector self-test:

1. No `query(` call in any file directly under `src/app/actions`. Scan
   `stripComments(readActionFile(f))` for each `f` of `actionFileNames()` with
   `/\bquery\s*\(/`, and expect the collected `file:line` list to equal `[]`.
   Comments are stripped first so a comment that mentions the call is not a
   violation.
2. No `@/lib/db` import in any file directly under `src/app/actions`. Same scan
   with `/from\s+['"]@\/lib\/db['"]/`.
3. No hand-rolled `pg` client anywhere under `src/`:
   `findViolations(NEW_CLIENT, { skip: 'src/lib/db.ts' })` must be `[]`, where
   `NEW_CLIENT` is built by string concatenation (`new RegExp('new ' + 'Client'
   + '\\s*\\(')`) so the banned literal never appears in this file and a plain
   `grep` over `src/` does not flag the guard itself. `src/lib/db.ts` is skipped
   as the one place a client could ever legitimately be constructed; it uses
   `new Pool` today, so the skip changes nothing at merge.
4. A detector self-test in the shape `transactionGuard.test.ts` uses: each
   regex matches an offending sample built by concatenation and does not match a
   clean sample.

The failure message must name the offending `file:line` entries so a developer
who reintroduces a statement sees where.

Note for the test author: this file lives under `src/app/actions/__tests__`,
which `actionFileNames()` does not list, so assertions 1 and 2 cannot flag the
guard itself; only assertion 3 scans the whole tree, which is why its pattern is
concatenated.

### 8. Test plan

Retargeted (existing files):

- `src/app/actions/__tests__/tabs.test.ts` - drop `vi.mock('@/lib/db')`, mock
  `@/lib/tabs` instead, and assert delegation: each action calls the matching
  lib function with `(tabId, repertoireId, userId, ...)`, maps `null`/`false` to
  `{ error: 'Tab not found' }`, propagates the `Access denied` message into the
  envelope, and turns a rejected lib call into
  `{ error: 'Failed to save annotations: connection lost' }`.
- `src/app/actions/__tests__/playlists.test.ts` - drop `vi.mock('@/lib/db')`;
  add `getPlaylistDetailsWithEntries` to the existing `@/lib/playlists` mock and
  assert `getPlaylistDetailsWithEntriesAction` forwards
  `(PLAYLIST_ID, USER_ID, bandId)` and `getPlaylistEntryIdsAction` returns just
  `entries`. The `assertPlaylistAccess` / `assertBandMember` ordering assertions
  move to the lib suite.
- `src/app/actions/__tests__/repertoire.test.ts` - drop `vi.mock('@/lib/db')`;
  add `updateLyrics`, `applySongLinkUpdate` and `getPersonalEntryForSong` to the
  existing `@/lib/songs` mock. The `updateLyricsAction` block asserts the owner
  fork is forwarded (`{ bandId }` / `{ userId }`) plus `revalidatePath('/')`;
  the `updateSongLinksAction` block asserts `assertRepertoireAccess` runs first,
  the resolved `songId` is forwarded, and `revalidatePath` fires only when the
  result is not `pending`; the `getPersonalEntryForSongAction` block keeps its
  three cases against the mocked lib function.
- `src/app/actions/__tests__/actionSessionGuard.test.ts` - no functional change;
  its `@/lib/db` mock now bites transitively. Header comment may be updated.
- `src/app/actions/__tests__/actionAuthorizationGuard.test.ts` - comment only.

New:

- `src/lib/__tests__/tabs.test.ts` - unit suite for the six functions, mocking
  `@/lib/db` and driving `assertRepertoireAccess` through queued query results
  (the `ACCESS_GRANTED` / `ACCESS_DENIED` fixtures currently in the action
  suite). Covers both sides of every branch: access granted and denied, row
  found and not found, valid and invalid `pageNumber`, and one L1-wrapped
  database failure per function group.
- `src/lib/__tests__/devProfiles.test.ts` - unit suite for `listDevProfiles`
  (row mapping, empty result, L1 wrapper) plus the route handler: `GET()`
  returns 404 with `{ error: 'Not found' }` when `NODE_ENV` is not
  `development`, and 200 with the mapped array when `vi.stubEnv('NODE_ENV',
  'development')` is in effect.
- `src/app/actions/__tests__/actionDataAccessGuard.test.ts` - the guard above.
- `src/app/actions/__tests__/authzTabs.db.test.ts` - real-database suite in the
  RH-34 shape (`describe.skipIf(!SERVICE_ROLE_KEY)`, `authzFixtures`' `asUser`,
  `createTestUser` / `deleteTestUser`, `@vercel/blob` mocked): a band entry
  owned by a band that user A belongs to and user C does not; the tab CRUD and
  annotation actions succeed for A and are refused for C with `Access denied`,
  writing nothing.

Extended (existing files):

- `src/lib/__tests__/songs.test.ts` - `updateLyrics` (both owner branches),
  `applySongLinkUpdate` (additive write, removal to the queue, rewritten url to
  the queue, `Song entry not found`, blank-label auto-fetch) and
  `getPersonalEntryForSong` (row, no row).
- `src/lib/__tests__/playlists.test.ts` - `getPlaylistDetailsWithEntries`:
  authorization order, the band and personal parameter branches, the
  `'Playlist'` name fallback, the entry mapping, and the refusal propagating
  before any read.

Coverage note: `coverage.include` already covers both `src/lib/**/*.ts` and
`src/app/actions/*.ts`, so the universe does not change - but the moved code
arrives with branches the action suites only partly exercised (the
`band_id`/`user_id` fork, the additive-vs-moderated fork, the not-found early
returns). Branches at 65 is the threshold most at risk; the new suites must
exercise both sides of each of those forks explicitly.

### 9. AGENTS.md

AGENTS.md already states this rule three times (the architecture diagram line
"src/lib/* (data-access + domain logic ...)", the "Data access" bullet, and
convention A2 "Actions that only resolve the session and delegate to `src/lib`").
Do not add a fourth restatement. At most, add one sentence to the A2 paragraph
naming the new guard, in the same way the Transactions section names
`transactionGuard.test.ts`.

## Expected Results

ER1 - Static gates hold at the exact baseline, minus one warning this task
necessarily removes. From the repository root: `./node_modules/.bin/tsc --noEmit`
exits 0 and prints nothing (use this invocation, not `npx tsc`); `npx eslint .`
prints a final summary line reading exactly
`29 problems (12 errors, 17 warnings)`. That is one warning fewer than the
baseline `059d4c3` line `30 problems (12 errors, 18 warnings)`, and the warning
that must disappear is exactly
`src/lib/__tests__/songs.test.ts 11:53 'vi' is defined but never used`
(`@typescript-eslint/no-unused-vars`): that file imports `vi` and uses it zero
times today, and Approach 8 requires it to gain the `applySongLinkUpdate`
blank-label auto-fetch case, which mocks `@/lib/linkFetcher` through `vi`. Every
other one of the 30 baseline problems sits in a file outside the ER13 whitelist
(`e2e/global-setup.ts`, `scripts/*.mjs`, `src/app/profile/page.tsx`,
`src/app/reset-password/page.tsx`, `src/app/settings/page.tsx`,
`src/app/songs/[id]/fast-view/page.tsx`, `src/components/landing/LandingPage.tsx`,
`src/components/layout/AppLayout.tsx`,
`src/components/layout/LanguageSelector.tsx`,
`src/lib/__tests__/edge_cases.test.ts`, `src/lib/__tests__/errors.test.ts`,
`src/lib/__tests__/i18n.test.ts`, `src/lib/__tests__/test-helpers.ts`) and must
still be reported unchanged, so no file this task creates or edits may contribute
a single new error or warning. `npm run lint:dup` exits 0 and
its console report shows at most 21 clones and a duplication percentage below
2 %; `npm run lint:dead` exits 0 and reports no unused files, exports or
dependencies; `npm run audit` exits 0 and reports `found 0 vulnerabilities`.

ER2 - The Server Action layer contains no SQL. `grep -c "query(" src/app/actions/*.ts`
prints exactly these six lines and nothing else: `src/app/actions/bands.ts:0`,
`src/app/actions/moderation.ts:0`, `src/app/actions/playlists.ts:0`,
`src/app/actions/profile.ts:0`, `src/app/actions/repertoire.ts:0`,
`src/app/actions/tabs.ts:0`. (At baseline `059d4c3` the same command printed
`playlists.ts:2`, `repertoire.ts:5` and `tabs.ts:6`.)

ER3 - No action file imports the database module. `grep -rn "@/lib/db" src/app/actions/*.ts`
prints nothing and exits with status 1 (check with `; echo $?`). At baseline it
printed three lines: `playlists.ts:15`, `repertoire.ts:5` and `tabs.ts:4`.

ER4 - No hand-rolled Postgres client survives anywhere in the source tree.
`grep -rln "new Client" src` prints nothing and exits with status 1 (check with
`; echo $?`); at baseline it printed exactly `src/app/api/dev/profiles/route.ts`,
and `src/lib/db.ts` constructs a `new Pool`, never a client, so the expected
output after this task is empty rather than one path. In addition,
`grep -n "listDevProfiles" src/app/api/dev/profiles/route.ts` prints at least
two lines (the import and the call), and
`grep -c "NODE_ENV" src/app/api/dev/profiles/route.ts` prints `1`.

ER5 - The lib modules exist and expose the moved functions. Each of the
following commands prints a line for every named symbol:
`grep -n "export async function \(createTab\|getTabFileUrl\|deleteTab\|getTabAnnotations\|saveTabAnnotations\|listTabs\)" src/lib/tabs.ts`
prints 6 lines;
`grep -c "assertRepertoireAccess(" src/lib/tabs.ts` prints a number greater than
or equal to `6`, and `grep -c "^import { assertRepertoireAccess } from '@/lib/songs'" src/lib/tabs.ts`
prints `1`;
`grep -n "export async function \(updateLyrics\|applySongLinkUpdate\|getPersonalEntryForSong\)" src/lib/songs.ts`
prints 3 lines;
`grep -n "export async function getPlaylistDetailsWithEntries" src/lib/playlists.ts`
prints 1 line;
`grep -n "export async function listDevProfiles" src/lib/devProfiles.ts`
prints 1 line.

ER6 - The mechanical guard fails when the layering is broken and passes when it
is not. `npx vitest run src/app/actions/__tests__/actionDataAccessGuard.test.ts`
reports `Test Files  1 passed (1)` with 0 failed. Then run this tamper check
from the repository root: `cp src/app/actions/profile.ts /tmp/rh45-profile.bak`;
`printf "\nimport { query } from '@/lib/db'\nexport async function tamperProbeAction() { await query('SELECT 1') }\n" >> src/app/actions/profile.ts`;
`npx vitest run src/app/actions/__tests__/actionDataAccessGuard.test.ts` now
reports at least 1 failed test and its failure output contains the string
`profile.ts`; then `cp /tmp/rh45-profile.bak src/app/actions/profile.ts` and
re-run the same vitest command, which reports `Test Files  1 passed (1)` again,
and `git diff --stat -- src/app/actions/profile.ts` prints nothing.

ER7 - The RH-34 guards and the retargeted action suites all pass, and only one
action test file still mocks the database module.
`npx vitest run src/app/actions/__tests__/actionAuthorizationGuard.test.ts src/app/actions/__tests__/actionSessionGuard.test.ts src/app/actions/__tests__/thinActions.test.ts src/app/actions/__tests__/tabs.test.ts src/app/actions/__tests__/playlists.test.ts src/app/actions/__tests__/repertoire.test.ts src/app/actions/__tests__/bands.test.ts`
reports `Test Files  7 passed (7)` with 0 failed and 0 skipped. In addition
`grep -rln "vi.mock('@/lib/db'" src/app/actions/__tests__` prints exactly
`src/app/actions/__tests__/actionSessionGuard.test.ts` and nothing else (at
baseline it printed four files: that one plus `repertoire.test.ts`,
`playlists.test.ts` and `tabs.test.ts`), and
`grep -n "getPlaylistDetailsWithEntriesAction\|resolveOwner" src/app/actions/__tests__/actionAuthorizationGuard.test.ts`
still shows both names present in the allowlist and in the exact-key-set
assertion.

ER8 - Behaviour is preserved against a real database. With Postgres running at
`postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations
applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`,
`npx vitest run src/app/actions/__tests__/authzRepertoire.db.test.ts src/app/actions/__tests__/authzPlaylists.db.test.ts src/app/actions/__tests__/authzBands.db.test.ts src/app/actions/__tests__/authzTabs.db.test.ts`
reports `Test Files  4 passed (4)` with 0 failed and 0 skipped. The new file
`src/app/actions/__tests__/authzTabs.db.test.ts` must contain, at minimum: a
band-owned repertoire entry whose band member uploads a tab, lists it, reads and
writes its annotations and deletes it, all succeeding; and the same five
operations attempted by a user who is not a member of that band, each rejected
with a message containing `Access denied` and leaving `SELECT count(*) FROM
repertoire_tabs WHERE repertoire_id = <entry>` unchanged. The existing
`authzRepertoire.db.test.ts` cases covering `updateLyricsAction` (scoped to the
band owner, refused for a non-member) and `updateSongLinksAction` (additive
write through, removal to the moderation queue), and the existing
`authzPlaylists.db.test.ts` case covering `getPlaylistDetailsWithEntriesAction`,
must pass without their assertions being weakened.

ER9 - The dev profiles route keeps its guard and its payload shape.
`npx vitest run src/lib/__tests__/devProfiles.test.ts` reports
`Test Files  1 passed (1)` with 0 failed, and that suite asserts both of these:
calling the exported `GET()` while `process.env.NODE_ENV` is not `development`
resolves to a response with `status === 404` and a JSON body deep-equal to
`{ error: 'Not found' }` (the same status and body the route returns at baseline
`059d4c3`), and calling `GET()` with `vi.stubEnv('NODE_ENV', 'development')` in
effect resolves to `status === 200` with a JSON body deep-equal to
`[{ id: 'u1', email: 'a@example.com', full_name: 'Ann' }]` when `listDevProfiles`
is stubbed to return that single row, proving the route delegates and the
`{ id, email, full_name }` shape the login page consumes is unchanged.

ER10 - The whole suite passes and grows. This ER requires the same database
environment as ER8 and is not verifiable without it: Postgres running at
`postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations
applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. Without
that environment the 13 suites gated by `describe.skipIf(!SERVICE_ROLE_KEY)` (12
at baseline `059d4c3` plus the new `authzTabs.db.test.ts`) do not execute and the
run reports a `skipped` segment, which fails the no-`skipped` condition below
even for a correct implementation. With it, `npx vitest run` reports
`Test Files  55 passed (55)` (baseline `059d4c3`: 51) and a `Tests` line of the
form `N passed (N)` with N at least `655` (baseline: 638), with no `failed` and
no `skipped` segment on either line. The four new test files
`src/lib/__tests__/tabs.test.ts`, `src/lib/__tests__/devProfiles.test.ts`,
`src/app/actions/__tests__/actionDataAccessGuard.test.ts` and
`src/app/actions/__tests__/authzTabs.db.test.ts` all exist and all appear in the
run output.

ER11 - The coverage gate passes with the thresholds untouched. This ER requires
the same database environment as ER8 and is not verifiable without it: Postgres
running at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with
migrations applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
The 13 suites gated by `describe.skipIf(!SERVICE_ROLE_KEY)` (12 at baseline
`059d4c3` plus the new `authzTabs.db.test.ts`) contribute the coverage of every
real-database path, so the thresholds below are only reachable when they
actually run. With that environment, `npm run test:coverage` exits 0 with no
`ERROR: Coverage for ... does not meet threshold` line, and
`grep -n "statements: 80" -A 3 vitest.config.ts` still shows `statements: 80`,
`branches: 65`, `functions: 78`, `lines: 80`. In addition, after that run,
`node -e "const c=require('./coverage/coverage-final.json');for(const [k,v] of Object.entries(c)){if(!/src\/lib\/(tabs|devProfiles)\.ts$/.test(k))continue;const s=Object.values(v.s);console.log(k.replace(process.cwd()+'/',''),Math.round(100*s.filter(Boolean).length/s.length))}"`
prints exactly two lines, one for `src/lib/tabs.ts` and one for
`src/lib/devProfiles.ts`, each ending in a number greater than or equal to `90`.

ER12 - The application still builds and server-renders. `npx next build`
completes with exit code 0 and no error output, and
`npx playwright test e2e/ssr-smoke.spec.ts` reports `4 passed`.

ER13 - Version, landing page and blast radius. `node -e "console.log(require('./package.json').version)"`
prints a version of the form `0.1.72-YYYYMMDDHHmm` that is strictly greater than
the baseline `0.1.71-202609070848`.
`git diff --stat 059d4c3 -- src/components/landing src/i18n/dictionaries` prints
nothing (this task ships no selling point; it is an internal refactor).
`git diff --name-only 059d4c3` lists only paths drawn from this whitelist, and
nothing else: `AGENTS.md`, `package.json`, `docs/tasks/RH-45-spec.md`,
`docs/suggestions-log.md`, `src/lib/tabs.ts`, `src/lib/devProfiles.ts`,
`src/lib/songs.ts`, `src/lib/playlists.ts`, `src/app/actions/tabs.ts`,
`src/app/actions/repertoire.ts`, `src/app/actions/playlists.ts`,
`src/app/api/dev/profiles/route.ts`, `src/lib/__tests__/tabs.test.ts`,
`src/lib/__tests__/devProfiles.test.ts`, `src/lib/__tests__/songs.test.ts`,
`src/lib/__tests__/playlists.test.ts`,
`src/app/actions/__tests__/tabs.test.ts`,
`src/app/actions/__tests__/repertoire.test.ts`,
`src/app/actions/__tests__/playlists.test.ts`,
`src/app/actions/__tests__/actionSessionGuard.test.ts`,
`src/app/actions/__tests__/actionAuthorizationGuard.test.ts`,
`src/app/actions/__tests__/actionDataAccessGuard.test.ts`,
`src/app/actions/__tests__/authzTabs.db.test.ts`,
`src/app/actions/__tests__/authzFixtures.ts`. In particular the output contains
no path under `src/components/`, no path under `src/hooks/`, no
`eslint.config.mjs`, no path under `migrations/`, and no `vitest.config.ts`.

## Out of Scope

- **Inverting inward imports.** `src/components/tabs/TabDrawingStage.tsx`,
  `src/components/layout/AppLayout.tsx`, `src/components/songs/SongForm.tsx`,
  `src/components/songs/CorrectionModal.tsx` and `src/hooks/useBandAdmin.ts` all
  import from `@/app/actions/*`. That is F21 and belongs to RH-46 and RH-47. Do
  not touch `src/components/**` or `src/hooks/**` in this task, and do not add
  the ESLint `no-restricted-imports` rule: it cannot reach zero violations until
  RH-47 lands, so adding it here would break the eslint baseline in ER1.
- **A typed query helper.** Replacing the `any`-typed `query<T>` generic or
  introducing a query builder is RH-40. The moved statements keep their current
  typing style.
- **Fixing the fast-view page.** `src/app/songs/[id]/fast-view/page.tsx` is
  1586 lines and is RH-38's target. It is a caller only; every action signature
  it uses is preserved, so it must not appear in the diff.
- **Adding not-found semantics that do not exist today.** `updateLyrics` keeps
  its silent no-op on a non-matching id, and no moved function gains a new
  authorization check beyond the one its action already performed.
- **The remaining `query(` sites elsewhere.** `src/app/api/**/route.ts` handlers
  other than the dev profiles route are untouched by this task.

## Post-merge checks (orchestrator)

- Re-run the RH-37 audit greps and confirm the F8 count drops from 13 to 0 and
  the F22 site is gone, then mark F8 and F22 resolved in
  `docs/plans/code-quality-review.md` when RH-46 and RH-47 also land (F8's text
  should be corrected at that point: 13 sites, not fifteen, and the `checkAccess`
  helper it describes was already removed by RH-34).
- Confirm RH-46's spec is told that `getTabAnnotationsAction` and
  `saveTabAnnotationsAction` kept their exact signatures and their
  `export type { Stroke, TabAnnotations }` re-export, so the component inversion
  can proceed independently.
