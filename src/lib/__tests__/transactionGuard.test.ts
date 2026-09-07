/**
 * RH-36 — Guardrail: transaction control never goes through `query()`.
 *
 * `query()` is `pool.query()`: it checks out an arbitrary idle connection per
 * call and hands it straight back, so a `BEGIN` issued through it opens a
 * transaction on a connection the following statements may never see, and
 * leaves that connection idle in transaction until the pool reaps it. Atomic
 * writes go through `withTransaction` (AGENTS.md, "Transactions") instead.
 *
 * `findViolations` accepts exactly one skipped path and it is spent on
 * `src/lib/db.ts`, where `withTransaction` legitimately issues the three
 * statements on its own client. The ban is therefore absolute for every other
 * file under `src/`, test files included.
 *
 * The offending literal is never written out in this file — the sample is built
 * by string concatenation, as `errorHandlingStyle.test.ts` does — so a plain
 * `grep` for the banned form does not flag this file either.
 */

import { describe, it, expect } from 'vitest'
import { findViolations, formatViolations } from './test-helpers'

/** The one file allowed to issue transaction control, on its own client. */
const DB_MODULE = 'src/lib/db.ts'

/** Matches a transaction-control keyword handed as a string literal to `query(`. */
const TX_CONTROL_THROUGH_QUERY = /query\(\s*['"`](BEGIN|COMMIT|ROLLBACK)\b/i

// Built by concatenation so the literal banned text never appears in this file.
const KEYWORD = 'BEGIN'
const OFFENDING_SAMPLE = "await query('" + KEYWORD + "')"
const CLEAN_SAMPLE = "await withTransaction(async (client) => client.query(sql, values))"

describe('the transaction-control detector', () => {
  it('matches a transaction-control literal handed to query()', () => {
    expect(TX_CONTROL_THROUGH_QUERY.test(OFFENDING_SAMPLE)).toBe(true)
    expect(TX_CONTROL_THROUGH_QUERY.test(CLEAN_SAMPLE)).toBe(false)
  })
})

describe('src/ tree', () => {
  it('issues no transaction control through query() outside src/lib/db.ts', () => {
    const violations = formatViolations(
      findViolations(TX_CONTROL_THROUGH_QUERY, { skip: DB_MODULE }),
    )

    expect(
      violations,
      `Transaction control through \`query()\` is forbidden (see AGENTS.md, ` +
        `"Transactions"): \`query()\` is \`pool.query()\`, so the statements do ` +
        `not share a connection and the one that opened the transaction leaks ` +
        `idle in transaction. Use \`withTransaction\` from \`@/lib/db\` instead. ` +
        `Offending locations:\n` +
        violations.join('\n'),
    ).toEqual([])
  })
})
