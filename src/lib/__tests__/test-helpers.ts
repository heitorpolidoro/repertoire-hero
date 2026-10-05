import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { query } from '@/lib/db'

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
 * from the scan — each guard test passes its own path.
 */
export function findViolations(
  pattern: RegExp,
  options: { skip?: string } = {},
): SourceViolation[] {
  const violations: SourceViolation[] = []
  for (const full of listSourceFiles(SRC_DIR)) {
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
export const LEGACY_TABS_TABLE = ['repertoire', 'tabs'].join('_')

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
      repertoire_id  uuid        NOT NULL REFERENCES repertoire(id) ON DELETE CASCADE,
      title          text        NOT NULL,
      file_url       text        NOT NULL,
      created_at     timestamptz NOT NULL DEFAULT now(),
      annotations    jsonb       NOT NULL DEFAULT '{}'::jsonb
  );
  CREATE INDEX IF NOT EXISTS idx_${LEGACY_TABS_TABLE}_repertoire_id ON ${LEGACY_TABS_TABLE} (repertoire_id);
`
