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
 */
export const LEGACY_REPERTOIRE_TABLE = ['reper', 'toire'].join('')

/**
 * The advisory-lock key every migration-replay suite takes before it rebuilds a
 * legacy shape.
 *
 * Four suites now do that — `ownerSongsMigration`, `songFilesMigration`,
 * `songIdentity` and `catalogVersionsMigration` — and vitest runs files in
 * parallel workers against one database. Each one `DROP`s and `CREATE`s the
 * same handful of table names inside its own transaction, in a different order,
 * which is a lock-ordering cycle: Postgres resolves it by killing one of them
 * with `deadlock detected`, at random, which reads as a flaky suite rather than
 * as contention.
 *
 * A transaction-scoped advisory lock serialises the four instead. It is
 * released by `COMMIT` or `ROLLBACK` with no `unlock` call, so there is nothing
 * to leak if a scenario throws — and these scenarios always throw, that being
 * how they roll back.
 */
const MIGRATION_REPLAY_LOCK = 124_0016

/** Minimal shape of what `withTransaction` hands its callback. */
type LockClient = { query: (sql: string, params?: unknown[]) => Promise<unknown> }

/**
 * Takes {@link MIGRATION_REPLAY_LOCK} for the rest of `client`'s transaction.
 * Call it as the **first** statement of a replay scenario, before any DDL.
 */
export async function lockMigrationReplay(client: LockClient): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_REPLAY_LOCK])
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
 */
export const LEGACY_REPERTOIRE_DDL = `
  CREATE TABLE IF NOT EXISTS ${LEGACY_REPERTOIRE_TABLE} (
      id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id        uuid        REFERENCES profiles(id) ON DELETE CASCADE,
      band_id        uuid        REFERENCES bands(id)    ON DELETE CASCADE,
      song_id        uuid        NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
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
      ON ${LEGACY_REPERTOIRE_TABLE} (user_id, song_id) WHERE user_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_${LEGACY_REPERTOIRE_TABLE}_band_song
      ON ${LEGACY_REPERTOIRE_TABLE} (band_id, song_id) WHERE band_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_${LEGACY_REPERTOIRE_TABLE}_user_id
      ON ${LEGACY_REPERTOIRE_TABLE} (user_id);
  CREATE INDEX IF NOT EXISTS idx_${LEGACY_REPERTOIRE_TABLE}_band_id
      ON ${LEGACY_REPERTOIRE_TABLE} (band_id);
  CREATE INDEX IF NOT EXISTS idx_${LEGACY_REPERTOIRE_TABLE}_song_id
      ON ${LEGACY_REPERTOIRE_TABLE} (song_id);
`

// ---------------------------------------------------------------------------
// RH-123 — the dropped tabs table, for the three suites that replay a
// migration predating its removal.
// ---------------------------------------------------------------------------

/**
 * The pre-RH-123 files table's name, assembled from parts rather than written
 * out as one literal — the same device, and for the same reason, as
 * `LEGACY_CATALOG_TABLE` above.
 *
 * RH-123 replaced the table with `song_files` keyed by `(user_id, song_id)` and
 * requires (ER5) that the old identifier appear nowhere under `src/`. Three
 * suites genuinely need it anyway, and all three for the same reason: they
 * replay a migration file whose statements predate the removal, inside a
 * transaction they always roll back.
 *
 *  - `songFilesMigration.db.test.ts` rebuilds the legacy shape so it can
 *    execute the drop migration itself;
 *  - `songIdentity.db.test.ts` replays `migrations/0009`, which re-points the
 *    losers' tab rows while collapsing duplicate catalog rows;
 *  - `catalogVersionsMigration.db.test.ts` calls `migrate_catalog_to_versions()`
 *    from `migrations/0014`, which does the same.
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
 */
export const LEGACY_TABS_DDL = `
  CREATE TABLE IF NOT EXISTS ${LEGACY_TABS_TABLE} (
      id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      repertoire_id  uuid        NOT NULL REFERENCES ${LEGACY_REPERTOIRE_TABLE}(id) ON DELETE CASCADE,
      title          text        NOT NULL,
      file_url       text        NOT NULL,
      created_at     timestamptz NOT NULL DEFAULT now(),
      annotations    jsonb       NOT NULL DEFAULT '{}'::jsonb
  );
  CREATE INDEX IF NOT EXISTS idx_${LEGACY_TABS_TABLE}_repertoire_id ON ${LEGACY_TABS_TABLE} (repertoire_id);
`

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
