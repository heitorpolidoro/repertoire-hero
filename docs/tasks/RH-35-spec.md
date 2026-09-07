# RH-35 - Authorize the Spotify playlist route handlers against the caller's own playlists

## Scope

Close finding F5 of `docs/plans/code-quality-review.md` (RH-25 T2): the route handlers
under `/api/spotify/playlists/[id]/*` authenticate the caller but never authorize the
resource they act on, so an authenticated user with any Spotify connection can drive a
destructive resync of a playlist that is not theirs, and can create a playlist owned by
a band they do not belong to.

This task covers:

- a shared authorization prologue in `src/lib/spotifyRouteAuth.ts` that resolves a local
  playlist id (or a body-supplied band id) to a row the caller is actually allowed to
  touch, reusing `assertPlaylistAccess()` from `src/lib/playlists.ts` and
  `assertBandMember()` from `src/lib/bands.ts` (both added by RH-34) rather than adding
  a third copy of the ownership predicate;
- wiring that prologue into `POST /api/spotify/playlists/[id]/sync` before any read or
  write, and into `POST /api/spotify/playlists/[id]/import` for the `band_id` it takes
  from the request body;
- documenting, in `GET /api/spotify/playlists/[id]/tracks` and in
  `src/lib/spotifyRouteAuth.ts`, why `tracks` has no local resource to authorize, and
  pinning that with a regression test;
- unit tests for the new prologue and a real-database suite that drives all three route
  handlers as a hostile caller and reads the database back.

This task does NOT change the schema, does not change any Server Action, does not change
the shape of any successful response, and does not touch `src/lib/playlists.ts` or
`src/lib/bands.ts` (their helpers are consumed as they are).

## Audit at 1c04a20

`git log --oneline -1` at the baseline is `1c04a20 fix(RH-34): fail-closed authorization
in every Server Action`. `package.json` version is `0.1.69-202609062259`.

### The shared prologue today

`src/lib/spotifyRouteAuth.ts:18` `resolveSpotifyRouteAccess()` answers exactly two
questions: is there a session (`getRequiredUserId()`), and does that user have a Spotify
access token (`getSpotifyAccessToken(userId)`). It returns `{ ok: true, userId,
accessToken }` or a 401 response. Its own doc comment is accurate: it says nothing about
the playlist in the URL. Nothing else in the three routes says anything about it either.
That is the whole of F5: authentication was factored out cleanly and authorization was
never written.

### The three `[id]` routes, and what `[id]` actually means

The path parameter is not the same kind of id in all three routes, which is why the fix
is not the same in all three:

- `sync/route.ts` - `[id]` is a **local** `playlists.id` (UUID). Confirmed by the two
  call sites `src/app/playlists/[id]/page.tsx:451` and `:582`, which pass the local
  `playlistId`.
- `import/route.ts` - `[id]` is a **Spotify** playlist id. Confirmed by
  `src/app/playlists/page.tsx:235`, which passes `pendingImport.playlist.id`, an id that
  came back from `GET /api/spotify/playlists`. There is no local playlist yet; the route
  creates one.
- `tracks/route.ts` - `[id]` is a **Spotify** playlist id, forwarded straight to
  `fetchAllSpotifyTracks(id, accessToken)`. The route has no UI caller in the tree today
  (`grep -rn "api/spotify/playlists" src e2e` finds none for `/tracks`).

### sync: the destructive hole

`src/app/api/spotify/playlists/[id]/sync/route.ts:39` runs `SELECT * FROM playlists WHERE
id = $1` on the raw path parameter and 404s only if the row does not exist. Ownership is
never consulted. On `direction: 'pull'` the handler then:

1. reads `playlist.band_id` (line 63) and builds `owner` from it, so the victim's band
   becomes the write target;
2. calls `findOrCreateGlobalSong(track)` and `ensureInRepertoire(songId, owner)` per track
   (lines 71-78), which for a band owner inserts a `repertoire` row for the band **and one
   for every member of that band** (`src/lib/spotifyPlaylistSync.ts:145-159`);
3. runs `DELETE FROM playlist_songs WHERE playlist_id = $1` (line 93) and re-inserts the
   attacker's Spotify track list in its place;
4. stamps `UPDATE playlists SET last_synced_at = now(), updated_at = now()` (line 167).

So `POST /api/spotify/playlists/<victim-playlist-uuid>/sync` with `{"direction":"pull"}`,
sent by any authenticated user who has connected any Spotify account, replaces the
contents of that playlist with the attacker's Spotify data and pollutes every band
member's personal repertoire. `direction: 'push'` is the mirror image: it reads the
victim's playlist song list (lines 101-107) and writes it into a Spotify playlist the
attacker controls, which is a read-exfiltration of the victim's setlist. Both are
reachable with a single `curl` and a valid session cookie.

### import: the band_id hole

`src/app/api/spotify/playlists/[id]/import/route.ts:40` takes `band_id` from the request
body and uses it unverified in two places: `owner = bandId ? { bandId } : { userId }`
(line 71), feeding `ensureInRepertoire`, and the `INSERT INTO playlists (user_id, band_id,
...)` at lines 81-95. An authenticated user can therefore create a playlist owned by any
band whose id they know, and insert repertoire rows for that band and every one of its
members - the same blast radius as the sync hole, reached through the body instead of the
path. This is the same class of defect as F3 (`resolveOwner` trusting a client-supplied
`bandId`), which RH-34 fixed in the actions layer and did not reach here.

### tracks: no local resource

`tracks/route.ts` issues zero database statements. It forwards a Spotify playlist id to
the Spotify Web API using the **caller's own** access token, and Spotify decides what that
token may read. There is no local row to own and no privilege the caller does not already
have by calling `api.spotify.com` directly with the same token. The correct change here is
therefore not a new check but a documented rationale plus a regression test proving the
route performs no database write, so a future edit that starts reading local playlists by
this id has to confront the question. If a hostile caller passes a local playlist UUID,
Spotify answers 404 and the route returns its fixed `Failed to fetch playlist tracks`
500 - no local state is read or changed.

### The collection route

`src/app/api/spotify/playlists/route.ts` has no path parameter and calls
`https://api.spotify.com/v1/me/playlists` with the caller's own token: the resource is
scoped to the caller by construction. It needs no change and is deliberately excluded
from the whitelist in ER12.

## Approach

### 1. `src/lib/spotifyRouteAuth.ts` - two new exported guards

Keep `resolveSpotifyRouteAccess()` exactly as it is (it is correct for what it claims) and
add, in the same file and the same result-or-response style:

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PlaylistRouteAccess =
  | { ok: true; playlist: { id: string; user_id: string | null; band_id: string | null } }
  | { ok: false; response: NextResponse }

export async function resolveOwnedPlaylist(
  localPlaylistId: string,
  userId: string,
): Promise<PlaylistRouteAccess>

export type BandRouteAccess = { ok: true } | { ok: false; response: NextResponse }

export async function resolveBandOwnership(
  bandId: string,
  userId: string,
): Promise<BandRouteAccess>
```

`resolveOwnedPlaylist`:

- if `!UUID_RE.test(localPlaylistId)`, return the 404 immediately without touching the
  database (a malformed id cannot name a playlist the caller may reach, and letting it
  reach Postgres would turn into a `22P02` 500 that distinguishes malformed from foreign);
- otherwise `await assertPlaylistAccess(localPlaylistId, userId)` from `@/lib/playlists`
  and return `{ ok: true, playlist: row }`;
- catch: if the message starts with `Access denied`, return the 404; anything else is a
  genuine failure - `logger.error('[spotify/playlists/authz]', err, { localPlaylistId })`
  and return the 500.

`resolveBandOwnership` is the same shape over `assertBandMember(bandId, userId)` from
`@/lib/bands`, with `{ error: 'Band not found', code: 404 }` as its refusal body.

Response bodies, fixed and identical for every refusal reason:

| case | status | body |
| --- | --- | --- |
| playlist not reachable, or malformed id | 404 | `{ "error": "Playlist not found", "code": 404 }` |
| band not reachable, or malformed id | 404 | `{ "error": "Band not found", "code": 404 }` |
| unexpected error inside the guard | 500 | `{ "error": "Unexpected error authorizing this request", "code": 500 }` |

**404, not 403, and why.** `assertPlaylistAccess` was deliberately written to throw the
same message for a foreign playlist and for a non-existent one, so existence is not
leaked. Answering 403 for "exists but not yours" and 404 for "does not exist" would put
that leak back at the HTTP layer. 404 also matches what `sync/route.ts:41` already
answers for a missing playlist, so no UI string changes: both call sites in
`src/app/playlists/[id]/page.tsx` just surface `body.error`.

Both guards follow convention R1 (fixed message plus `code`, never the raw exception
text) and neither uses `catch (x: any)`.

### 2. `sync/route.ts`

After `resolveSpotifyRouteAccess()` and before anything else that touches the database:

```ts
const playlistAccess = await resolveOwnedPlaylist(localPlaylistId, userId)
if (!playlistAccess.ok) return playlistAccess.response
const { playlist } = playlistAccess
```

Body parsing may stay where it is (it touches no state). Then inside the existing `try`:

- replace `SELECT * FROM playlists WHERE id = $1` and its now-unreachable `rowCount === 0`
  404 with a narrow `SELECT spotify_playlist_id FROM playlists WHERE id = $1` (the row is
  guaranteed to exist because the guard returned it);
- take `band_id` for the `owner` computation from `playlist.band_id` returned by the
  guard, not from a second read;
- leave the `spotify_playlist_id` null check (400, `Playlist is not linked to a Spotify
  playlist`), the pull/push bodies, the `last_synced_at` stamp and the response
  `{ added, removed }` byte-identical to the baseline.

### 3. `import/route.ts`

After the body is parsed and before the first Spotify `fetch`:

```ts
if (bandId) {
  const bandAccess = await resolveBandOwnership(bandId, userId)
  if (!bandAccess.ok) return bandAccess.response
}
```

Nothing else changes: with no `band_id` the playlist is still created for `userId` from
the session, which was already correct. The guard runs before the Spotify metadata fetch
so a refused call generates no outbound traffic either.

### 4. `tracks/route.ts`

No behavioural change. Add a header comment recording that `[id]` is a Spotify playlist
id, that authorization is Spotify's (the caller's own token), and that the route must stay
free of local playlist reads - the ER12 whitelist allows the file to appear in the diff
for exactly this.

**The comment must not contain the literal strings `query` or `@/lib/db`.** ER8 proves the
absence of SQL with `grep -n "query\|@/lib/db"` over the whole file, and grep does not know
a comment from code: a rationale that names the forbidden symbols would fail the very check
it exists to explain. Phrase the prohibition in prose ("local reads and writes", "the local
database") and point at the guard by name instead. Wording that satisfies both:

```ts
// [id] here is a SPOTIFY playlist id, not a local playlists.id. Authorization is
// Spotify's: the id is forwarded with the caller's own access token, so this route
// grants nothing the caller could not obtain by calling api.spotify.com directly.
// There is therefore no local row to authorize - and this handler must stay that way.
// If it ever starts resolving a local playlist row by this id, the guard to add first
// is resolveOwnedPlaylist() in src/lib/spotifyRouteAuth.ts.
```

### 5. Tests

**`src/lib/__tests__/spotifyRouteAuth.test.ts`** (new, no database). Mocks `@/lib/playlists`,
`@/lib/bands`, `@/lib/logger`, and also `@/lib/auth-session` (`getRequiredUserId`) and
`@/lib/spotifyAuth` (`getSpotifyAccessToken`). Cases: `resolveOwnedPlaylist` returns
`{ ok: true }` with the row on success; returns the 404 body when `assertPlaylistAccess`
rejects with `Access denied: not allowed on this playlist`; returns the same 404 for
`'not-a-uuid'` **without calling** `assertPlaylistAccess` (assert the mock has 0 calls);
returns the 500 body and calls `logger.error` once when the helper rejects with `Failed to
authorize playlist access: boom`. Mirror cases for `resolveBandOwnership` over
`assertBandMember`.

The same file also covers the two refusal branches of the **pre-existing**
`resolveSpotifyRouteAccess()` - `getRequiredUserId()` rejecting (401 `Unauthorized`) and
`getSpotifyAccessToken()` resolving `null` (401 `Spotify not connected`) - which the route
tests never reach because they mock both helpers into their happy path. Without these two
cases the module's two `return` statements at `spotifyRouteAuth.ts:24-27` and `:33-39`
stay uncovered and the file measures 28/30 = 93.33 statements, below ER3's floor; with
them the row is 100 / 100 and the floor is satisfied with margin. This file is inside
`coverage.include` (`src/lib/**/*.ts`) and is what lifts the `spotifyRouteAuth.ts` coverage
row off its 71.42 / 50 baseline.

**`src/lib/__tests__/spotifyPlaylistRouteAuthz.db.test.ts`** (new, real database, guarded
by `describe.skipIf(!SERVICE_ROLE_KEY)` like `src/app/actions/__tests__/authz*.db.test.ts`).
It imports the three route handlers by their `@/app/api/...` paths, exactly as
`src/lib/__tests__/spotify.test.ts:58-59` already does. Mocks: `@/lib/auth-session`
(`getRequiredUserId`) so the caller can be switched per test, `@/lib/spotifyAuth`
(`getSpotifyAccessToken`) so every caller has a token without inserting `spotify_tokens`
rows, `@/lib/logger`, and `global.fetch` with a spy that answers **by URL shape, because
the import route reads two different Spotify documents**:

- a URL containing `?fields=name,description,images` (the playlist-metadata read at
  `import/route.ts:47-50`) answers 200 with
  `{ name: 'RH-35 Spotify Fixture', description: null, images: [] }`;
- a URL whose path ends in `/tracks` (the paginated read in `fetchAllSpotifyTracks`, and
  the `PUT .../tracks` of a push) answers 200 with a one-track page:
  `{ items: [{ track: { id: 'rh35track1', name: 'RH-35 Track', duration_ms: 180000,
  artists: [{ name: 'RH-35 Artist' }], album: { name: 'RH-35 Album', images: [] },
  external_urls: { spotify: 'https://open.spotify.com/track/rh35track1' } } }],
  next: null }`;
- any other `api.spotify.com` URL answers 200 with `{}`.

A single one-track-page answer for *every* URL would break the import path rather than
exercise it: `import/route.ts:56-62` takes `meta.name` from the metadata response, a tracks
page has no `name`, and `playlists.name` is `NOT NULL`
(`migrations/0001_initial_schema.sql:244`), so the insert would fail and ER10's 201 would
come back as the route's catch-all 500. Fixture built in `beforeAll` with `createTestUser` /
`createAdminTestClient` / `deleteTestUser` from `src/lib/__tests__/test-helpers.ts` and
`createTestSong` from `src/app/actions/__tests__/authzFixtures.ts`:

- users A, B, C; band Y with A as admin and B as member; band Z with C alone;
- personal playlist P owned by A, `spotify_playlist_id = 'rh35-spotify-p'`,
  `sync_with_spotify = true`, holding song S1 at position 1;
- band playlist PB owned by band Y, `spotify_playlist_id = 'rh35-spotify-pb'`, empty.

Every negative case snapshots the database before the call and reads it back after, and
also asserts the fetch spy recorded no `api.spotify.com` call, which is what proves the
refusal happened before any side effect rather than after a rollback that does not exist
(there is none - see Out of Scope). `afterAll` deletes the bands, users and songs it
created, in that order.

## Expected Results

ER1 - Static gates unchanged from the `1c04a20` baseline. From the repo root on the task branch: `npx tsc --noEmit` exits 0 and writes nothing at all to stdout or stderr (zero bytes of diagnostic output, as at `1c04a20`); `npx eslint .` reports exactly 30 problems, 12 errors and 18 warnings, in its summary line (no new lint problem); `npm run lint:dead` exits 0 with no `Unused` section; `npm run lint:dup` exits 0 and reports at most 21 clones (baseline 19 clones / 239 duplicated lines / 1.02 %, threshold 2 %); `npm run audit` prints `found 0 vulnerabilities`.

ER2 - The whole suite grows and nothing skips. With Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with `npm run db:migrate` applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, `npx vitest run` reports `Test Files N passed (N)` with N >= 47, `Tests M passed (M)` with M >= 612, 0 failed and 0 skipped (baseline at `1c04a20`: 45 files / 601 tests / 0 skipped). Both of these files exist and are among the passing files: `src/lib/__tests__/spotifyRouteAuth.test.ts` and `src/lib/__tests__/spotifyPlaylistRouteAuthz.db.test.ts`.

ER3 - The coverage gate still passes and the new guard is covered. `npm run test:coverage` exits 0 (thresholds statements 80 / branches 65 / functions 78 / lines 80) and its `All files` row shows statements >= 93.66, branches >= 78.34, functions >= 98.78 and lines >= 94.11 (the values at `1c04a20`). In the same table, the row whose file name ends in `spotifyRouteAuth.ts` shows statements >= 95 and branches >= 85 (baseline at `1c04a20`: 71.42 statements / 50 branches).

ER4 - The authorization guards are a unit, with fixed refusal bodies. `npx vitest run src/lib/__tests__/spotifyRouteAuth.test.ts` passes with at least 10 tests and 0 failed, against mocked `@/lib/playlists`, `@/lib/bands`, `@/lib/auth-session` and `@/lib/spotifyAuth`. It asserts all of: `resolveOwnedPlaylist(id, user)` resolves to `{ ok: true, playlist }` carrying the row when `assertPlaylistAccess` resolves; when `assertPlaylistAccess` rejects with `Access denied: not allowed on this playlist`, it resolves to `{ ok: false }` whose `response.status` is 404 and whose `await response.json()` deep-equals `{ error: 'Playlist not found', code: 404 }`; for the input `'not-a-uuid'` it returns that same 404 while the `assertPlaylistAccess` mock records exactly 0 calls; when `assertPlaylistAccess` rejects with `Failed to authorize playlist access: boom` it returns status 500 with body `{ error: 'Unexpected error authorizing this request', code: 500 }` and `logger.error` is called exactly once with the tag `[spotify/playlists/authz]`. The same four assertions hold for `resolveBandOwnership` over `assertBandMember`, with refusal body `{ error: 'Band not found', code: 404 }`. The same file also covers both refusal branches of the pre-existing `resolveSpotifyRouteAccess()`, which no other test reaches: with `getRequiredUserId` mocked to reject, it resolves to `{ ok: false }` whose `response.status` is 401 and whose `await response.json()` deep-equals `{ error: 'Unauthorized', code: 401 }`; with `getRequiredUserId` resolving a user id and `getSpotifyAccessToken` resolving `null`, it resolves to `{ ok: false }` with `response.status` 401 and body `{ error: 'Spotify not connected', code: 401 }`.

ER5 - A hostile sync is refused before it touches anything. In `npx vitest run src/lib/__tests__/spotifyPlaylistRouteAuthz.db.test.ts` (passing, 0 skipped, real database), with fixture: users A, B and C; band Y with A as admin and B as member; band Z with C alone; personal playlist P owned by A with `spotify_playlist_id = 'rh35-spotify-p'`, `sync_with_spotify = true` and song S1 at position 1; band playlist PB owned by band Y; `@/lib/auth-session` and `@/lib/spotifyAuth` mocked so any chosen user is the caller and always has a Spotify token; and `global.fetch` spied so that a URL containing `?fields=name,description,images` (the import route's playlist-metadata read) answers 200 with `{ name: 'RH-35 Spotify Fixture', description: null, images: [] }`, a URL whose path ends in `/tracks` answers 200 with a one-track page (a single `items` entry whose `track` carries `id`, `name`, `duration_ms`, `artists`, `album` and `external_urls`, plus `next: null`), and any other `api.spotify.com` URL answers 200 with `{}`; the metadata and tracks answers must be distinct documents, because `playlists.name` is `NOT NULL` and the import route takes that name from the metadata document, so a tracks page served for both would turn ER10's 201 into a 500. Calling the exported `POST` of `src/app/api/spotify/playlists/[id]/sync/route.ts` with body `{"direction":"pull"}` as user C, once with `params` resolving to P, once with PB, and once with the non-existent but well-formed UUID `00000000-0000-0000-0000-0000000000ff`, returns status 404 in all three cases and `await response.json()` deep-equals `{ error: 'Playlist not found', code: 404 }` in all three (byte-identical for the foreign and the non-existent id, so existence is not leaked). After each of the three calls: `SELECT song_id, position FROM playlist_songs WHERE playlist_id = P ORDER BY position` still returns exactly one row with `song_id` = S1 and `position` = 1; `SELECT last_synced_at, updated_at FROM playlists WHERE id = P` is deeply equal to the values read before the call; `SELECT count(*)::int FROM playlist_songs WHERE playlist_id = PB` is still 0; and the fetch spy recorded 0 calls to any URL containing `api.spotify.com`.

ER6 - A hostile push is refused too. In the same file and with the same fixture, calling that same `POST` with body `{"direction":"push"}` as user C with `params` resolving to P returns status 404 with body `{ error: 'Playlist not found', code: 404 }`, the fetch spy records 0 calls to any URL containing `api.spotify.com` (so the victim's setlist is never written into an attacker-controlled Spotify playlist), and `SELECT last_synced_at, updated_at FROM playlists WHERE id = P` is unchanged from before the call.

ER7 - Import cannot create a playlist for a band the caller is not in. In the same file, calling the exported `POST` of `src/app/api/spotify/playlists/[id]/import/route.ts` as user C with `params` resolving to `{ id: 'rh35-spotify-import' }` and body `{"sync_with_spotify":true,"band_id":"<band Y id>"}` returns status 404 and `await response.json()` deep-equals `{ error: 'Band not found', code: 404 }`. Afterwards `SELECT count(*)::int FROM playlists WHERE band_id = <band Y id>` equals the count taken before the call, `SELECT count(*)::int FROM repertoire WHERE band_id = <band Y id>` equals its pre-call count, `SELECT count(*)::int FROM repertoire WHERE user_id = <user B id>` equals its pre-call count (no member's personal repertoire was polluted), and the fetch spy recorded 0 calls to any URL containing `api.spotify.com`. The same call with `band_id` set to the well-formed but non-existent UUID `00000000-0000-0000-0000-0000000000ff` returns the identical 404 body.

ER8 - The tracks route reads Spotify and never the local database. In the same file, calling the exported `GET` of `src/app/api/spotify/playlists/[id]/tracks/route.ts` as user C with `params` resolving to P (a local playlist UUID belonging to user A) leaves the database untouched: `SELECT song_id, position FROM playlist_songs WHERE playlist_id = P ORDER BY position` and `SELECT last_synced_at, updated_at FROM playlists WHERE id = P` both equal their pre-call values, and `SELECT count(*)::int FROM playlists WHERE user_id = <user C id>` equals its pre-call value. Independently, `grep -n "query\|@/lib/db" "src/app/api/spotify/playlists/[id]/tracks/route.ts"` prints nothing, proving the handler issues no SQL at all.

ER9 - The owner and a band member still sync exactly as before. In the same file, calling the sync `POST` with `{"direction":"pull"}` as user A with `params` resolving to P returns status 200 and a JSON body with numeric `added` and `removed` properties and no `error` property; afterwards `SELECT song_id, position FROM playlist_songs WHERE playlist_id = P ORDER BY position` matches the single track the mocked Spotify page returned, at position 1, and `SELECT last_synced_at FROM playlists WHERE id = P` is not null and is strictly greater than the value read before the call. Calling the same handler as user B (a member, not the owner, of band Y) with `params` resolving to the band playlist PB also returns status 200 with numeric `added` and `removed`, and afterwards `SELECT count(*)::int FROM playlist_songs WHERE playlist_id = PB` is 1.

ER10 - The authorized import paths and the pre-existing route tests are unchanged. In the same file, calling the import `POST` as user A with body `{"sync_with_spotify":false}` and no `band_id` returns status 201 with a JSON body whose `user_id` equals user A's id and whose `band_id` is null; calling it as user B with body `{"sync_with_spotify":false,"band_id":"<band Y id>"}` returns status 201 with a body whose `band_id` equals band Y's id and whose `user_id` is null. Separately, `npx vitest run src/lib/__tests__/spotify.test.ts src/lib/__tests__/spotifyPlaylistSync.test.ts src/lib/__tests__/errorHandlingStyle.test.ts src/lib/__tests__/noBrowserDialogs.test.ts` passes with 0 failed and 0 skipped, `npx next build` exits 0, and then with `next start` running and the environment loaded from `.env.local`, `npx playwright test e2e/ssr-smoke.spec.ts` reports `4 passed` (same as `1c04a20`).

ER11 - Version bumped, landing page untouched. `package.json` `version` matches `0.1.NN-YYYYMMDDHHmm` and is strictly greater than `0.1.69-202609062259`. `git diff --stat 1c04a20 -- src/components/landing src/i18n/dictionaries` prints nothing: closing an authorization hole is a security fix, not a selling point, and the AGENTS.md Landing Page Rule excludes internal and operational changes from the landing copy.

ER12 - Change scope is contained and the schema is untouched. `git diff --name-only 1c04a20` lists only paths drawn from this whitelist, and no others: `src/lib/spotifyRouteAuth.ts`, `src/app/api/spotify/playlists/[id]/sync/route.ts`, `src/app/api/spotify/playlists/[id]/import/route.ts`, `src/app/api/spotify/playlists/[id]/tracks/route.ts`, `src/lib/__tests__/spotifyRouteAuth.test.ts`, `src/lib/__tests__/spotifyPlaylistRouteAuthz.db.test.ts`, `docs/tasks/RH-35-spec.md`, `docs/suggestions-log.md`, `package.json`, `AGENTS.md`. In particular `src/lib/playlists.ts`, `src/lib/bands.ts` and `src/app/api/spotify/playlists/route.ts` are absent from that output, and `git diff 1c04a20 -- migrations` prints nothing.

## Out of Scope

- **Atomicity of the pull resync.** `sync/route.ts` deletes every `playlist_songs` row and
  re-inserts outside any transaction, so a failure between the two leaves the playlist
  empty. That is finding F4 and is tracked as RH-36; this task must not introduce
  `withTransaction` or otherwise widen into it. The ERs above deliberately assert that a
  refused call never reaches the delete, which is what makes the two tasks independent.
- **`src/app/api/spotify/playlists/route.ts`** (the collection route): no path parameter,
  scoped to the caller's own token by construction. No change.
- **Deleting the unused `tracks` route.** It has no UI caller today, but removing a public
  endpoint is a separate decision with its own compatibility question.
- **Rate limiting, CSRF and Spotify token scope review** for these endpoints.
- **The Server Actions layer**, fixed by RH-34 and not re-opened here.
- **Findings F1, F2, F3, F6, F7, F8** of `docs/plans/code-quality-review.md`.

## Post-merge checks (orchestrator)

- The `Coverage (vitest)`, `Duplication (jscpd)`, `dead-code` and `Dependency audit (npm
  audit)` GitHub Actions jobs are green on the merge commit.
- The Vercel production deployment succeeds and `/playlists` still imports and syncs a
  Spotify playlist for the deploying user.
- SonarCloud and DeepSource report no new issue of severity high or above on the changed
  files.
