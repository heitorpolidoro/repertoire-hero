# RH-34 — Fail-closed authorization on every Server Action

Pinned to `27e44a8` (`fix(RH-33): patch browserslist and fast-uri advisories, add npm audit gate to CI`),
the tip of `master` when this spec was written. Every baseline number below was
re-measured on a clean tree at that commit, not copied from RH-25.

## Scope

A Server Action is a public POST endpoint. Anyone who can reach the page it is
bound to can invoke it with arbitrary arguments; the UI that hides a button
behind `isAdmin` is decoration. At `27e44a8`, 26 of the 45 exported actions
(15 distinct defect classes) either resolve no session at all or resolve one and
then authorize against a client-supplied id.

This task makes one rule true everywhere, mechanically:

> **Every exported Server Action resolves the session through
> `getRequiredUserId()` (directly, or through a helper in the same file that
> does), and every action that touches a band, a playlist or a repertoire row
> authorizes the caller against that row through a `src/lib` helper before any
> read or write. When the caller is not entitled, the action fails closed: it
> throws (or returns `{ error }` where that action already returns an envelope),
> and the database is left byte-identical.**

It covers all six action modules — `bands.ts`, `playlists.ts`, `repertoire.ts`,
`tabs.ts`, `profile.ts`, `moderation.ts` — and the `src/lib` functions they call.
It closes RH-25 findings **F1**, **F2**, **F3** and **F7**, plus the additional
holes the sweep found that RH-25 did not enumerate (listed in "Audit at
27e44a8" below).

### Explicitly NOT in scope

- **F5** — the Spotify route handlers (`src/app/api/spotify/playlists/[id]/**`).
  Route handlers are a different surface with a different error convention (R1)
  and their own task.
- **F4** — the pool-level `BEGIN`/`COMMIT` transaction defect. `updateSong` and
  `reviewGlobalSongEdit` keep their current (non-atomic) shape here.
- **F6 / F8** — decomposing `FastViewPage`, or moving the remaining SQL out of
  the action layer wholesale. This task moves only the SQL it must move (the
  duplicated `band_members` membership check).
- Any schema change. `git diff 27e44a8 -- migrations` must stay empty.
- Rate limiting, SSRF allow-listing for `fetchUrlTitleAction` /
  `fetchLyricsAction` (they gain a session requirement here, nothing more),
  and "last admin cannot be removed" business rules.
- Landing-page copy. This is a security fix, not a selling point — see
  "Landing Page Rule" below.

## Audit at 27e44a8

`for f in src/app/actions/*.ts; do echo "$f exports=$(grep -cE '^export (async )?(function|const)' "$f") requireCalls=$(grep -c 'getRequiredUserId()' "$f")"; done`

45 exported actions across six files. Read against the code, they classify as:

### Already correct (19)

`profile.ts` (3/3), `moderation.ts` (3/3 — the two admin ones go through
`checkSystemAdmin` in `src/lib/moderation.ts`), `tabs.ts` (5/5 — session plus a
row-level `checkAccess`), and in the other files: `getBandsAction`,
`createBandAction`, `leaveBandAction`, `regenerateBandInviteCodeAction`,
`uploadBandCoverAction`, `getUserPlaylistsAction`, `createPlaylistAction`,
`getPersonalEntryForSongAction`.

### Unprotected: 15 defect classes covering 26 actions — what this task fixes

Rows 12, 13 and 15 each cover more than one exported action, which is why the
table has 15 rows but accounts for 26 of the 45 exports (19 + 26 = 45).

| # | Action | Defect at `27e44a8` |
|---|---|---|
| 1 | `updateBandAction` | F1. No session. `updateBand(bandId, data)` updates by id alone. |
| 2 | `deleteBandAction` | F1. No session. `DELETE FROM bands WHERE id = $1`. |
| 3 | `removeBandMemberAction` | F1. No session. `DELETE FROM band_members WHERE id = $1`, no band scoping. |
| 4 | `getBandWithMembersAction` | No session. Leaks any band's member list (names, emails) **and its `invite_code`**. Not in RH-25. |
| 5 | `getBandPlaylistsAction` | No session. Leaks any band's playlists. Not in RH-25. |
| 6 | `createBandPlaylistAction` | No session. Inserts a playlist into any band. Not in RH-25. |
| 7 | `updatePlaylistAction` | F2. No session. |
| 8 | `deletePlaylistAction` | F2. No session. `DELETE FROM playlists WHERE id = $1`. |
| 9 | `removeSongFromPlaylistAction` | F2. No session. |
| 10 | `getPlaylistWithSongsAction` | F2. No session. Leaks any playlist's contents. |
| 11 | `addSongToPlaylistAction` | Session resolved, but `addSongToPlaylist` never checks the caller may write to that playlist — authenticated cross-tenant write. Not in RH-25. |
| 12 | `getPlaylistDetailsWithEntriesAction` (and its delegate `getPlaylistEntryIdsAction`) | Session resolved, but the playlist name is read unscoped and `bandId` is trusted from the client. Not in RH-25. |
| 13 | the nine actions funnelling through `resolveOwner` — `getRepertoireAction`, `addSongAction`, `updateSongStatusAction`, `updateSongTagsAction`, `removeSongAction`, `getSongEntryAction`, `updateSongAction`, `createAndAddSongAction`, `updateLyricsAction` | F3. `resolveOwner` resolves the session, then discards it and returns `{ bandId }` unverified. Any signed-in user can read and mutate any band's repertoire. |
| 14 | `updateSongLinksAction` | F7. No session, rewrites the shared `global_songs.links` for everyone. |
| 15 | `searchGlobalSongsAction`, `fetchLyricsAction`, `fetchUrlTitleAction` | No session. `fetchUrlTitleAction` in particular is an unauthenticated server-side fetch of an arbitrary URL. Not in RH-25. |

The four static gates are all green at `27e44a8` and must stay green:
`npx tsc --noEmit` clean, `npx vitest run` **40 files / 478 tests / 0 skipped**,
`npx eslint .` **30 problems (12 errors, 18 warnings)** (pre-existing),
`npm run lint:dead` exit 0, `npm run lint:dup` exit 0 with **19 clones / 239
duplicated lines / 1.08 %**, `npm run audit` **0 vulnerabilities**,
`npm run test:coverage` **91.89 / 73.80 / 96.25 / 92.87** overall
(`src/app/actions` row: 79.41 / 67.08 / 93.87 / 78.89) against thresholds
80/65/78/80.

## Approach

### 1. Two failure modes, chosen per action kind

Uniformity is the goal, but "fail closed" means different things for a read and
a write, and picking the wrong one breaks working UI:

- **Mutations assert and throw.** The thrown message starts with `Access denied`
  — the prefix `src/lib/moderation.ts` already established, and which the L1a
  rule in AGENTS.md re-throws unwrapped so the text survives to the UI. Actions
  that already return an envelope (`tabs.ts`, `uploadBandCoverAction`) keep
  returning `{ error: <that message> }`.
- **Row reads scope in SQL and return the not-found value** (`null`, `[]`). A
  caller without access gets exactly what they would get for an id that does not
  exist, so existence is not leaked either. This also preserves the existing UI
  paths verbatim: `useBandAdmin.load()` does
  `Promise.all([getBandWithMembers, getBandPlaylists])` and branches on
  `!bandData → onNotFound()`; `refreshPlaylist()` does
  `if (!data) router.replace('/playlists')`. If those reads threw instead, a
  non-member would get an error banner where they used to get "band not found".

  The one deliberate exception is `resolveOwner`: the nine repertoire actions
  take `bandId` from the caller's own band-context store, so a mismatch is never
  a legitimate navigation, and F3's remediation asks for a throw. It throws for
  reads too.

### 2. New authorization helpers, in `src/lib` only

No new module. The helpers live beside the domain code they guard, and no
`band_members` SQL remains in `src/app/actions/*.ts` after this task.

`src/lib/bands.ts`:

```ts
/** The caller's role in the band, or throws. */
export async function assertBandMember(bandId: string, userId: string): Promise<'admin' | 'member'>
// throws: Access denied: not a member of this band

async function assertBandAdmin(bandId: string, userId: string): Promise<void>   // not exported
// throws: Access denied: band admin required
```

`src/lib/playlists.ts`:

```ts
/** The playlist row the caller may act on, or throws. */
export async function assertPlaylistAccess(
  playlistId: string, userId: string,
): Promise<{ id: string; user_id: string | null; band_id: string | null }>
// predicate: user_id = $2 OR band_id IN (SELECT band_id FROM band_members WHERE user_id = $2)
// throws (also for a non-existent id, so existence is not leaked):
//   Access denied: not allowed on this playlist
```

`src/lib/songs.ts`:

```ts
/** The repertoire row the caller may act on, or throws. */
export async function assertRepertoireAccess(
  repertoireId: string, userId: string,
): Promise<{ id: string; song_id: string; user_id: string | null; band_id: string | null }>
// same predicate shape, over `repertoire`
// throws: Access denied: not allowed on this repertoire entry
```

`src/app/actions/tabs.ts`'s local `checkAccess` is deleted and replaced by
`assertRepertoireAccess` — it is the same query, and this removes the last
`band_members` SQL from the action layer. Its thrown text changes from
`Access denied` to `Access denied: not allowed on this repertoire entry`; update
the two assertions in `src/app/actions/__tests__/tabs.test.ts` accordingly.

Keep each helper short and structurally distinct enough that `npm run lint:dup`
stays under its 2 % threshold.

### 3. Signature convention for the threaded `userId`

`userId` goes **immediately after the entity id it authorizes against, before
the payload**. The affected `src/lib` signatures become:

```ts
getBandWithMembers(bandId, userId)          // membership-scoped SELECT → null for non-members
getBandPlaylists(bandId, userId)            // membership-scoped SELECT → [] for non-members
createBandPlaylist(bandId, userId, name)    // assertBandMember (any member; the UI's
                                            //  new-playlist form is not admin-gated)
updateBand(bandId, userId, data)            // assertBandAdmin
deleteBand(bandId, userId)                  // assertBandAdmin
removeBandMember(memberId, userId)          // resolve band_id FROM band_members WHERE id = $1
                                            //  server-side, then assertBandAdmin(that band);
                                            //  DELETE ... WHERE id = $1 AND band_id = $2
updatePlaylist(playlistId, userId, data)    // assertPlaylistAccess
deletePlaylist(playlistId, userId)          // assertPlaylistAccess
removeSongFromPlaylist(playlistId, userId, songId)   // assertPlaylistAccess
addSongToPlaylist(playlistId, userId, songId)        // assertPlaylistAccess (argument order
                                            //  changed from (userId, playlistId, songId))
getPlaylistWithSongs(playlistId, userId)    // access-scoped SELECT → null
```

`removeBandMember` deliberately keeps its one-argument **action** signature:
deriving `band_id` from the member row server-side is strictly safer than
accepting it from the client, and it leaves `src/hooks/useBandAdmin.ts`
untouched. No exported action signature changes anywhere except
`updateSongLinksAction` (see §5).

The assert call goes **outside** the wrapping `try` in each `src/lib` function,
following the `regenerateBandInviteCode` precedent, so the `Access denied` text
is not swallowed into a `Failed to …` prefix.

### 4. `resolveOwner` (F3)

```ts
async function resolveOwner(bandId?: string | null): Promise<RepertoireOwner> {
  const userId = await getRequiredUserId()
  if (!bandId) return { userId }
  await assertBandMember(bandId, userId)   // throws Access denied: not a member of this band
  return { bandId }
}
```

Four lines, nine actions fixed. Nothing else in `repertoire.ts` changes for
those nine.

`searchGlobalSongsAction`, `fetchLyricsAction` and `fetchUrlTitleAction` each
gain a bare `await getRequiredUserId()`. In `fetchLyricsAction` it must go
**before** the existing `try`, otherwise the `catch { return null }` swallows
the authentication failure and the action fails open-ish (silent `null`).

`getPersonalEntryForSongAction` already resolves the session inside a
`try { … } catch { return null }`, so with no session it resolves `null`. That
is fail-closed (no data crosses the boundary) and the fast-view call site has no
rejection handler, so it keeps that shape — recorded as the single `null`-mode
entry in the session guard table (§6).

### 5. The global catalog write (F7) — chosen policy

**Policy: a signed-in caller who owns a repertoire entry for the song may add
links to the shared catalog directly; removing or rewriting an existing link is
never a direct write — it is submitted to the RH-15/RH-27 moderation queue as a
pending `global_song_edits` row and applied only on admin approval.**

Why this and not the alternatives:

- *Any signed-in user writes directly* keeps the abuse vector F7 names: one
  account can still wipe the link list every other user sees.
- *Everything through the queue* would break the behaviour the feature exists
  for — a musician adds a chords link mid-rehearsal and needs to see it now, not
  after an admin wakes up.
- *Per-owner links on the `repertoire` row* is the "right" data model, but it is
  a migration plus a visible product change (other users of the same song would
  stop seeing contributed links) and belongs in its own task.

The chosen split is the one the codebase already committed to twice. AGENTS.md
describes `global_songs` as wiki-style — "any user can contribute a song" — and
commit `d102d28` made a repertoire owner's catalog write *fill-if-empty*: it may
add what is missing, never clobber what is there. RH-15/RH-27 then built
`global_song_edits` precisely so that *corrections* to already-set catalog fields
go through review. Additive-direct / destructive-moderated is the same rule
applied to `links`, and it needs no new moderation plumbing:
`reviewGlobalSongEdit` already applies `proposed.links`, and
`src/app/admin/moderation/page.tsx` already renders object-valued proposals via
`JSON.stringify`.

Implementation:

```ts
export async function updateSongLinksAction(
  repertoireId: string,
  links: SongLink[],
): Promise<{ success: boolean; pending?: boolean }>
```

1. `const userId = await getRequiredUserId()`.
2. `const { song_id } = await assertRepertoireAccess(repertoireId, userId)`.
   The polymorphic `repertoireIdOrSongId` parameter is **gone**: a
   `global_songs.id` no longer resolves. No call site passes one (both call
   sites in `src/app/songs/[id]/fast-view/page.tsx` pass `entry.id`), so this
   removes only the crafted-call path. A repertoire id that does not exist or is
   not the caller's still throws `Access denied: not allowed on this repertoire
   entry`; keep `Song entry not found` for the case where the row exists but its
   `song_id` does not resolve to a `global_songs` row.
3. Auto-fetch missing labels via `fetchUrlTitle`, exactly as today.
4. Read the current `global_songs.links`. If every current link's `url` is still
   present in the submitted list — i.e. the change is purely additive, labels may
   differ — `UPDATE global_songs SET links = $1 WHERE id = $2` and return
   `{ success: true }`, the shape returned at `27e44a8`.
5. Otherwise (a link was removed, or an existing entry's `url` changed) leave
   `global_songs` untouched and call
   `submitGlobalSongEdit(userId, song_id, { links: processedLinks })`; return
   `{ success: true, pending: true }`.

`src/app/songs/[id]/fast-view/page.tsx`: the add path (~line 550) is unchanged.
The delete path (~line 605) inspects the result — when `pending` is true it
leaves the link in the list and calls the existing `showToast(...)` with a
`'warning'` tone saying the removal was submitted for review; otherwise it
behaves exactly as today. No `alert()`/`confirm()` (AGENTS.md NO Browser Alerts;
`src/lib/__tests__/noBrowserDialogs.test.ts` enforces it).

### 6. Tests

All new tests live in `src/app/actions/__tests__/`. The DB files mock **only**
`@/lib/auth-session` (and `next/cache` for `revalidatePath`) and run against the
real Postgres through `@/lib/db`, in the style of
`src/lib/__tests__/joinBandByInvite.test.ts`: `describe.skipIf(!SUPABASE_SERVICE_ROLE_KEY)`,
fixtures created in `beforeAll` via `createTestUser` from
`src/lib/__tests__/test-helpers.ts`, everything they created deleted in
`afterAll`. Every unauthorized case asserts **both** that the call was refused
**and** that the target rows are unchanged, read back with a direct `query()`.

1. **`actionAuthorizationGuard.test.ts`** — static scan. Reads every
   `src/app/actions/*.ts`, extracts each top-level `export async function` name
   and its body, and fails unless the body calls `getRequiredUserId()` or an
   allowlisted session-resolving helper. The allowlist is a literal in the test
   with a one-line justification per entry, and at merge holds exactly two:
   `resolveOwner` and `getPlaylistDetailsWithEntriesAction` (the delegate target
   of `getPlaylistEntryIdsAction`). A second case asserts
   `grep -l band_members src/app/actions/*.ts` finds nothing.
2. **`actionSessionGuard.test.ts`** — behavioural, mocked. A table with one
   entry per exported action: its arguments and its fail-closed mode
   (`throws` | `envelope` | `null`). One test asserts the table's key set equals
   the export names scanned from the six files, so a new action cannot be added
   without a decision. Then `it.each` over the table, with `getRequiredUserId`
   mocked to reject `Not authenticated`, asserts the declared mode.
3. **`authzBands.db.test.ts`**, **`authzPlaylists.db.test.ts`**,
   **`authzRepertoire.db.test.ts`** — the real-DB cross-tenant suites described
   in ER6/ER7/ER8/ER9.

The five existing `src/app/actions/__tests__/*.test.ts` files from RH-24 stay
green; they are extended (not rewritten) where a `src/lib` signature changed.
The `src/lib/__tests__` files that call the re-signed functions —
`bands.test.ts`, `playlists.test.ts`, `errors.test.ts`, `edge_cases.test.ts`,
`joinBandByInvite.test.ts` — are updated to pass the new `userId` argument.

### 7. Housekeeping

- **Version bump** (AGENTS.md): highest used is `0.1.68-202609060011`; bump to
  `0.1.69-<YYYYMMDDHHmm>` at commit time.
- **Landing Page Rule**: this task ships **no** selling point. Closing an
  authorization hole is table stakes, not a reason a musician picks the app, and
  the rule explicitly excludes internal/operational changes. `landing.*` in both
  dictionaries and `src/components/landing/**` must be untouched.
- Log any deferred idea (F4, F5, per-owner links) to `docs/suggestions-log.md`
  rather than widening this task.

## Expected Results

ER1 - Static gates unchanged from the `27e44a8` baseline. From the repo root on the task branch: `npx tsc --noEmit` exits 0 and writes nothing at all to stdout or stderr (zero bytes of diagnostic output, as at `27e44a8`); `npx eslint .` reports exactly 30 problems, 12 errors and 18 warnings, in its summary line (no new lint problem); `npm run lint:dead` exits 0 with no `Unused` section; `npm run lint:dup` exits 0 and reports at most 21 clones (baseline 19 clones / 239 duplicated lines / 1.08 %, threshold 2 %); `npm run audit` prints `found 0 vulnerabilities`.

ER2 - The whole suite grows and nothing skips. With Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with `npm run db:migrate` applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, `npx vitest run` reports `Test Files N passed (N)` with N >= 45, `Tests M passed (M)` with M >= 520, 0 failed and 0 skipped (baseline at `27e44a8`: 40 files / 478 tests / 0 skipped). All five of these files exist and are among the passing files: `src/app/actions/__tests__/actionAuthorizationGuard.test.ts`, `src/app/actions/__tests__/actionSessionGuard.test.ts`, `src/app/actions/__tests__/authzBands.db.test.ts`, `src/app/actions/__tests__/authzPlaylists.db.test.ts`, `src/app/actions/__tests__/authzRepertoire.db.test.ts`.

ER3 - The coverage gate still passes with the actions layer no worse than baseline. `npm run test:coverage` exits 0 (thresholds statements 80 / branches 65 / functions 78 / lines 80), its `All files` row shows statements >= 80, branches >= 65, functions >= 78, lines >= 80, and its `src/app/actions` row shows statements >= 79.41 and lines >= 78.89 (the values at `27e44a8`).

ER4 - The rule is mechanical, not a convention. `npx vitest run src/app/actions/__tests__/actionAuthorizationGuard.test.ts` passes. That test scans every file matching `src/app/actions/*.ts`, collects each top-level `export async function`, and fails naming any whose body calls neither `getRequiredUserId()` nor a helper on an in-test allowlist that carries a one-line justification per entry; at merge the allowlist contains exactly the two entries `resolveOwner` and `getPlaylistDetailsWithEntriesAction`. A second case in the same file asserts no action file contains the string `band_members` (all membership SQL lives in `src/lib`), verifiable directly with `grep -l band_members src/app/actions/*.ts`, which prints nothing. Tamper check: delete the `getRequiredUserId()` call from `deletePlaylistAction`, re-run the file, and it fails with `deletePlaylistAction` in the message; restore the line and it passes again.

ER5 - Every exported Server Action refuses to run without a session. `npx vitest run src/app/actions/__tests__/actionSessionGuard.test.ts` passes with at least 46 tests. The file holds a table with one entry per exported action across `bands.ts`, `moderation.ts`, `playlists.ts`, `profile.ts`, `repertoire.ts` and `tabs.ts` (45 entries at merge), and one test asserts the table's key set is exactly equal to the set of exported action names scanned from those six files, so an action cannot be added without an entry. For every entry, with `getRequiredUserId` mocked to reject with `Not authenticated`, the action is invoked and matches its declared fail-closed mode: `throws` (rejects with a message containing `Not authenticated`), `envelope` (resolves to an object whose `error` property contains `Not authenticated`), or `null` (resolves to `null`). Exactly one entry uses mode `null`, `getPersonalEntryForSongAction`, and its table row carries the reason as a comment.

ER6 - Band actions refuse non-admins and non-members, and change nothing. `npx vitest run src/app/actions/__tests__/authzBands.db.test.ts` passes with 0 skipped, against the real database. Fixture: user A is admin/creator of band X, user B is a plain member, user C is not a member. Each of the following rejects with a message containing `Access denied`, and a direct SQL read-back taken after the call equals the snapshot taken before it: `updateBandAction` called as B and as C (`SELECT name, description, color FROM bands WHERE id = X` unchanged); `deleteBandAction` called as B and as C (`SELECT count(*) FROM bands WHERE id = X` still 1); `removeBandMemberAction` called as B and as C targeting B's `band_members` row (`SELECT count(*) FROM band_members WHERE id = <B row>` still 1); `createBandPlaylistAction` called as C (`SELECT count(*) FROM playlists WHERE band_id = X` unchanged). `getBandWithMembersAction(X)` called as C resolves to `null` and `getBandPlaylistsAction(X)` called as C resolves to `[]` (no throw, no data). The authorized paths still work in the same file: as A, `updateBandAction` changes the stored name, `createBandPlaylistAction` inserts a row, `removeBandMemberAction` deletes B's membership row and `deleteBandAction` removes the band; as B (before removal), `getBandWithMembersAction` returns the band with its members and `getBandPlaylistsAction` returns its playlists.

ER7 - Playlist actions refuse non-owners, and change nothing. `npx vitest run src/app/actions/__tests__/authzPlaylists.db.test.ts` passes with 0 skipped, against the real database. Fixture: user A owns personal playlist P holding at least one song; user C is unrelated. Called as C, each of `updatePlaylistAction`, `deletePlaylistAction`, `removeSongFromPlaylistAction` and `addSongToPlaylistAction` rejects with a message containing `Access denied`, and afterwards `SELECT name, description, tags FROM playlists WHERE id = P` and `SELECT count(*) FROM playlist_songs WHERE playlist_id = P` both equal their pre-call values. Called as C, `getPlaylistWithSongsAction(P)` resolves to `null`, and `getPlaylistDetailsWithEntriesAction(P, null)` rejects with `Access denied`; called as A but passing a `bandId` A is not a member of, `getPlaylistDetailsWithEntriesAction` also rejects with `Access denied`. Authorized paths in the same file still work and return the same shapes as at `27e44a8`: as A, update / add song / remove song / read succeed on P, and a member of a band-owned playlist can update it.

ER8 - Band repertoire is no longer cross-tenant. `npx vitest run src/app/actions/__tests__/authzRepertoire.db.test.ts` passes with 0 skipped, against the real database. Fixture: band X with member A and at least one repertoire entry; user C is not a member. Called as C with `bandId` = X, every one of `getRepertoireAction`, `addSongAction`, `updateSongStatusAction`, `updateSongTagsAction`, `removeSongAction`, `getSongEntryAction`, `updateSongAction`, `createAndAddSongAction` and `updateLyricsAction` rejects with a message containing `Access denied`; and for the mutating ones, `SELECT id, song_id, status, tags, lyrics FROM repertoire WHERE band_id = X ORDER BY id` afterwards is deeply equal to the same query taken before the call. Called as A (a member) the same nine succeed and return the same shapes as at `27e44a8`.

ER9 - The shared catalog write is authorized and destructive changes go to moderation. In `src/app/actions/__tests__/authzRepertoire.db.test.ts`, with a global song S carrying at least one existing link and a repertoire entry R for S owned by user A: (a) with no session, `updateSongLinksAction` rejects with `Not authenticated` and `SELECT links FROM global_songs WHERE id = S` is unchanged; (b) called as user C who has no repertoire entry for S, it rejects with `Access denied` and the links are unchanged; (c) called with S's own `global_songs.id` in place of a repertoire id, it rejects (the id no longer resolves) and the links are unchanged; (d) called as A with the existing links plus one new URL, it resolves to `{ success: true }` with no truthy `pending`, `SELECT links FROM global_songs WHERE id = S` then contains the new URL, and `SELECT count(*) FROM global_song_edits WHERE song_id = S` is unchanged; (e) called as A with one existing link removed, it resolves to an object where `success` is `true` and `pending` is `true`, `SELECT links FROM global_songs WHERE id = S` is byte-identical to before the call, and exactly one new row exists with `SELECT status, requested_by, proposed_data FROM global_song_edits WHERE song_id = S ORDER BY created_at DESC LIMIT 1` returning `status` = `pending`, `requested_by` = A and `proposed_data->'links'` equal to the submitted list; (f) a system admin approving that row through `reviewGlobalSongEditAction(editId, 'approve')` then makes `SELECT links FROM global_songs WHERE id = S` match the submitted list. Additionally `npx vitest run src/lib/__tests__/noBrowserDialogs.test.ts` passes, and `grep -n "pending" "src/app/songs/[id]/fast-view/page.tsx"` shows the delete-link path branching on `pending` to keep the link visible and raise a Toast.

ER10 - Authorized behaviour is unchanged end to end. `npx vitest run src/app/actions/__tests__/bands.test.ts src/app/actions/__tests__/playlists.test.ts src/app/actions/__tests__/repertoire.test.ts src/app/actions/__tests__/tabs.test.ts src/app/actions/__tests__/thinActions.test.ts` passes with 0 failed. `npx next build` exits 0. Then, with `next start` running and the environment loaded from `.env.local`, `npx playwright test e2e/ssr-smoke.spec.ts` reports `4 passed` (same as `27e44a8`).

ER11 - Version bumped, landing page untouched. `package.json` `version` matches `0.1.NN-YYYYMMDDHHmm` and is strictly greater than `0.1.68-202609060011`. `git diff --stat 27e44a8 -- src/components/landing src/i18n/dictionaries` prints nothing: closing an authorization hole is a security fix, not a selling point, and the AGENTS.md Landing Page Rule excludes internal/operational changes from the landing copy.

ER12 - Change scope is contained and the schema is untouched. `git diff --name-only 27e44a8` lists only paths matching this whitelist: `src/app/actions/bands.ts`, `src/app/actions/playlists.ts`, `src/app/actions/repertoire.ts`, `src/app/actions/tabs.ts`, `src/lib/bands.ts`, `src/lib/playlists.ts`, `src/lib/songs.ts`, `src/app/songs/[id]/fast-view/page.tsx`, `src/app/actions/__tests__/*`, `src/lib/__tests__/*`, `docs/tasks/RH-34-spec.md`, `docs/suggestions-log.md`, `package.json`, `AGENTS.md`. `git diff 27e44a8 -- migrations` prints nothing.

## Out of Scope

Restated for the reviewer: F5 (Spotify route handlers), F4 (`withTransaction`),
F6/F8 (FastViewPage decomposition, moving all remaining SQL out of the action
layer), any migration, rate limiting, SSRF URL allow-listing, "last admin"
rules, and landing-page copy.
