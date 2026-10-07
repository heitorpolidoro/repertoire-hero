# RH-126 — Enforce that one write reaches exactly one owner

Part 6 of 6 of the RH-105 split. `blockedBy: RH-125`, done; RH-121…RH-125 are in production.

## Scope

Two call sites write two owners for one act. This task deletes both, leaves the three
deliberate per-musician exceptions intact, and inverts the five existing tests that
currently assert the fan-out as correct behaviour.

**In scope** — the two violating writes, verified against the tree at `c27c611`:

1. `src/lib/spotifyPlaylistSync.ts:195-200` — the band branch of `ensureInRepertoire`
   writes the `band_songs` row (lines 190-194) **and then a `user_songs` row for every
   row of `band_members` for that band** (`INSERT INTO user_songs (user_id, version_id,
   status) SELECT bm.user_id, $1, 'unknown' FROM band_members bm WHERE bm.band_id = $2`).
   Reached from `src/app/api/spotify/playlists/[id]/import/route.ts:90` and
   `src/app/api/spotify/playlists/[id]/sync/route.ts:80`, once per track. The file's own
   comment at lines 178-179 already names this statement as RH-126's deliverable.
2. `src/lib/playlists.ts:190` — the band branch of `addSongToPlaylist` writes
   `seedOwnerSongSql('band_songs', 'band_id')` for the playlist's band (line 189) **and
   `seedOwnerSongSql('user_songs', 'user_id')` for the acting user** (line 190). Reached
   from `addSongToPlaylistAction` (`src/app/actions/playlists.ts:50`). Comment at lines
   173-175 names it.

Only the second statement of each pair goes. The band row, the `playlist_songs` insert,
the enclosing `withTransaction`, the `ON CONFLICT DO NOTHING` arbiters and every
authorization check stay exactly as they are.

**Also in scope** — documentation, the stale comments at `src/lib/playlists.ts:173-175`
and `:187` and `src/lib/spotifyPlaylistSync.ts:178-179` (all of which currently describe
the dual write as deliberate and current), and the **five** stale test assertions that
encode the fan-out as correct behaviour (see *Approach*).

## Out of scope

- **No migration, and no backfill.** The violating rows already in production are
  `user_songs` rows indistinguishable from rows a member added for themselves; there is
  no column recording provenance in `migrations/0016`, so a cleanup would destroy
  legitimate holds. The task is code-only.

  **The consequence is permanent and worth stating plainly rather than leaving as an
  Out-of-scope line:** every member row that past Spotify imports and past band-playlist
  adds already fanned out stays in production forever, holding a version the member never
  chose, and **no expected result in this task detects one**. The one-owner rule therefore
  becomes true of every *future* write and remains false of the existing data. The
  musician-visible symptom is a personal repertoire carrying songs only their band plays.
  Follow-up task to raise: *"Offer each member a review of the band-imported rows in their
  personal repertoire"* — an opt-in list the member prunes themselves, which is the only
  form of cleanup that cannot delete a hold they actually wanted. Deciding whether that is
  worth building is the operator's call, not this task's.

  If implementation finds a migration unavoidable after all, the prefix is
  the next free one read from `migrations/` at implementation time —
  `src/lib/__tests__/migrationsSingleSource.test.ts` requires prefixes unique and
  contiguous from `0001`, so no number may be quoted in advance.
- The `owners` supertype (named out of scope by the task's justification).
- Building a "practised it" control. **No practice write path exists in the tree**:
  `grep -rni 'practis|recordPractice|markPractic' src` returns nothing outside the
  `last_practiced` column name itself. `last_practiced` is a readable column, a member of
  `OWNER_SONG_COLUMNS` (`src/lib/ownerSongRows.ts:32`) and reachable through
  `updateSongOverrides`, and that is all. This task asserts the *mechanism* is
  single-owner; the button is someone else's task.
- Renaming the `repertoire` TypeScript vocabulary (logged in `docs/suggestions-log.md`).
- Any change to `assertBandAdmin`, `assertPlaylistAccess` or `resolveOwner`.

## Approach

### Behavior

- A band-context write reaching either call site creates **exactly one** `band_songs` row
  for that `(band_id, version_id)` and **zero** `user_songs` rows for that `version_id` —
  for the acting admin and for every other member alike.
- A personal-context write creates exactly one `user_songs` row and zero `band_songs`
  rows for that version.
- The playlist entry still lands: removing the second seed must not disturb step 3 of
  `addSongToPlaylist` or the routes' `playlist_songs` inserts.
- The three exceptions keep writing the musician's own row in band context, unchanged:
  - **Upload a file** — `ensureOwnEntry` (`src/app/actions/tabs.ts:55`) reads
    `getPersonalEntryForSong` and, when absent, calls `addSongToRepertoire({ userId },
    songId)`. Always the uploader, never the band, because `song_files` has no `band_id`.
  - **Lyrics against your own version** — `resolveLyricsSaveTarget`
    (`src/lib/lyricsEditor.ts:107`) answers `{ bandId: null, toPersonalEntry: true }` for
    a band entry with `version === 'personal'`, and `useLyricsEditor.save` creates the
    personal row through `addSong(songId, null)`
    (`src/app/fastViewLyricsActions.ts:19`) when `repertoireId` is null.
  - **Practised it** — a `last_practiced` patch through `updateSongOverrides` writes
    `ownerTable(owner)` and nothing else; the non-admin member's patch resolves to their
    own `user_songs` row and leaves `band_songs.last_practiced` untouched.
- Binding constraints unchanged: every band repertoire write still requires band admin
  (`assertBandAdmin`); catalog removal stays admin-master only; nothing shared is visible
  before moderation approval. None of those paths is touched.

### Files touched

| File | Change |
|---|---|
| `src/lib/spotifyPlaylistSync.ts` | delete the member fan-out `INSERT` in `ensureInRepertoire`'s band branch; rewrite the lines 178-179 comment ("…is the dual / write RH-126 removes. It is repointed here, not deleted.") to state the rule as settled |
| `src/lib/playlists.ts` | delete the caller's `user_songs` seed from `addSongToPlaylist`'s band branch; rewrite the lines 173-175 comment ("**The dual write stays**, as a decision and not an oversight") and the inline comment at line 187 ("— until RH-126 —") |
| `src/lib/__tests__/spotifyPlaylistSync.test.ts` | **stale 1** — invert the test at line 250, one statement for a band owner, not two |
| `src/lib/__tests__/spotifySyncAtomicity.db.test.ts` | **stale 2** — invert the test at line 206, band row only, members untouched |
| `src/lib/__tests__/playlists.test.ts` | **stale 3** — rename the test at line 208 (currently promises propagation) and invert assertion B at lines 255-262; **stale 4** — the test at line 292, `refuses a non-admin member adding to a band playlist, writing neither row (RH-124 ER19)`, re-runs the add as the band admin at line 333 and asserts the admin's `user_songs` row `toHaveLength(1)` at lines 342-349: that becomes `0`. Its refusal half (lines 325-331) asserts `band_songs` 0 and `playlist_songs` 0 but **never** `user_songs` 0 — add it. Also drop the "dual write is unchanged" preamble at lines 199-202 |
| `src/lib/__tests__/spotify.test.ts` | **stale 5** — invert the loop at lines 479-485 asserting both members hold a row after a band import; rewrite the comment at line 473 |
| `src/lib/__tests__/oneOwnerPerWrite.db.test.ts` | **new** — the conservation identity against real Postgres, gated on `RUN_DB_TESTS` |
| `AGENTS.md` | line 52: the three playlist-side paths create the band's row **only**; no member row is created sideways |
| `package.json` | version bump |

`src/lib/playlists.ts` is **383 lines against the base `max-lines: 400`**
(`eslint.config.mjs:49`) — 17 lines of headroom, and this change is net-deleting, so no
new override is needed and none may be added: the override block holds **14 entries
against `MAX_OVERRIDES = 17`** (`src/lib/__tests__/complexityBudget.test.ts:54`) and is a
ratchet that may only shrink. `src/lib/spotifyPlaylistSync.ts` is 266 lines and also
shrinks. Test files are capped at 800; the four edited ones are 382 / 232 / 503 / and
`spotify.test.ts` carries a `max-lines: 678` override that must not grow.

### Test criteria

A new `src/lib/__tests__/oneOwnerPerWrite.db.test.ts` on the precedent of
`src/lib/__tests__/ownerSongsMigration.db.test.ts` and `ownerSongs.db.test.ts`:
`const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''` and
`describe.skipIf(!RUN_DB_TESTS)`. Every band fixture it builds carries **at least two
members** — the acting admin plus one plain member — because a one-member band makes the
fan-out invisible, and the counts it takes are over the whole `version_id` rather than
over the actor, because a per-actor count leaves the other members' rows unmeasured.
Unit-level statement counting against a mocked `query` stays in
`spotifyPlaylistSync.test.ts`, which is where the shape of the SQL is pinned.

**Every DB-backed assertion names its own `RUN_DB_TESTS=1` run.** `npm run test:coverage`
is plain `vitest run --coverage` with no `RUN_DB_TESTS` in the environment, and all four
DB suites this task touches are gated — `spotifySyncAtomicity.db.test.ts:52`,
`playlists.test.ts:39` and `spotify.test.ts:49` are each `describe.skipIf(...)` over the
whole file. "Contains a passing test named X" is satisfied by a file skipped in its
entirety, so each ER demands `0 failed and 0 skipped` from an explicit gated invocation.

**`ensureOwnEntry` stays unexported, and no expected result may require otherwise.**
`src/app/actions/tabs.ts` line 1 is `'use server'`, so every exported function in that
module is a Server Action reachable by any authenticated client. `ensureOwnEntry(userId,
songId)` takes the user id as a *parameter* instead of reading `getRequiredUserId()`;
exporting it to make it directly testable would publish an endpoint that seeds a
`user_songs` row for an arbitrary caller-supplied `userId`. The upload exception is
therefore tested through `uploadTabAction(formData)` with the blob client mocked, which
is the only reading of ER10 that does not trade a test affordance for a privilege
escalation.

## Expected Results

- [ ] ER1 — `src/lib/__tests__/oneOwnerPerWrite.db.test.ts` exists, reads
  `process.env.RUN_DB_TESTS` and guards its suites with `describe.skipIf(!RUN_DB_TESTS)`;
  `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/oneOwnerPerWrite.db.test.ts` exits 0
  with 0 failed and 0 skipped tests.
- [ ] ER2 — That file contains a passing test named
  `adding to a band playlist writes the band row and no member row` which seeds a band
  with two members (the actor as `role = 'admin'`, a second user as `role = 'member'`),
  a band-owned playlist and a catalog song with one version, calls
  `addSongToPlaylist(playlistId, adminUserId, versionId)`, and then asserts all three of:
  `SELECT count(*)::int FROM band_songs WHERE band_id = <band> AND version_id = <version>`
  is `1`; `SELECT count(*)::int FROM user_songs WHERE version_id = <version>` is `0` (the
  count is over every user, not just the actor); and
  `SELECT count(*)::int FROM playlist_songs WHERE playlist_id = <playlist> AND version_id = <version>`
  is `1`.
- [ ] ER3 — The same file contains a passing test named
  `adding to a personal playlist writes the user row and no band row` which calls
  `addSongToPlaylist` on a user-owned playlist and asserts
  `SELECT count(*)::int FROM user_songs WHERE user_id = <actor> AND version_id = <version>`
  is `1`, `SELECT count(*)::int FROM band_songs WHERE version_id = <version>` is `0`, and
  the `playlist_songs` row exists.
- [ ] ER4 — `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/spotifySyncAtomicity.db.test.ts`
  exits 0 with 0 failed and **0 skipped** tests (the file is `describe.skipIf`-gated, so a
  run without `RUN_DB_TESTS` proves nothing). That file no longer contains a test
  named `seeds the band row and every member repertoire row on a pull`; in its place a
  passing test named `seeds the band row and no member row on a pull` pulls a one-track
  Spotify playlist into a band playlist whose band has **three** members, asserts the
  JSON response body equals `{"added":1,"removed":0}`, asserts
  `SELECT count(*)::int FROM band_songs WHERE band_id = <band> AND version_id = <version>`
  is `1`, and asserts `SELECT count(*)::int FROM user_songs WHERE version_id = <version>`
  is `0`.
- [ ] ER5 — `src/lib/__tests__/oneOwnerPerWrite.db.test.ts` contains a passing test named
  `a personal Spotify import writes only the importer's rows` which runs the import
  route's `POST` in personal context over a two-track playlist and asserts
  `SELECT count(*)::int FROM user_songs WHERE user_id = <actor>` increased by exactly `2`
  and `SELECT count(*)::int FROM band_songs` is unchanged by the call.
- [ ] ER6 — `src/lib/__tests__/spotifyPlaylistSync.test.ts` no longer contains a test
  named `issues exactly two statements for a band owner regardless of member count`; in
  its place a passing test named `issues exactly one statement for a band owner` asserts
  `mockedQuery` is called **exactly once** for
  `ensureInRepertoire('version-1', { bandId: 'band-1' })`, that the one SQL string
  contains `INSERT INTO band_songs (band_id, version_id, status)` and ends with
  `ON CONFLICT DO NOTHING`, that its values equal `['band-1', 'version-1']`, and that it
  does **not** contain `band_members`. The existing tests
  `issues exactly one statement for a personal owner`,
  `runs on the client it is handed so it can join a caller transaction` and
  `does nothing when the owner carries neither a band nor a user` still pass unchanged.
- [ ] ER7 — Neither violating statement survives in either file that carries one today:
  `grep -rn "FROM band_members" src/lib/spotifyPlaylistSync.ts` returns no lines, and
  `grep -c "seedOwnerSongSql('user_songs', 'user_id')" src/lib/playlists.ts` returns `1`
  (the personal branch at today's line 192 only — the band branch's copy at line 190 is
  gone), with that single remaining occurrence inside the `else if (playlist.user_id)`
  branch.
- [ ] ER8 — `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/playlists.test.ts` exits 0
  with 0 failed and **0 skipped** tests (the file is `describe.skipIf`-gated). That file
  contains no test whose name includes the words `propagate to members`; the UC3.2
  band-playlist test is renamed to
  `should write only the band row when adding a song to a band playlist (UC3.2)`, keeps
  its two-member band (User A admin, User B member) and now asserts `band_songs` has
  exactly 1 row for the band and song while `user_songs` has **0** rows for User A and 0
  for User B.
- [ ] ER9 — `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/spotify.test.ts` exits 0 with
  0 failed and **0 skipped** tests (the file is `describe.skipIf`-gated), and its
  band-import assertion no longer expects a `user_songs` row for either member: the loop
  over `[userAId, userBId]` asserts `toHaveLength(0)` for both, with the `band_songs`
  assertion of `toHaveLength(1)` retained in the same test.
- [ ] ER10 — Exception 1 still works, **without exporting anything new from a
  `'use server'` module**: `src/app/actions/tabs.ts` line 1 is `'use server'`, so
  `grep -nE "export[^\n]*ensureOwnEntry" src/app/actions/tabs.ts` returns no lines and
  `grep -c "^async function ensureOwnEntry" src/app/actions/tabs.ts` returns `1` — it
  stays a module-private `async function`, because exporting a
  function that takes a caller-supplied `userId` instead of calling `getRequiredUserId()`
  would publish a Server Action letting any authenticated user seed a `user_songs` row for
  any other user. The exception is instead proven through the action:
  `src/lib/__tests__/oneOwnerPerWrite.db.test.ts` contains a passing test named
  `uploading a file in band context creates the uploader's own row` which seeds a band
  with **two members** (the uploader and one other member), a `band_songs` row for the
  song's representative version, and no `user_songs` row for anyone; calls
  `uploadTabAction(formData)` with a `FormData` carrying `songId`, `title` and a small
  valid PDF `File`, with the blob-storage client mocked; and then asserts
  `SELECT count(*)::int FROM user_songs WHERE user_id = <uploader> AND version_id = <representative version>`
  is `1` with `status = 'unknown'`, that
  `SELECT count(*)::int FROM user_songs WHERE version_id = <version>` is also `1` (so the
  second member received nothing), and that
  `SELECT count(*)::int FROM band_songs WHERE band_id = <band> AND version_id = <version>`
  is still `1`.
- [ ] ER11 — Exception 2 still works: `npx vitest run src/lib/__tests__/lyricsEditor.test.ts`
  exits 0 with 0 failed and passes a test asserting
  `resolveLyricsSaveTarget({ entryId: 'e1', entryBandId: 'b1', personalRepertoireId: null, version: 'personal' })`
  returns exactly `{ repertoireId: null, bandId: null, toPersonalEntry: true }`, and that
  the same call with `version: 'band'` returns `bandId: 'b1'` and
  `toPersonalEntry: false` — i.e. a personal lyrics save in band context is still routed
  to the member's own row and a band lyrics save still is not.
- [ ] ER12 — Exception 3's mechanism is single-owner:
  `src/lib/__tests__/oneOwnerPerWrite.db.test.ts` contains a passing test named
  `a last_practiced write in band context touches one owner row only` which, with both a
  `band_songs` row and the member's own `user_songs` row present for one version, calls
  `updateSongOverrides({ userId: <member> }, <their user_songs row id>, { last_practiced: <date> })`
  and asserts the member's `user_songs.last_practiced` equals that date while
  `SELECT last_practiced FROM band_songs WHERE band_id = <band> AND version_id = <version>`
  is still `NULL`.
- [ ] ER13 — Band admin is still required after the change, proven by the **only** test in
  the repository that exercises a non-admin refusal on this path:
  `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/playlists.test.ts` exits 0 with 0
  failed and 0 skipped, and the test named
  `refuses a non-admin member adding to a band playlist, writing neither row (RH-124 ER19)`
  passes with its refusal half asserting **all three** counts at zero after the rejected
  call — `band_songs` 0 for the band and song, `playlist_songs` 0 for the playlist, and
  `user_songs` **0** for both the refused member and the band's admin (this third
  assertion is absent today and must be added) — and with its admin half, which re-runs
  the same add as the band admin, asserting the admin's `user_songs` row count for that
  song is **0** where it asserts `1` today, while the `band_songs` count stays `1`.
- [ ] ER14 — `AGENTS.md` line describing band vs. personal ownership no longer says the
  playlist-side paths "create a band row sideways" for members: it states that
  `addSongToPlaylist`, the Spotify import and the Spotify sync create **only** the band's
  `band_songs` row, and names the three exceptions
  (`docs/use-cases.md` § *What creates a personal row in band context*) as the only
  writes that land a personal row in band context. No stale description of the dual write
  survives in anything this task owns:
  `grep -rniE "dual.?write|RH-126 removes|until RH-126|RH-126's whole deliverable|band row sideways" src AGENTS.md docs/use-cases.md docs/plans`
  returns no lines (8 lines today, across `src/lib/playlists.ts`,
  `src/lib/spotifyPlaylistSync.ts`, `src/lib/__tests__/playlists.test.ts`,
  `src/lib/__tests__/spotify.test.ts` and `AGENTS.md`). The scope deliberately excludes
  `docs/tasks/`: landed specs for shipped tasks (`docs/tasks/RH-125-spec.md:478`) are a
  record and must not be rewritten, and this spec file itself quotes the phrases.
- [ ] ER15 — `npm run test:coverage` exits 0 with all four thresholds met
  (statements 80, branches 65, functions 78, lines 80 — `vitest.config.ts:84-89`).
- [ ] ER16 — `npx vitest run src/lib/__tests__/complexityBudget.test.ts` exits 0, with the
  override list still at **14 entries or fewer** against `MAX_OVERRIDES = 17`, and
  `wc -l src/lib/playlists.ts` reports **383 or fewer** and
  `wc -l src/lib/spotifyPlaylistSync.ts` **266 or fewer** (both files are net-deleting).
- [ ] ER17 — `npm run lint` adds **no new finding** on top of the tracked baseline of
  8 errors / 9 warnings across 11 files (RH-129): the error count, warning count and file
  count are each less than or equal to the baseline. `npm run lint:dead` exits 0 and
  `npm run build` exits 0.
- [ ] ER18 — `package.json`'s `version` is bumped from `0.1.147-202610070115` by at least
  one patch with a fresh `YYYYMMDDHHmm` local-time suffix (AGENTS.md § *Version Bumping
  Rule*).
