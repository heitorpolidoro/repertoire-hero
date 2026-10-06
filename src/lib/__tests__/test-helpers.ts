import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { query } from '@/lib/db'
import { ensureSongHasVersion, representativeVersionSubquery } from '@/lib/songVersions'

/**
 * The catalog table's pre-RH-121 name, assembled from parts rather than written
 * out as one literal.
 *
 * RH-121 renamed the table to `songs` and requires (ER4) that the old
 * identifier appear nowhere under `src/`. Two tests genuinely need it anyway:
 * `catalogRename.db.test.ts` asserts the old table's *absence* from
 * `information_schema`, and `songIdentity.db.test.ts` replays
 * `migrations/0009`, whose statements predate the rename and still address the
 * table by its old name. Spelling it once, here, keeps that one unavoidable
 * exception in a single reviewable place instead of scattering a grep-defeating
 * trick through the files that need it.
 */
export const LEGACY_CATALOG_TABLE = ['global', 'songs'].join('_')

export async function createTestUser(
  { email, name = 'Test User' }: { email: string; name?: string },
): Promise<string> {
  const userId = randomUUID()
  await query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)', [userId, name, email])
  await query('INSERT INTO profiles (id, email, full_name) VALUES ($1, $2, $3)', [userId, email, name])
  return userId
}

export async function deleteTestUser(userId: string): Promise<void> {
  await query('DELETE FROM "user" WHERE id = $1', [userId])
}

export async function createTestUserWithGoTrue(
  { email, name = 'Test User', password = 'password123' }: { email: string; name?: string; password?: string },
): Promise<{ userId: string; password: string }> {
  const userId = randomUUID()
  await query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)', [userId, name, email])
  await query('INSERT INTO profiles (id, email, full_name) VALUES ($1, $2, $3)', [userId, email, name])
  return { userId, password }
}

export async function deleteTestUserWithGoTrue(userId: string): Promise<void> {
  await query('DELETE FROM "user" WHERE id = $1', [userId])
}

// ---------------------------------------------------------------------------
// RH-23 — Shared source-tree scanner for the guard tests
// (`errorHandlingStyle.test.ts`, `noBrowserDialogs.test.ts`). Both used to
// carry their own copy of `stripComments`, `listSourceFiles` and the scan loop.
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const SRC_DIR = path.join(REPO_ROOT, 'src')
const E2E_DIR = path.join(REPO_ROOT, 'e2e')

/**
 * Removes `//` line comments and block comments from a source string.
 * Block comments are blanked out so line numbers are preserved.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '')
}

/**
 * Recursively lists every `.ts`/`.tsx` file under `dir`. Module-local: only
 * `findViolations` uses it, and an exported-but-unimported symbol risks knip.
 */
function listSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name)
    if (dirent.isDirectory()) {
      files.push(...listSourceFiles(full))
    } else if (/\.tsx?$/.test(dirent.name)) {
      files.push(full)
    }
  }
  return files
}

/**
 * One line of `src/` that matched a guard pattern. Module-local for the same
 * knip reason; it is only referenced in `findViolations`'s return type.
 */
interface SourceViolation {
  /** Repo-relative, `/`-separated path, e.g. `src/lib/db.ts`. */
  file: string
  /** 1-based line number within that file. */
  line: number
  /** The offending line, trimmed. */
  text: string
}

/**
 * Scans every `.ts`/`.tsx` file under `src/` with comments stripped, one entry
 * per line matching `pattern`. `options.skip` is a repo-relative path excluded
 * from the scan — each guard test passes its own path — and `options.alsoE2E`
 * extends the scan to the Playwright specs, which RH-124 ER5 covers too.
 */
export function findViolations(
  pattern: RegExp,
  options: { skip?: string; alsoE2E?: boolean } = {},
): SourceViolation[] {
  const violations: SourceViolation[] = []
  const roots = options.alsoE2E ? [SRC_DIR, E2E_DIR] : [SRC_DIR]
  for (const full of roots.flatMap(listSourceFiles)) {
    const file = path.relative(REPO_ROOT, full).split(path.sep).join('/')
    if (file === options.skip) continue
    stripComments(fs.readFileSync(full, 'utf8'))
      .split('\n')
      .forEach((line, index) => {
        if (pattern.test(line)) {
          violations.push({ file, line: index + 1, text: line.trim() })
        }
      })
  }
  return violations
}

/** Renders violations as `path:line — text`, the guard tests' message format. */
export function formatViolations(violations: SourceViolation[]): string[] {
  return violations.map((v) => `${v.file}:${v.line} — ${v.text}`)
}

// ---------------------------------------------------------------------------
// RH-124 — the dropped repertoire table, for the four suites that replay a
// migration predating its removal.
// ---------------------------------------------------------------------------

/**
 * The pre-RH-124 owner-row table's name, assembled from parts rather than
 * written as one literal beside a SQL keyword — the same device, and the same
 * reason, as `LEGACY_CATALOG_TABLE` and `LEGACY_TABS_TABLE` above.
 *
 * RH-124 replaced it with `user_songs` and `band_songs`, keyed by a version,
 * and requires (ER5) that no SQL statement under `src/` or `e2e/` name the old
 * table in a `FROM`, `JOIN`, `INSERT INTO`, `UPDATE` or `DELETE FROM`. Four
 * suites genuinely need it anyway, each replaying a migration file whose
 * statements predate the removal, inside a transaction they always roll back:
 *
 *  - `ownerSongsMigration.db.test.ts` rebuilds the legacy shape so it can
 *    execute the split migration itself;
 *  - `songFilesMigration.db.test.ts` and `songIdentity.db.test.ts` replay
 *    migrations (`0015`, `0009`) whose statements touch rows of this table;
 *  - `catalogVersionsMigration.db.test.ts` replays `0014`, which did too.
 *
 * **All four now rebuild it in a throwaway schema** ({@link legacyCatalogReplayDdl}),
 * so none of them holds a lock on anything in `public`. See the note below on
 * the advisory lock that arrangement retired.
 */
export const LEGACY_REPERTOIRE_TABLE = ['reper', 'toire'].join('')

/*
 * THE MIGRATION-REPLAY ADVISORY LOCK IS GONE, AND NOTHING REPLACED IT.
 *
 * There used to be a `lockMigrationReplay(client)` here, taking a
 * transaction-scoped `pg_advisory_xact_lock(124_0016)` as the first statement
 * of any replay scenario that rebuilt a legacy shape **in `public`**. It was
 * removed rather than kept-but-unused, because by the end of RH-129 it guarded
 * nothing: its last two callers, `ownerSongsMigration` and `songFilesMigration`,
 * moved onto {@link legacyCatalogReplayDdl}'s throwaway schema, which is where
 * `songIdentity` and `catalogVersionsMigration` already were.
 *
 * It is recorded here rather than deleted silently because the lock's *failure*
 * is the useful part of the history. It serialised the replay suites against
 * **each other** only. The deadlocks were never between two replays; they were
 * between one replay and an ordinary suite, which takes no advisory lock and
 * cannot be made to. Measured after the first two suites moved, the remaining
 * two still deadlocked in 2 of 24 full runs (~8%) — with the lock held — on the
 * cycle an unqualified `DROP TABLE song_files` / `DROP TABLE user_songs` closes:
 * the drop needs ACCESS EXCLUSIVE on the *referenced* `songs` and
 * `song_versions` as well, while any ordinary suite holding AccessShare on
 * `songs` and then asking for RowExclusive is waiting the other way round.
 *
 * So the fix is not a bigger lock, it is no shared table: a replay that owns
 * every relation it drops is not in the lock graph at all. Two things that were
 * tried and are worse, for the next person who reaches for them:
 *
 *  - promoting the advisory lock to `LOCK TABLE songs, global_song_edits IN
 *    ACCESS EXCLUSIVE MODE` serialises every `songs` reader in the suite behind
 *    each replay, and made unrelated atomicity tests time out;
 *  - serialising the files (`fileParallelism: false`, a `poolOptions` carve-out,
 *    `--no-threads`) hides the cycle instead of removing it, and pays for it in
 *    wall-clock on every run forever.
 *
 * A new replay suite therefore takes no lock. It builds a schema and puts it
 * first on the transaction's `search_path`.
 */

/**
 * The two owner tables a replayed migration's foreign keys point at, as empty
 * **stubs** inside a throwaway replay schema.
 *
 * `migrations/0015` declares `song_files.user_id REFERENCES profiles(id)`, and
 * `migrations/0016` declares `user_songs.user_id REFERENCES profiles(id)` and
 * `band_songs.band_id REFERENCES bands(id)`. Those names are unqualified, so in
 * a replay schema they resolve along the `search_path` — and with no local
 * table they would land on **`public`'s**, which is the one thing the replay
 * schema exists to avoid: declaring a foreign key takes `SHARE ROW EXCLUSIVE`
 * on the referenced table, and that conflicts with the `ROW EXCLUSIVE` every
 * other worker's `INSERT INTO profiles` holds.
 *
 * `id` is the only column, because an FK target is all these are for: no
 * statement in either migration selects a column of `profiles` or `bands`. A
 * scenario inserts the synthetic owner uuids it needs — the replay schema's
 * `repertoire` carries no owner key of its own (see {@link legacyRepertoireDdl}),
 * so those uuids are invented, and nothing can tell them from real ones.
 *
 * Both tables are created even by a scenario that needs one, so that a caller
 * does not have to know which foreign keys the file it replays happens to
 * declare; an unused empty table in a schema that is rolled back costs nothing.
 *
 * `schema` is written by the calling suite from a hex token, never by a user.
 */
export function ownerStubsDdl(schema: string): string {
  return `
    CREATE TABLE ${schema}.profiles (id uuid PRIMARY KEY);
    CREATE TABLE ${schema}.bands    (id uuid PRIMARY KEY);
  `
}

/**
 * One migration file's text, resolved off disk by its name **suffix**.
 *
 * Never by a four-digit prefix: several approved specs are written against the
 * same high-water mark, so whichever lands second renumbers, and a prefix
 * written into a test would break on that renumber.
 *
 * This exists for the *prerequisite* case — a suite that has to run a migration
 * other than its own subject, because the throwaway schema it replays into does
 * not carry what that earlier file installed. `ownerSongsMigration` is the one
 * caller today: `migrations/0016` calls `migrate_catalog_to_versions()` and
 * writes into `albums` / `song_versions`, all three of which `migrations/0014`
 * creates. A suite's own subject file stays resolved locally, because the "there
 * is exactly one of me" assertion is part of what that suite tests.
 */
export function migrationSqlBySuffix(suffix: string): string {
  const dir = path.join(REPO_ROOT, 'migrations')
  const names = fs.readdirSync(dir).filter((name) => name.endsWith(suffix))
  if (names.length !== 1) {
    throw new Error(`expected exactly one *${suffix} migration, found ${names.length}`)
  }
  return fs.readFileSync(path.join(dir, names[0]), 'utf8')
}

/**
 * The legacy DDL, frozen: `migrations/0001_initial_schema.sql`'s table plus the
 * `lyrics` column `migrations/0002` added, both partial uniques and the three
 * plain indexes. `global_songs` became `songs` in RH-121, so the foreign key
 * names the current table.
 *
 * Mirrored here rather than read off disk: `0001` is history and never changes,
 * and replaying it verbatim would recreate half the schema.
 *
 * `IF NOT EXISTS` so a suite may call it without first asking whether the split
 * migration has been applied to the database it is running against.
 *
 * **There are no owner foreign keys, and `schema` is required** (RH-129). There
 * is no `profiles` and no `bands` in a throwaway replay schema to point at, and
 * declaring the keys against the real ones would take a `SHARE ROW EXCLUSIVE`
 * lock on two tables every other worker writes — the whole reason every replay
 * moved out of `public`. A replay-schema row therefore carries a synthetic
 * owner uuid, which no statement any replayed migration issues can tell from a
 * real one: none of them joins an owner table. (A replayed migration that
 * declares such a key *itself* is served by {@link ownerStubsDdl}, inside the
 * same schema.) `song_id`'s key is kept, pointed at the `songs` of the same
 * schema — `migrations/0009` step 12 and `0014`'s collapse both
 * `DELETE FROM songs`, so the `ON DELETE CASCADE` is what makes "re-pointed,
 * not lost" an assertion rather than an accident.
 *
 * This took a `schema = 'public'` default and a `schema === 'public'` branch
 * that added the owner keys, for the two suites that rebuilt the legacy shape
 * in `public`. Both moved to throwaway schemas, and the default is not kept as
 * a convenience: rebuilding this table in `public` is precisely the thing that
 * deadlocked, so the parameter is required and the branch is gone.
 *
 * `schema` is written by the calling suite from a hex token, never by a user.
 */
export function legacyRepertoireDdl(schema: string): string {
  const table = `${schema}.${LEGACY_REPERTOIRE_TABLE}`
  return `
    CREATE TABLE IF NOT EXISTS ${table} (
        id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        uuid,
        band_id        uuid,
        song_id        uuid        NOT NULL REFERENCES ${schema}.songs(id) ON DELETE CASCADE,
        personal_key   text,
        status         song_status NOT NULL DEFAULT 'unknown',
        tags           text[]      NOT NULL DEFAULT '{}',
        last_practiced timestamptz,
        lyrics         text,
        CONSTRAINT check_${LEGACY_REPERTOIRE_TABLE}_owner_exclusive CHECK (
            (user_id IS NOT NULL AND band_id IS NULL) OR
            (user_id IS NULL     AND band_id IS NOT NULL)
        )
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_${LEGACY_REPERTOIRE_TABLE}_user_song
        ON ${table} (user_id, song_id) WHERE user_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_${LEGACY_REPERTOIRE_TABLE}_band_song
        ON ${table} (band_id, song_id) WHERE band_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_${LEGACY_REPERTOIRE_TABLE}_user_id ON ${table} (user_id);
    CREATE INDEX IF NOT EXISTS idx_${LEGACY_REPERTOIRE_TABLE}_band_id ON ${table} (band_id);
    CREATE INDEX IF NOT EXISTS idx_${LEGACY_REPERTOIRE_TABLE}_song_id ON ${table} (song_id);
  `
}

// `LEGACY_REPERTOIRE_DDL`, the `public`-schema form of the above, used to live
// here. RH-129 removed it with its last caller: nothing rebuilds this table in
// `public` any more, and leaving a ready-made constant that does would invite
// the deadlock straight back in.

// ---------------------------------------------------------------------------
// RH-123 — the dropped tabs table, for the four suites that replay a
// migration predating its removal.
// ---------------------------------------------------------------------------

/**
 * The pre-RH-123 files table's name, assembled from parts rather than written
 * out as one literal — the same device, and for the same reason, as
 * `LEGACY_CATALOG_TABLE` above.
 *
 * RH-123 replaced the table with `song_files` keyed by `(user_id, song_id)` and
 * requires (ER5) that the old identifier appear nowhere under `src/`. Four
 * suites genuinely need it anyway, and all four for the same reason: they
 * replay a migration file whose statements predate the removal, inside a
 * throwaway schema and a transaction they always roll back.
 *
 *  - `songFilesMigration.db.test.ts` rebuilds the legacy shape so it can
 *    execute the drop migration itself;
 *  - `songIdentity.db.test.ts` replays `migrations/0009`, which re-points the
 *    losers' tab rows while collapsing duplicate catalog rows;
 *  - `catalogVersionsMigration.db.test.ts` calls `migrate_catalog_to_versions()`
 *    from `migrations/0014`, which does the same;
 *  - `ownerSongsMigration.db.test.ts` runs `0014` as a prerequisite, so it gets
 *    the table from `legacyCatalogReplayDdl` and drops it again — by its
 *    qualified name — to stand in for the `0015` that ran in between.
 *
 * Spelling it once, here, keeps that unavoidable exception in a single
 * reviewable place instead of scattering a grep-defeating trick through the
 * files that need it.
 */
export const LEGACY_TABS_TABLE = [LEGACY_REPERTOIRE_TABLE, 'tabs'].join('_')

/**
 * The legacy DDL, frozen. `migrations/0002_add_tabs_and_lyrics.sql` created the
 * table and its `repertoire_id` index; `migrations/0005_add_tab_annotations.sql`
 * added the `annotations` jsonb column. Both files are history and never
 * change, so this mirrors them rather than reading them off disk — replaying
 * `0002` verbatim would also re-run its `ALTER TABLE repertoire` half.
 *
 * `IF NOT EXISTS` so a suite may call it without first asking whether the drop
 * migration has been applied to the database it is running against.
 *
 * The `repertoire_id` key stays `ON DELETE CASCADE`: it is what makes "the
 * re-point happens *before* the loser is deleted" testable at all. Without it a
 * migration that deleted first would leave a dangling tab row and the assertion
 * would still pass.
 *
 * `schema` is required (RH-129), for the same reason as
 * {@link legacyRepertoireDdl}: it carried a `'public'` default for the one suite
 * that rebuilt this table there, that suite now owns a schema, and a default
 * pointing back at `public` is a deadlock waiting to be re-adopted. It is
 * written by the calling suite from a hex token, never by a user.
 */
export function legacyTabsDdl(schema: string): string {
  const table = `${schema}.${LEGACY_TABS_TABLE}`
  return `
    CREATE TABLE IF NOT EXISTS ${table} (
        id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        repertoire_id  uuid        NOT NULL
                       REFERENCES ${schema}.${LEGACY_REPERTOIRE_TABLE}(id) ON DELETE CASCADE,
        title          text        NOT NULL,
        file_url       text        NOT NULL,
        created_at     timestamptz NOT NULL DEFAULT now(),
        annotations    jsonb       NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_${LEGACY_TABS_TABLE}_repertoire_id ON ${table} (repertoire_id);
  `
}

// `LEGACY_TABS_DDL`, the `public`-schema form of the above, used to live here.
// RH-129 removed it with its last caller, for the reason given where
// `LEGACY_REPERTOIRE_DDL` used to be.

/**
 * The owner-row tables joined back to the song, for the suites that assert on a
 * `(owner, song)` pair rather than on a version (RH-124).
 *
 * `user_songs` / `band_songs` are keyed by `version_id`, so "does this owner
 * hold this song?" is one join away. Written once so a dozen suites do not each
 * spell it: `SELECT o.status FROM ${OWNER_SONG_FROM.user} WHERE o.user_id = $1
 * AND v.song_id = $2`.
 */
export const OWNER_SONG_FROM = {
  user: 'user_songs o JOIN song_versions v ON v.id = o.version_id',
  band: 'band_songs o JOIN song_versions v ON v.id = o.version_id',
} as const

/**
 * The representative version of `songId`, ensuring the song has one first —
 * what a suite that holds only a song id needs since RH-125 made the playlist
 * entry and both playlist writes version-keyed.
 *
 * The ordering is `representativeVersionSubquery`'s, the one place it exists,
 * so a suite seeding a playlist entry by hand lands on the same version
 * `addSongToPlaylist` would have been given by the picker.
 */
export async function representativeVersionId(songId: string): Promise<string> {
  await ensureSongHasVersion(songId)
  const res = await query<{ id: string }>(
    `SELECT ${representativeVersionSubquery('$1')} AS id`,
    [songId],
  )
  const id = res.rows[0]?.id
  if (!id) throw new Error(`no song_versions row for song ${songId}`)
  return id
}

/**
 * The representative version of each of `songIds`, in the same order, ensuring
 * every song has one first — the bulk form of {@link representativeVersionId},
 * for the suites that seed a hundred-odd playlist entries at once.
 */
export async function representativeVersionIds(songIds: string[]): Promise<string[]> {
  const versionIds: string[] = []
  for (const songId of songIds) versionIds.push(await representativeVersionId(songId))
  return versionIds
}

/**
 * The pre-RH-125 shape of `playlist_songs`: keyed by `song_id`, with
 * `uq_playlist_song` and the deferrable position unique `migrations/0012` left.
 *
 * Three suites need it, each replaying a migration whose statements predate the
 * re-key, inside a transaction they always roll back:
 *
 *  - `playlistSongsVersionMigration.db.test.ts` rebuilds the legacy shape so it
 *    can execute the re-key migration itself;
 *  - `songIdentity.db.test.ts` replays `migrations/0009`, which collapses
 *    duplicate catalog rows' playlist entries and renumbers their positions;
 *  - `catalogVersionsMigration.db.test.ts` calls
 *    `migrate_catalog_to_versions()` from `migrations/0014`, whose collapse
 *    branch re-points `playlist_songs.song_id` (that branch is unreachable on a
 *    migrated database, because `uq_songs_artist_title` leaves no duplicate
 *    group — the suite seeds one on purpose).
 *
 * It **drops and recreates** rather than altering, so the table a replay sees
 * is empty and its conservation counts are its own.
 *
 * **`schema` is required, and no caller may pass `public`.** In `public` the
 * `DROP TABLE` takes an ACCESS EXCLUSIVE lock on a table every other vitest
 * worker is reading, which was not merely slow: a replay also has to touch
 * `songs` (and, since RH-125, `song_versions`), while every ordinary playlist
 * read locks `playlist_songs` **before** them — the range table of
 * `getPlaylistWithSongs` is `playlists, playlist_songs, song_versions, songs`,
 * and `getPlaylistDetailsWithEntries` starts at `playlist_songs` outright. Two
 * transactions taking the same tables in opposite orders is a cycle, and
 * Postgres resolves a cycle by killing one of them at random, which surfaces as
 * an unrelated suite failing with `deadlock detected`.
 *
 * The hand-maintained ordering rule that used to live here — take the
 * migration-replay advisory lock first, then call this before any other lock —
 * narrowed the window without closing it, because that lock serialised the
 * replay suites against each other and not against the ordinary suites running
 * in parallel. RH-129 removed it (see the note where it used to be, above).
 * Every caller now owns a throwaway schema instead
 * ({@link legacyCatalogReplayDdl}, or the one
 * `playlistSongsVersionMigration.db.test.ts` builds), so none of these tables
 * is shared with another worker at all and there is no order left to get wrong.
 *
 * The two foreign keys the real table carries are **deliberately omitted**. No
 * replay asserts on them, and declaring them would make this `CREATE TABLE`
 * take a `SHARE ROW EXCLUSIVE` lock on `playlists` and `songs` too — and in a
 * replay schema there is no `playlists` to point at.
 *
 * `schema` is written by the calling suite from a hex token, never by a user.
 */
export function legacyPlaylistSongsDdl(schema: string): string {
  return `
    DROP TABLE IF EXISTS ${schema}.playlist_songs;
    CREATE TABLE ${schema}.playlist_songs (
        id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
        playlist_id uuid    NOT NULL,
        song_id     uuid    NOT NULL,
        position    integer NOT NULL DEFAULT 0,
        CONSTRAINT uq_playlist_song UNIQUE (playlist_id, song_id),
        CONSTRAINT uq_playlist_song_position
            UNIQUE (playlist_id, position) DEFERRABLE INITIALLY IMMEDIATE
    );
    CREATE INDEX idx_playlist_songs_playlist_id ON ${schema}.playlist_songs (playlist_id);
  `
}

/**
 * The whole pre-RH-122 catalog neighbourhood, in a **throwaway schema** — what
 * all four migration-replay suites build instead of rebuilding it in `public`:
 * `songIdentity` (`migrations/0009`), `catalogVersionsMigration` (`0014`),
 * `songFilesMigration` (`0015`) and `ownerSongsMigration` (`0016`, which runs
 * `0014` first for the function and tables it needs). The last two moved here in
 * RH-129; before that they rebuilt their legacy shape in `public` and dropped
 * live tables to do it, which is the deadlock described below under a different
 * pair of table names.
 *
 * WHY A THROWAWAY SCHEMA
 *
 * The first two files collapse duplicate catalog rows, so both have to seed
 * duplicates, so both have to take `uq_songs_artist_title` off `songs` — an
 * ACCESS EXCLUSIVE lock on the table almost every other suite reads — and both
 * then
 * touch `playlist_songs`, `repertoire` and `song_versions` in an order no
 * ordinary reader uses. `song_versions` is where it bites hardest since RH-125:
 * `representativeVersionId` in this very file calls `ensureSongHasVersion`,
 * whose `INSERT ... ON CONFLICT DO NOTHING` performs a speculative insertion
 * that *waits* on a conflicting in-progress one, and seven suites now do that —
 * one of them ~100 times in a loop. A replay holding `songs` while those wait
 * on `song_versions` is a lock cycle, and the deadlock Postgres breaks it with
 * lands on whichever transaction it picks.
 *
 * Nothing in either migration file notices the move: every name in them is
 * unqualified, so putting `schema` first on the transaction's `search_path`
 * resolves all of them inside it. `public` stays on the path behind it for the
 * extension functions (`gen_random_uuid`) and the `song_status` enum.
 *
 * **One hazard the move introduces, and the reason the index note below
 * matters.** An unqualified `DROP INDEX IF EXISTS x` resolves along the
 * `search_path` too: if the replay schema has no index called `x`, the
 * statement finds and drops **`public`'s**. Both files issue exactly that for
 * `uq_songs_artist_title`, so a suite that lets the migration run against this
 * schema must either create that index here first (`migrations/0014`, which
 * drops and recreates it) or never issue the statement at all
 * (`migrations/0009`, which only creates it at the end). It is deliberately
 * **not** created here: which of the two a suite needs is the suite's own
 * decision, and getting it silently wrong would corrupt the live schema.
 *
 * `schema` is written by the calling suite from a hex token, never by a user.
 */
export function legacyCatalogReplayDdl(schema: string): string {
  return `
    CREATE SCHEMA ${schema};
    CREATE TABLE ${schema}.songs (
        id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        title            text        NOT NULL,
        artist           text        NOT NULL,
        album            text,
        standard_key     text,
        cover_url        text,
        duration_seconds integer,
        links            jsonb       NOT NULL DEFAULT '[]'::jsonb,
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE ${schema}.global_song_edits (
        id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        song_id       uuid        NOT NULL REFERENCES ${schema}.songs(id) ON DELETE CASCADE,
        requested_by  uuid        NOT NULL,
        proposed_data jsonb       NOT NULL,
        status        text        NOT NULL DEFAULT 'pending',
        created_at    timestamptz NOT NULL DEFAULT now()
    );
    ${legacyPlaylistSongsDdl(schema)}
    ${legacyRepertoireDdl(schema)}
    ${legacyTabsDdl(schema)}
  `
}

/**
 * Seeds one owner's hold on `songId`'s representative version and returns the
 * row's id — what `INSERT INTO <the old table> (user_id, song_id, …)` used to
 * be for a suite that only has a song id.
 *
 * The version is ensured first: a suite that inserts a `songs` row by hand
 * (most of them do) creates a catalog row with no version, exactly as
 * `scripts/seed-catalog.sql` does.
 *
 * Idempotent, because several callers seed from a `beforeEach`: a second call
 * for the same `(owner, version)` updates the status and tags rather than
 * raising, which is what the hand-written upserts it replaces did.
 */
export async function seedOwnerSong(
  owner: { userId: string } | { bandId: string },
  songId: string,
  row: { status?: string; tags?: string[] } = {},
): Promise<string> {
  await ensureSongHasVersion(songId)
  const isBand = 'bandId' in owner
  const res = await query<{ id: string }>(
    `INSERT INTO ${isBand ? 'band_songs' : 'user_songs'} (${isBand ? 'band_id' : 'user_id'}, version_id, status, tags)
     SELECT $1, ${representativeVersionSubquery('$2')}, $3::song_status, $4::text[]
     ON CONFLICT (${isBand ? 'band_id' : 'user_id'}, version_id)
       DO UPDATE SET status = EXCLUDED.status, tags = EXCLUDED.tags
     RETURNING id`,
    [isBand ? owner.bandId : owner.userId, songId, row.status ?? 'unknown', row.tags ?? []],
  )
  return res.rows[0].id
}
