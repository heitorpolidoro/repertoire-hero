import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { query } from '@/lib/db'

/**
 * One row handed to `insert`/`update`/`upsert`, or read back from a statement:
 * a plain column record whose values are `unknown`, mirroring `DbRow` in
 * `src/lib/db.ts` (RH-54). This module never handles anything else.
 */
type MockRow = Record<string, unknown>

class SupabaseMockChain {
  private table: string
  private action: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
  /**
   * The pending write payload, normalized to an array at set time so the SQL
   * builders below read one shape instead of a row-or-rows union. An `update`
   * always holds exactly one entry.
   */
  private actionData: MockRow[] = []
  private conditions: { type: 'eq' | 'in' | 'ilike'; col: string; val: unknown }[] = []
  private singleResult = false
  private maybeSingleResult = false

  constructor(table: string) {
    this.table = table
  }

  select(fields?: string) {
    if (this.action === 'select') {
      this.action = 'select'
    }
    return this
  }

  insert(data: MockRow | MockRow[]) {
    this.action = 'insert'
    this.actionData = Array.isArray(data) ? data : [data]
    return this
  }

  update(data: MockRow) {
    this.action = 'update'
    this.actionData = [data]
    return this
  }

  delete() {
    this.action = 'delete'
    return this
  }

  upsert(data: MockRow | MockRow[]) {
    this.action = 'upsert'
    this.actionData = Array.isArray(data) ? data : [data]
    return this
  }

  eq(col: string, val: unknown) {
    this.conditions.push({ type: 'eq', col, val })
    return this
  }

  in(col: string, val: unknown) {
    this.conditions.push({ type: 'in', col, val })
    return this
  }

  ilike(col: string, val: unknown) {
    this.conditions.push({ type: 'ilike', col, val })
    return this
  }

  single() {
    this.singleResult = true
    return this
  }

  maybeSingle() {
    this.maybeSingleResult = true
    return this
  }

  async then(
    onfulfilled?: (value: { data: unknown; error: { message?: string; code?: string } | null }) => unknown,
    onrejected?: (reason: unknown) => unknown,
  ) {
    try {
      let sql = ''
      const params: unknown[] = []
      let paramIndex = 1

      if (this.action === 'select') {
        sql = `SELECT * FROM "${this.table}"`
      } else if (this.action === 'insert') {
        const rows = this.actionData
        const keys = Object.keys(rows[0])
        const columns = keys.map(k => `"${k}"`).join(', ')
        const valuesClauses = rows.map((row: MockRow) => {
          return '(' + keys.map(k => {
            const val = row[k]
            params.push(typeof val === 'object' && val !== null ? JSON.stringify(val) : val)
            return `$${paramIndex++}`
          }).join(', ') + ')'
        }).join(', ')

        sql = `INSERT INTO "${this.table}" (${columns}) VALUES ${valuesClauses} RETURNING *`
      } else if (this.action === 'update') {
        const row = this.actionData[0]
        const keys = Object.keys(row)
        const setClauses = keys.map(k => {
          const val = row[k]
          params.push(typeof val === 'object' && val !== null ? JSON.stringify(val) : val)
          return `"${k}" = $${paramIndex++}`
        }).join(', ')
        sql = `UPDATE "${this.table}" SET ${setClauses}`
      } else if (this.action === 'delete') {
        sql = `DELETE FROM "${this.table}"`
      } else if (this.action === 'upsert') {
        const rows = this.actionData
        const keys = Object.keys(rows[0])
        const columns = keys.map(k => `"${k}"`).join(', ')
        const valuesClauses = rows.map((row: MockRow) => {
          return '(' + keys.map(k => {
            const val = row[k]
            params.push(typeof val === 'object' && val !== null ? JSON.stringify(val) : val)
            return `$${paramIndex++}`
          }).join(', ') + ')'
        }).join(', ')

        let conflictTarget = ''
        if (this.table === 'repertoire') {
          const hasUserId = keys.includes('user_id')
          if (hasUserId) {
            conflictTarget = '(user_id, song_id) WHERE user_id IS NOT NULL'
          } else {
            conflictTarget = '(band_id, song_id) WHERE band_id IS NOT NULL'
          }
        } else if (this.table === 'spotify_tokens') {
          conflictTarget = '(user_id)'
        } else {
          conflictTarget = '(id)'
        }

        const updateKeys = keys.filter(k => k !== 'id' && k !== 'user_id' && k !== 'band_id' && k !== 'song_id')
        let updateClause = 'DO NOTHING'
        if (updateKeys.length > 0) {
          updateClause = 'DO UPDATE SET ' + updateKeys.map(k => `"${k}" = EXCLUDED."${k}"`).join(', ')
        }

        sql = `INSERT INTO "${this.table}" (${columns}) VALUES ${valuesClauses} ON CONFLICT ${conflictTarget} ${updateClause} RETURNING *`
      }

      const whereClauses: string[] = []
      for (const cond of this.conditions) {
        if (cond.type === 'eq') {
          if (cond.val === null) {
            whereClauses.push(`"${cond.col}" IS NULL`)
          } else {
            params.push(cond.val)
            whereClauses.push(`"${cond.col}" = $${paramIndex++}`)
          }
        } else if (cond.type === 'in') {
          params.push(cond.val)
          whereClauses.push(`"${cond.col}" = ANY($${paramIndex++})`)
        } else if (cond.type === 'ilike') {
          params.push(cond.val)
          whereClauses.push(`"${cond.col}" ILIKE $${paramIndex++}`)
        }
      }

      if (whereClauses.length > 0) {
        sql += ` WHERE ${whereClauses.join(' AND ')}`
      }

      if (this.action === 'update' || this.action === 'delete') {
        sql += ' RETURNING *'
      }

      const res = await query(sql, params)
      let data: unknown = res.rows

      if (this.singleResult) {
        if (res.rowCount === 0) {
          throw new Error('No rows found')
        }
        data = res.rows[0]
      } else if (this.maybeSingleResult) {
        data = res.rowCount === 0 ? null : res.rows[0]
      }

      const result = { data, error: null }
      return onfulfilled ? onfulfilled(result) : result
    } catch (err) {
      const e = err as { message?: string; code?: string }
      const result = { data: null, error: { message: e.message, code: e.code } }
      return onfulfilled ? onfulfilled(result) : result
    }
  }
}

class SupabaseMockClient {
  auth = {
    signInWithPassword: async () => ({ data: { user: {} }, error: null }),
    signOut: async () => ({ error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    admin: {
      createUser: async () => ({ data: { user: { id: randomUUID() } }, error: null }),
      deleteUser: async () => ({ error: null }),
    }
  }

  from(table: string) {
    return new SupabaseMockChain(table)
  }
}

const mockClient = new SupabaseMockClient()

export function createAdminTestClient(): SupabaseMockClient {
  return mockClient
}

export async function createTestUser(
  admin: SupabaseMockClient,
  { email, name = 'Test User' }: { email: string; name?: string },
): Promise<string> {
  const userId = randomUUID()
  await query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)', [userId, name, email])
  await query('INSERT INTO profiles (id, email, full_name) VALUES ($1, $2, $3)', [userId, email, name])
  return userId
}

export async function deleteTestUser(admin: SupabaseMockClient, userId: string): Promise<void> {
  await query('DELETE FROM "user" WHERE id = $1', [userId])
}

export async function createTestUserWithGoTrue(
  admin: SupabaseMockClient,
  { email, name = 'Test User', password = 'password123' }: { email: string; name?: string; password?: string },
): Promise<{ userId: string; password: string }> {
  const userId = randomUUID()
  await query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)', [userId, name, email])
  await query('INSERT INTO profiles (id, email, full_name) VALUES ($1, $2, $3)', [userId, email, name])
  return { userId, password }
}

export async function deleteTestUserWithGoTrue(admin: SupabaseMockClient, userId: string): Promise<void> {
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
