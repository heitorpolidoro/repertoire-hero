/**
 * RH-124 — the three source-tree rules the split leaves behind.
 *
 * Each is a property no single test case can establish, because what it asserts
 * is the *absence* of something anywhere under `src/`:
 *
 *  - **ER5** — `repertoire` is gone as a table. The migration dropped it; what
 *    this guard stops is a statement growing back later, and a trigger name the
 *    restructure retired being reintroduced by a copy-paste.
 *  - **ER4** — every join onto `albums` in the representative-version ordering
 *    is a `LEFT JOIN`. `song_versions.album_id` is nullable on purpose, so an
 *    inner join silently drops every album-less version. In the migration that
 *    cost a row; here it costs a version a musician holds.
 *  - **ER8** — the cascade is never written in SQL. One `COALESCE` across
 *    levels would be a second implementation of `resolveSongFields`, and two
 *    foldings cannot be kept in step; the one that disagrees is silently wrong
 *    rather than broken.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { representativeVersionSubquery } from '@/lib/songVersions'
import { findViolations, formatViolations } from './test-helpers'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')

/**
 * The one file allowed to name the dropped table in a statement: it rebuilds
 * the legacy shape in order to execute the migration against it.
 * `test-helpers.ts` holds the DDL and the name itself, but names it only in
 * `CREATE TABLE` / `REFERENCES`, which no pattern below covers.
 */
const MIGRATION_TEST = 'src/lib/__tests__/ownerSongsMigration.db.test.ts'

/**
 * `FROM`, `JOIN`, `UPDATE` and `INTO` are matched **case-sensitively**, because
 * every SQL keyword under `src/` is uppercase and the lowercase forms have an
 * English reading this guard must not trip on — `Failed to remove song from
 * repertoire` is a user-facing message, not a statement. The three forms with
 * no English reading at all are matched case-insensitively as well, which is
 * what covers the lowercased SQL the mock dispatchers in `errors.test.ts` and
 * `edge_cases.test.ts` pattern-match on.
 */
const SQL_TABLE_UPPERCASE = /\b(FROM|JOIN|INTO|UPDATE)\s+repertoire\b/
const SQL_TABLE_UNAMBIGUOUS = /\b(insert\s+into|update|delete\s+from|join)\s+repertoire\b/i

/** RH-96 dropped both; naming either here would reintroduce the identifier. */
const RETIRED_TRIGGER = /sync_band_repertoire_on_member_update|trg_sync_band_repertoire/

/**
 * A `COALESCE` whose argument list names one of the four cascaded columns.
 * Deliberately broader than "across levels": the helper is the only place any
 * of the four is folded, so a SQL `COALESCE` over `lyrics`, `map`, `key` or
 * `tuning` has no legitimate form here at all, and a guard that tried to decide
 * which ones span levels would be the second implementation it is meant to
 * prevent.
 */
const SQL_CASCADE_COALESCE = /COALESCE\s*\([^)]*(\blyrics\b|\btuning\b|\.key\b|\.map\b)/i

describe('RH-124 ER5 — the dropped table is named by no statement', () => {
  it('names repertoire as a table nowhere under src/ or e2e/, bar the migration test', () => {
    const violations = [
      ...findViolations(SQL_TABLE_UPPERCASE, { skip: MIGRATION_TEST, alsoE2E: true }),
      ...findViolations(SQL_TABLE_UNAMBIGUOUS, { skip: MIGRATION_TEST, alsoE2E: true }),
    ].filter((v) => v.file !== 'src/lib/__tests__/ownerSongsGuards.test.ts')

    expect(formatViolations(violations)).toEqual([])
  })

  it('names neither the retired band-status trigger nor its function', () => {
    const violations = findViolations(RETIRED_TRIGGER, {
      skip: 'src/lib/__tests__/ownerSongsGuards.test.ts',
      alsoE2E: true,
    })

    expect(formatViolations(violations)).toEqual([])
  })
})

describe('RH-124 ER4 — every join onto albums is a LEFT JOIN', () => {
  /** `src/`, plus the migration, which carries the same ordering in SQL. */
  const migrationFile = (): string => {
    const dir = path.join(REPO_ROOT, 'migrations')
    const names = fs.readdirSync(dir).filter((n) => n.endsWith('_split_repertoire_owner_songs.sql'))
    expect(names).toHaveLength(1)
    return fs.readFileSync(path.join(dir, names[0]), 'utf8')
  }

  it('finds no bare JOIN albums in production source', () => {
    // The negative lookbehind excludes `LEFT JOIN albums`, so anything this
    // matches is an inner join. `__tests__` is excluded: a test asserting a row
    // it has just created may inner-join deliberately, and only production
    // source carries the representative-version ordering.
    const violations = findViolations(/(?<!LEFT\s)\bJOIN\s+albums\b/i).filter(
      (v) => !v.file.includes('__tests__'),
    )

    expect(formatViolations(violations)).toEqual([])
  })

  it('spells the ordering itself with a LEFT JOIN, in the one place it exists', () => {
    const subquery = representativeVersionSubquery('$1')

    expect(subquery).toContain('LEFT JOIN albums')
    expect(subquery).not.toMatch(/(?<!LEFT\s)\bJOIN\s+albums\b/)
    // Nulls last at both album levels, and the two version-level tiebreakers
    // that make the pick total for a song whose every version is album-less.
    expect(subquery).toContain("album_type = 'album') DESC NULLS LAST")
    expect(subquery).toContain('release_date ASC NULLS LAST')
    expect(subquery).toMatch(/created_at ASC, \w+\.id ASC/)
  })

  it('finds no bare JOIN albums in the migration, and at least one LEFT JOIN', () => {
    const sql = migrationFile()

    expect(sql.match(/(?<!LEFT\s)\bJOIN\s+albums\b/gi)).toBeNull()
    // The ordering appears twice: once per owner table.
    expect(sql.match(/LEFT JOIN albums\b/g)).toHaveLength(2)
  })
})

describe('RH-124 ER8 — the cascade is not written in SQL', () => {
  it('coalesces none of lyrics, map, key or tuning in any query under src/', () => {
    const violations = findViolations(SQL_CASCADE_COALESCE, {
      skip: 'src/lib/__tests__/ownerSongsGuards.test.ts',
    })

    expect(formatViolations(violations)).toEqual([])
  })
})
