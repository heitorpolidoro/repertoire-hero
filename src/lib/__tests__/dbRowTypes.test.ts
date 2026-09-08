/**
 * RH-54 — Guardrail: the db layer's default row type is `DbRow`, not `any`.
 *
 * `tsconfig.json` excludes `**\/__tests__\/**`, so `tsc --noEmit` never
 * type-checks this file and vitest strips its types without checking them. A
 * type-level assertion placed here — an expect-error directive over a
 * deliberately wrong read — would therefore be inert. The guard is a source
 * scan instead, in the style of `errorHandlingStyle.test.ts`: it reads
 * `src/lib/db.ts` and `src/lib/dbRows.ts` off disk and asserts the shape of
 * what they declare.
 *
 * What it protects:
 * 1. `query`/`Queryable.query` keep `DbRow = Record<string, unknown>` as their
 *    default row type. Dropping the default instead would silently restore
 *    `any`, because `@types/pg` declares `QueryResultRow` as
 *    `{ [column: string]: any }`.
 * 2. `db.ts` stays free of the two `eslint-disable` comments and the `any`s
 *    they used to shield.
 * 3. Every row interface exported by `dbRows.ts` has a real consumer under
 *    `src/`, so the file cannot accumulate speculative types (the same rule
 *    `npm run lint:dead` enforces, checked here without needing knip).
 */

import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'
import { findViolations } from './test-helpers'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const SRC_DIR = path.join(REPO_ROOT, 'src')
const DB_PATH = path.join(SRC_DIR, 'lib', 'db.ts')
const DB_ROWS_PATH = path.join(SRC_DIR, 'lib', 'dbRows.ts')

/** Any line that imports from the row-type module. */
const DB_ROWS_IMPORT = /from '@\/lib\/dbRows'/

/** The names an `import ... from '@/lib/dbRows'` statement brings in (capture 1). */
const DB_ROWS_IMPORT_CLAUSE = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'@\/lib\/dbRows'/g

/** `: any`, `= any` or `any[]` — the three spellings the signature used to carry. */
const EXPLICIT_ANY = /:\s*any\b|=\s*any\b|any\[\]/

/** Counts non-overlapping occurrences of a plain substring. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return count
    count += 1
    from = at + needle.length
  }
}

/** The names exported as `export interface X` / `export type X` by a module. */
function exportedTypeNames(source: string): string[] {
  return [...source.matchAll(/^export (?:interface|type) ([A-Za-z0-9_]+)\b/gm)].map((m) => m[1])
}

/**
 * Every identifier imported from `@/lib/dbRows` by real source under `src/`.
 * `__tests__` is filtered out for the same reason ER2's consumer grep does it:
 * a guard test naming a row type is not a consumer of it.
 *
 * The file walk is `findViolations` from `test-helpers` (RH-23's shared
 * scanner), so this file carries no second copy of it.
 */
function importedRowTypeNames(): string[] {
  const consumers = new Set(
    findViolations(DB_ROWS_IMPORT)
      .map((violation) => violation.file)
      .filter((file) => !file.includes('/__tests__/')),
  )

  const names: string[] = []
  for (const file of consumers) {
    const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')
    for (const match of source.matchAll(DB_ROWS_IMPORT_CLAUSE)) {
      for (const clause of match[1].split(',')) {
        const name = clause.replace(/^\s*type\s+/, '').trim()
        if (name) names.push(name)
      }
    }
  }
  return names
}

describe('db row typing (RH-54)', () => {
  it('src/lib/db.ts uses DbRow as the default row type for query and Queryable', () => {
    const source = fs.readFileSync(DB_PATH, 'utf8')

    expect(countOccurrences(source, 'export type DbRow = Record<string, unknown>')).toBe(1)
    expect(countOccurrences(source, '= DbRow>')).toBe(2)
  })

  it('src/lib/db.ts carries no any and no eslint-disable comment', () => {
    const source = fs.readFileSync(DB_PATH, 'utf8')

    expect(countOccurrences(source, 'eslint-disable')).toBe(0)

    const offenders = source
      .split('\n')
      .filter((line) => EXPLICIT_ANY.test(line))
      .map((line) => line.trim())
    expect(offenders).toEqual([])
  })

  it('every type exported by src/lib/dbRows.ts is imported somewhere under src', () => {
    const exported = exportedTypeNames(fs.readFileSync(DB_ROWS_PATH, 'utf8'))
    expect(exported.length).toBeGreaterThan(0)

    const imported = new Set(importedRowTypeNames())
    expect(exported.filter((name) => !imported.has(name))).toEqual([])
  })
})
