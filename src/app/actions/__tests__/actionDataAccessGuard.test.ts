/**
 * RH-45 — Guardrail: the Server Action layer holds no data access.
 *
 * `src/app/actions/*.ts` resolves the session, delegates to `src/lib` and calls
 * `revalidatePath`. A statement written there duplicates an ownership predicate
 * that `src/lib` already states once, and puts it where no lib-level test can
 * reach it (AGENTS.md, architecture diagram and convention A2). The same rule
 * covers the connection itself: a hand-rolled `pg` client anywhere under `src/`
 * bypasses the shared pool in `src/lib/db.ts`, and with it the
 * `BETTER_AUTH_DATABASE_URL` fallback and the pool limits.
 *
 * Comments are stripped before scanning, so a comment that merely mentions a
 * call is not a violation. The banned client literal is never written out in
 * this file — the sample is built by string concatenation, as
 * `transactionGuard.test.ts` does — so a plain `grep` over `src/` for it does
 * not flag this guard either.
 */

import { describe, it, expect } from 'vitest'
import { findViolations, formatViolations, stripComments } from '@/lib/__tests__/test-helpers'
import { actionFileNames, readActionFile } from './actionScan'

/** The one file allowed to construct a Postgres connection. */
const DB_MODULE = 'src/lib/db.ts'

/** A `query(...)` call — the shape every statement in this codebase is issued through. */
const QUERY_CALL = /\bquery\s*\(/

/** An import of the database module, however the symbols are spelled. */
const DB_IMPORT = /from\s+['"]@\/lib\/db['"]/

// Built by concatenation so the literal banned text never appears in this file.
const NEW_CLIENT = new RegExp('new ' + 'Client' + '\\s*\\(')

const OFFENDING_QUERY = "const { rows } = await query('SELECT 1')"
const CLEAN_QUERY = "const rows = await listTabs(repertoireId, userId)"
const OFFENDING_IMPORT = "import { query } from '@/lib/db'"
const CLEAN_IMPORT = "import { listTabs } from '@/lib/tabs'"
const OFFENDING_CLIENT = 'const client = new ' + 'Client' + '({ connectionString })'
const CLEAN_CLIENT = 'const res = await query(sql, params)'

/** Every `file:line` under `src/app/actions` whose stripped source matches. */
function actionLayerViolations(pattern: RegExp): string[] {
  const violations: string[] = []
  for (const fileName of actionFileNames()) {
    stripComments(readActionFile(fileName))
      .split('\n')
      .forEach((line, index) => {
        if (pattern.test(line)) violations.push(`${fileName}:${index + 1} — ${line.trim()}`)
      })
  }
  return violations
}

describe('the data-access detectors', () => {
  it('match an offending sample and leave a clean one alone', () => {
    expect(QUERY_CALL.test(OFFENDING_QUERY)).toBe(true)
    expect(QUERY_CALL.test(CLEAN_QUERY)).toBe(false)

    expect(DB_IMPORT.test(OFFENDING_IMPORT)).toBe(true)
    expect(DB_IMPORT.test(CLEAN_IMPORT)).toBe(false)

    expect(NEW_CLIENT.test(OFFENDING_CLIENT)).toBe(true)
    expect(NEW_CLIENT.test(CLEAN_CLIENT)).toBe(false)
  })
})

describe('src/app/actions', () => {
  it('issues no query() call of its own', () => {
    const violations = actionLayerViolations(QUERY_CALL)

    expect(
      violations,
      `SQL is forbidden in the Server Action layer (see AGENTS.md, convention ` +
        `A2): an action resolves the session and delegates to a function in ` +
        `src/lib, which is the single place an ownership predicate is stated. ` +
        `Move the statement into src/lib and call it from here. Offending ` +
        `locations:\n` +
        violations.join('\n'),
    ).toEqual([])
  })

  it('imports no database module', () => {
    const violations = actionLayerViolations(DB_IMPORT)

    expect(
      violations,
      `\`@/lib/db\` must not be imported from the Server Action layer: reaching ` +
        `the pool from an action is what makes a statement possible there in ` +
        `the first place. Offending locations:\n` + violations.join('\n'),
    ).toEqual([])
  })
})

describe('src/ tree', () => {
  it('constructs no Postgres client of its own outside src/lib/db.ts', () => {
    const violations = formatViolations(findViolations(NEW_CLIENT, { skip: DB_MODULE }))

    expect(
      violations,
      `A hand-rolled \`pg\` client bypasses the shared pool in ${DB_MODULE} — ` +
        `and with it the BETTER_AUTH_DATABASE_URL fallback, the connection ` +
        `limits and the timeouts. Use \`query\` / \`withTransaction\` from ` +
        `\`@/lib/db\` instead. Offending locations:\n` + violations.join('\n'),
    ).toEqual([])
  })
})
