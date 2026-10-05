# RH-101 — Add `updated_at` to the catalog tables

## Scope

`global_songs` is the only mutable application table that carries `created_at`
without `updated_at`. `bands`, `playlists`, `spotify_tokens` and
`global_song_edits` all have both. This task adds the column and makes it stay
current, so that a later consumer has a monotonic "last changed" value to read.

In scope:

- a new migration adding `global_songs.updated_at`, backfilled from
  `created_at`, with the same shape the other four tables use;
- every production writer of `global_songs` setting the column;
- a static guard that keeps a future writer from silently omitting it;
- a DB-backed test proving the column moves on a real write.

Not in scope: staleness detection, cache comparison, or any change to the
offline snapshot (RH-28). The motivation is the snapshot — it has nothing to
compare a cached row against today — but this task only supplies the column.

A reader will ask about a second justification this work item once carried:
detecting a moderation suggestion whose target changed while it waited. That
justification is **withdrawn**. Target-column grouping in the redesigned queue
means every pending suggestion for a field is reviewed together against the
field's current value, so a suggestion cannot be stale relative to its target
through the queue. The offline snapshot is the remaining reason and is
sufficient on its own.

## Approach

### How the column is maintained: every writer sets it, not a trigger

The repository already answers this question. It uses Postgres triggers for
cross-row invariants that application code cannot be trusted to hold
(`sync_profile_email_on_user_update` in `migrations/0008_sync_profile_email.sql`,
because the writer is Better Auth's own handler; `sync_band_repertoire_on_member_update`,
because the aggregate depends on rows the writing statement does not touch). It
has **never** used a trigger for timestamp maintenance: all four tables that
carry `updated_at` are kept current by the writing statement spelling
`updated_at = now()` in its `SET` list — `src/lib/bands.ts:154`,
`src/lib/bands.ts:330`, `src/lib/playlists.ts:114`, `src/lib/spotifyAuth.ts:78`,
`src/lib/moderation.ts:111` and `src/lib/moderation.ts:146` (the two
`global_song_edits` writes named in the task), and
`src/app/api/spotify/playlists/[id]/sync/route.ts:178`.
`src/lib/sqlUpdate.ts`'s own doc comment names `updated_at = now()` as the
caller's "own tail", i.e. the pattern is documented, not incidental.

So: follow it. A `BEFORE UPDATE` trigger here would be a second, competing
mechanism for the same concern on one table out of five, and a reader of
`bands.ts` would have no way to know which tables are trigger-maintained
without consulting the schema.

The one thing a trigger would buy that the convention does not — a writer that
forgets the clause cannot produce a stale timestamp — is bought instead by the
static guard below, which is the repository's own idiom for exactly this
(`transactionGuard`, `identityWriteGuard`, `actionDataAccessGuard`).

### Behavior

1. **Schema.** `global_songs` gains `updated_at timestamptz NOT NULL DEFAULT now()`,
   matching `bands`/`playlists`/`spotify_tokens` (not `global_song_edits`' nullable
   `timestamptz DEFAULT now()` — the stricter of the two existing shapes is the
   right one, since a null here would read as "never changed" to a comparison).
   On an existing database every row is backfilled with its own `created_at`,
   not with the migration's clock, so a row never edited since creation reports
   its creation time rather than a timestamp that implies an edit that never
   happened. Add the column nullable, backfill, then set `NOT NULL` and the
   default, so the backfill is observable as its own statement.

   All three statements are idempotent, because `docker/init-migrations.sh` and
   `scripts/migrate.mjs` may both apply the file and because a migration in this
   repository is expected to be re-appliable by hand:
   - the column is added with `ADD COLUMN IF NOT EXISTS`;
   - **the backfill is predicated on `WHERE updated_at IS NULL`.** This is not
     optional. The unqualified form (`SET updated_at = created_at` with no
     predicate) also succeeds on a re-run, but resets every row's real
     `updated_at` back to its `created_at`, destroying exactly the data this
     task exists to produce. On a second application the predicate matches no
     row and the statement is a no-op;
   - `SET NOT NULL` and `SET DEFAULT now()` are guarded (run them only when
     `information_schema.columns` still reports `is_nullable = 'YES'` /
     a null `column_default`, or spell them in a `DO` block that tolerates the
     already-applied state).

2. **Writers.** Every statement that updates a `global_songs` row sets
   `updated_at = now()`:
   - `src/lib/songs.ts` — the catalog fill-in `UPDATE` inside `updateSong`;
   - `src/lib/songs.ts` — the links `UPDATE` in the additive-link path;
   - `src/lib/spotifyPlaylistSync.ts` — the links `UPDATE` on an existing
     catalog row during a Spotify import;
   - `src/lib/moderation.ts` — the dynamically-built `UPDATE` that applies an
     approved edit. The clause is appended to the statement template after the
     interpolated `SET` list, never pushed into the payload-derived `setClauses`
     array: that array is the narrowed set of proposable columns and
     `updated_at` is not one of them.
   - `scripts/deduplicate-songs.mjs` — all three `UPDATE global_songs`
     statements. It is maintenance tooling, but it rewrites titles, albums and
     links, which is precisely a change a cache must see.

   `INSERT` sites (`src/lib/songs.ts`, `src/lib/spotifyPlaylistSync.ts`,
   `scripts/seed-catalog.sql`, `scripts/dev-seed`, the test fixtures) need no
   change: the column default covers them.

   **Line-budget constraint, read this before editing `src/lib/songs.ts`.**
   That file is at 471 lines and its `eslint.config.mjs` ratchet entry pins
   `max-lines` to exactly 471; the ratchet may only shrink, and
   `src/lib/__tests__/complexityBudget.test.ts` fails both on exceeding the
   ceiling and on an override that is not exactly the file's current worst
   number. So the two edits there must add **no** line: append
   `, updated_at = now()` to an existing line of each statement.

3. **Accepted imprecision in `updateSong`.** That statement's `SET` list is all
   `CASE WHEN <column> IS empty THEN $n ELSE <column> END`, so it is already a
   value-level no-op when every target field is populated — and it runs on every
   repertoire edit. With `updated_at = now()` appended unconditionally, such an
   edit bumps the timestamp without changing a field. This is accepted and must
   be recorded in a comment at that statement: the error is in the conservative
   direction (a future staleness check can report a fresh row as stale, never a
   stale row as fresh), and the alternative — guarding the statement with a
   seven-clause emptiness predicate — cannot be written without growing a file
   that is forbidden to grow.

4. **No read-path or type change.** `GlobalSong` in `src/types/database.ts` and
   the `SONG_JSON` projection in `src/lib/songs.ts` are deliberately left alone:
   nothing reads the column until staleness detection lands, and adding a
   required field to a shared domain type would force edits across ~6 unrelated
   test fixtures for no behavioural gain. The column's correctness is verified at
   the database level instead.

### Files touched

- `migrations/NNNN_add_global_songs_updated_at.sql` — new; the column, the
  backfill from `created_at`, the `NOT NULL`/default, a `COMMENT ON COLUMN`.
  `NNNN` is one above the highest four-digit prefix present in `migrations/` at
  implementation time (expected `0009`); never skip a number —
  `src/lib/__tests__/migrationsSingleSource.test.ts` enforces contiguity from
  `0001`.
- `src/lib/songs.ts` — two `UPDATE global_songs` statements gain the clause on
  existing lines; one explanatory comment replaces/extends existing comment text
  without adding a line.
- `src/lib/spotifyPlaylistSync.ts` — the links `UPDATE` gains the clause.
- `src/lib/moderation.ts` — the approved-edit `UPDATE` template gains the clause
  outside the interpolated `SET` list.
- `scripts/deduplicate-songs.mjs` — three `UPDATE global_songs` statements gain
  the clause.
- `src/lib/__tests__/catalogTimestampGuard.test.ts` — new static guard (below).
- `src/lib/__tests__/catalogTimestamp.db.test.ts` — new DB-backed test (below).
- `src/lib/__tests__/spotifyPlaylistSync.test.ts` — and any other existing test
  asserting the **exact** SQL text of a touched statement — update the expected
  string. `spotifyPlaylistSync.test.ts:133` asserts the links statement verbatim
  (`toBe('UPDATE global_songs SET links = $1 WHERE id = $2')`) and will fail
  until it is updated. `src/lib/__tests__/moderation.test.ts` needs **no** change:
  its only assertion on that statement is
  `expect.stringContaining('UPDATE global_songs')` (line 291), a fragment that
  still matches.
- `package.json` — version bump per the AGENTS.md Version Bumping Rule (patch
  plus `-YYYYMMDDHHmm` local-time suffix, strictly above the highest version
  already used, currently `0.1.135-202610050942`).

### Test criteria

- **Static guard** (`catalogTimestampGuard.test.ts`).

  *Scan scope, exactly.* Production source only: every `.ts`/`.tsx` file under
  `src/` **whose path contains no `__tests__` segment**, plus every `.mjs` file
  directly under `scripts/`. Nothing else — no `migrations/`, no `e2e/`, no test
  file. The exclusion is load-bearing and must be stated in the guard's own
  header comment, for three reasons, all of which would otherwise break the
  guard: `src/lib/__tests__/moderation.test.ts:291` holds the bare fragment
  `expect.stringContaining('UPDATE global_songs')` with no `WHERE` of its own, so
  a scan would run past it to an unrelated later `WHERE`; line 263 of the same
  file is a comment; and the guard's own source and
  `catalogTimestamp.db.test.ts` both contain the literals, which would let the
  anti-vacuity check below be satisfied by the guard matching itself.

  *Rule.* Within the scanned files, find each `UPDATE global_songs` occurrence
  and fail unless the text from it up to the next `WHERE` contains
  `updated_at = now()`. In `src/lib/moderation.ts` the clause sits in the
  template between the interpolated `${setClauses.join(', ')}` and `WHERE`, so it
  satisfies the rule by static text.

  *Anti-vacuity.* The guard asserts it found **exactly 7** statements — the
  seven enumerated in ER5 — not "at least one". An exact count also fails when a
  new writer is added without being reviewed against this rule, which is the
  point of the guard.

  Document in the file header that this is the substitute for the
  `BEFORE UPDATE` trigger the project chose not to add.
- **DB-backed** (`catalogTimestamp.db.test.ts`, following the `RUN_DB_TESTS`
  skip idiom the other nine `.db.test.ts` files use): asserts the column's
  shape from `information_schema.columns` (`timestamptz`, `NOT NULL`, default
  `now()`); asserts a freshly inserted row has `updated_at = created_at`; and
  exercises one real writer (the additive-link path in `src/lib/songs.ts`)
  against a live row, asserting `updated_at > created_at` afterwards — proving
  the clause moves the value rather than merely appearing in the SQL text.
- `npm run test:coverage` stays above its thresholds (no new production
  branches are introduced, so the number should not move).
- Not a landing-page selling point: a schema column is internal, so no
  dictionary copy changes (AGENTS.md Landing Page Rule).

## Expected Results

- [ ] ER1: `migrations/` contains a new migration whose four-digit prefix is
      exactly one above the previously highest prefix, with no gap from `0001`,
      and `src/lib/__tests__/migrationsSingleSource.test.ts` passes.
- [ ] ER2: After `npm run db:migrate` on a database created before this task,
      `global_songs` has an `updated_at` column of type `timestamp with time zone`,
      `is_nullable = 'NO'`, with a `now()` column default.
- [ ] ER3: On that migrated database, every pre-existing `global_songs` row has
      `updated_at = created_at` (query returns zero rows for
      `SELECT 1 FROM global_songs WHERE updated_at <> created_at`).
- [ ] ER4: The migration is re-appliable **without losing an advanced
      `updated_at`**. Verified by applying the SQL file itself twice, bypassing
      the `_migrations` ledger (both `scripts/migrate.mjs` and
      `docker/init-migrations.sh` record each file and skip it, so running
      `npm run db:migrate` twice never applies the SQL twice and proves nothing):
      on a migrated database, `UPDATE global_songs SET updated_at = now() WHERE
      id = <some id>` so that row has `updated_at > created_at`; then
      `psql -v ON_ERROR_STOP=1 -f migrations/<the new file>` exits `0`; and
      afterwards that row still has `updated_at > created_at` (the unqualified
      backfill would have reset it to `created_at`).
- [ ] ER5: Every `UPDATE global_songs` statement in the repository — in
      `src/lib/songs.ts` (2), `src/lib/spotifyPlaylistSync.ts` (1),
      `src/lib/moderation.ts` (1) and `scripts/deduplicate-songs.mjs` (3) —
      sets `updated_at = now()`.
- [ ] ER6: In `src/lib/moderation.ts`, `updated_at` is set by the statement
      template and does not appear in the payload-derived `setClauses` array, so
      a submitted edit still cannot propose `updated_at`.
- [ ] ER7: A new vitest guard under `src/lib/__tests__/` scans production source
      only — `.ts`/`.tsx` under `src/` with no `__tests__` path segment, plus
      `.mjs` under `scripts/` — and fails the run if any `UPDATE global_songs`
      occurrence there omits `updated_at = now()` before its `WHERE`. It asserts
      the scan found **exactly 7** such statements, and that count is in the test
      source as a literal. Verified twice: temporarily removing the clause from
      one writer makes the guard fail, and the guard passes unmodified while
      `src/lib/__tests__/moderation.test.ts` still contains its
      `stringContaining('UPDATE global_songs')` fragment.
- [ ] ER8: A new `.db.test.ts` under `src/lib/__tests__/` passes with
      `RUN_DB_TESTS=1` and a migrated Postgres, asserting the column shape, that
      a newly inserted row has `updated_at = created_at`, and that a real link
      update through `src/lib/songs.ts` leaves `updated_at > created_at`.
- [ ] ER9: `npx vitest run` is green (including the updated SQL-text assertion
      in `src/lib/__tests__/spotifyPlaylistSync.test.ts`), and
      `npm run test:coverage` meets its configured thresholds.
- [ ] ER10: `src/lib/songs.ts` is still at most 471 lines and its
      `eslint.config.mjs` ratchet entry still reads `max-lines: 471`;
      `src/lib/__tests__/complexityBudget.test.ts` passes.
- [ ] ER11: `src/types/database.ts` is unchanged — `GlobalSong` gains no
      `updated_at` field — and the `SONG_JSON` projection in `src/lib/songs.ts`
      still does not select the column.
- [ ] ER12: `package.json`'s `version` is a patch bump with a `-YYYYMMDDHHmm`
      suffix, strictly greater than `0.1.135-202610050942` and above every
      version in `git log`.

## Out of Scope

- Staleness detection of any kind, and any change to the RH-28 offline
  snapshot: this task only supplies the column it will read.
- Exposing `updated_at` through `GlobalSong`, the `SONG_JSON` projection, or any
  UI.
- Adding `updated_at` to tables other than `global_songs`, or retrofitting a
  trigger onto the four tables that already maintain theirs in application SQL.
- Any `BEFORE UPDATE` timestamp trigger (see the decision above).
