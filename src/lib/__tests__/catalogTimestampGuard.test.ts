/**
 * RH-101 — Guardrail: every `UPDATE songs` keeps `updated_at` current.
 *
 * `migrations/0011` gave the catalog the `updated_at` column the other four
 * mutable tables already carry, and this
 * repository maintains such a column in the writing statement's own `SET` list
 * (`src/lib/bands.ts`, `src/lib/playlists.ts`, `src/lib/spotifyAuth.ts`,
 * `src/lib/moderation.ts`) rather than with a `BEFORE UPDATE` trigger. Triggers
 * here are reserved for cross-row invariants application code cannot hold
 * (`sync_profile_email_on_user_update`).
 *
 * **This guard is the substitute for the timestamp trigger the project chose
 * not to add.** The one thing a trigger would buy that the convention does not
 * — a writer that forgets the clause cannot produce a stale timestamp — is
 * bought here instead, statically, in the repository's own guard idiom
 * (`transactionGuard`, `identityWriteGuard`, `actionDataAccessGuard`).
 *
 * SCAN SCOPE, AND WHY THE EXCLUSION IS LOAD-BEARING. Production source only:
 * every `.ts`/`.tsx` file under `src/` **whose path contains no `__tests__`
 * segment**, plus every `.mjs` file directly under `scripts/`. No
 * `migrations/`, no `e2e/`, no test file. Three things would otherwise break
 * the guard:
 *   1. `src/lib/__tests__/moderation.test.ts` asserts the bare fragment
 *      `stringContaining('UPDATE songs')`, which carries no `WHERE` of
 *      its own — a scan would run past it to an unrelated later `WHERE` and
 *      report a false violation;
 *   2. a comment in that same file names the statement in prose;
 *   3. this file and `catalogTimestamp.db.test.ts` both contain the literals,
 *      so a self-including scan would let the exact-count check below be
 *      satisfied by the guard matching itself.
 *
 * Comments are stripped before matching, so `src/lib/catalogFields.ts`'s doc
 * comment ("One column the `UPDATE songs` SET list may carry") is prose,
 * not a statement, and is not counted.
 *
 * WHY THE PATTERN STILL ONLY MATCHES THE CATALOG. RH-121 renamed the catalog
 * table to `songs`, dropping the `global_` prefix it carried since
 * `0001_initial_schema.sql`. That shortened the pattern to a string three
 * sibling tables contain as a suffix — `playlist_songs`, and the `user_songs` /
 * `band_songs` the restructuring plan will add. `UPDATE\s+songs\b` cannot
 * match any of them: the whitespace run has to be followed immediately by
 * `songs`, and in `UPDATE playlist_songs` the next character after it is `p`.
 * The trailing `\b` closes the other end, so a future `songs_archive` is not
 * matched either. Both halves are pinned by detector cases below, because the
 * failure they guard against is silent: a false positive here would be read as
 * a real stale-timestamp violation in a table that has no such rule.
 */

import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'
import { stripComments } from './test-helpers'

const REPO_ROOT = path.resolve(__dirname, '../../..')

/**
 * The exact number of `UPDATE songs` statements production source is
 * expected to hold: two in `src/lib/songs.ts`, one in
 * `src/lib/spotifyPlaylistSync.ts`, one in `src/lib/moderation.ts` and three in
 * `scripts/deduplicate-songs.mjs`. Asserted exactly, not as "at least one": an
 * exact count also fails when a new writer is added without being reviewed
 * against this rule, which is the point of the guard.
 */
const EXPECTED_CATALOG_WRITERS = 7

/** Start of a catalog write. Any case, any run of whitespace. */
const CATALOG_UPDATE = /UPDATE\s+songs\b/gi

/** The clause that keeps the column current. */
const TIMESTAMP_CLAUSE = /\bupdated_at\s*=\s*now\(\)/i

/** The end of a statement's `SET` list, as far as this guard cares. */
const WHERE_KEYWORD = /\bWHERE\b/i

/**
 * One `UPDATE songs` occurrence that does not set `updated_at` before
 * its `WHERE`.
 */
interface TimestampViolation {
  /** 1-based line number of the `UPDATE` within the file. */
  line: number
  /** The `SET` list as scanned, collapsed to one line. */
  text: string
}

/**
 * Every catalog write in `source` whose text, from `UPDATE songs` up to
 * the next `WHERE`, omits `updated_at = now()`. The scan spans lines on
 * purpose: `src/lib/moderation.ts` builds its statement across three, with the
 * clause sitting between the interpolated `SET` list and `WHERE`.
 */
export function findStaleCatalogWrites(source: string): TimestampViolation[] {
  const stripped = stripComments(source)
  const violations: TimestampViolation[] = []
  for (const match of stripped.matchAll(CATALOG_UPDATE)) {
    const rest = stripped.slice(match.index)
    const where = rest.search(WHERE_KEYWORD)
    const setList = where === -1 ? rest : rest.slice(0, where)
    if (!TIMESTAMP_CLAUSE.test(setList)) {
      violations.push({
        line: stripped.slice(0, match.index).split('\n').length,
        text: setList.replace(/\s+/g, ' ').trim(),
      })
    }
  }
  return violations
}

/** How many catalog writes `source` holds, comments excluded. */
export function countCatalogWrites(source: string): number {
  return [...stripComments(source).matchAll(CATALOG_UPDATE)].length
}

/** Recursively lists the production `.ts`/`.tsx` files under `src/`. */
function listProductionSources(dir: string): string[] {
  const files: string[] = []
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (dirent.name === '__tests__') continue
    const full = path.join(dir, dirent.name)
    if (dirent.isDirectory()) {
      files.push(...listProductionSources(full))
    } else if (/\.tsx?$/.test(dirent.name)) {
      files.push(full)
    }
  }
  return files
}

/** The scanned set: production `src/` plus the `.mjs` tooling under `scripts/`. */
function scannedFiles(): string[] {
  const scripts = fs
    .readdirSync(path.join(REPO_ROOT, 'scripts'), { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.mjs'))
    .map((d) => path.join(REPO_ROOT, 'scripts', d.name))
  return [...listProductionSources(path.join(REPO_ROOT, 'src')), ...scripts]
}

/** Repo-relative, `/`-separated path for a message. */
function relative(full: string): string {
  return path.relative(REPO_ROOT, full).split(path.sep).join('/')
}

// Built by concatenation so this file's own samples are not mistaken for the
// real thing by a reader grepping for the statement.
const UPD = 'UPDATE songs SET'
const STALE = `${UPD} links = $1 WHERE id = $2`
const CURRENT = `${UPD} links = $1, updated_at = now() WHERE id = $2`
const TEMPLATED = `const sql = \`${UPD} \${setClauses.join(\n  ', '\n)}, updated_at = now() WHERE id = $\${n}\``
const PROSE = `/** One column the ${UPD} list may carry. */`
const AFTER_WHERE = `${UPD} links = $1 WHERE id = $2 AND updated_at = now()`
const SIBLING_TABLE = 'UPDATE playlist_songs SET song_id = $1 WHERE id = $2'
const SUFFIXED_TABLE = 'UPDATE songs_archive SET links = $1 WHERE id = $2'

describe('findStaleCatalogWrites (detector)', () => {
  it('flags a catalog write with no timestamp clause', () => {
    expect(findStaleCatalogWrites(STALE)).toHaveLength(1)
  })

  it('accepts a catalog write that sets the timestamp', () => {
    expect(findStaleCatalogWrites(CURRENT)).toEqual([])
  })

  it('accepts a clause that spans lines around an interpolated SET list', () => {
    expect(findStaleCatalogWrites(TEMPLATED)).toEqual([])
  })

  it('does not count the statement named inside a doc comment', () => {
    expect(countCatalogWrites(PROSE)).toBe(0)
    expect(findStaleCatalogWrites(PROSE)).toEqual([])
  })

  it('flags a clause that sits after the WHERE instead of in the SET list', () => {
    expect(findStaleCatalogWrites(AFTER_WHERE)).toHaveLength(1)
  })

  it('ignores a sibling table whose name merely ends in the catalog name', () => {
    expect(countCatalogWrites(SIBLING_TABLE)).toBe(0)
    expect(findStaleCatalogWrites(SIBLING_TABLE)).toEqual([])
  })

  it('ignores a table whose name merely starts with the catalog name', () => {
    expect(countCatalogWrites(SUFFIXED_TABLE)).toBe(0)
    expect(findStaleCatalogWrites(SUFFIXED_TABLE)).toEqual([])
  })
})

describe('production catalog writers', () => {
  it('all set updated_at = now() before their WHERE', () => {
    const violations = scannedFiles().flatMap((full) =>
      findStaleCatalogWrites(fs.readFileSync(full, 'utf8')).map(
        (v) => `${relative(full)}:${v.line} — ${v.text}`,
      ),
    )

    expect(
      violations,
      `Every \`UPDATE songs\` must set \`updated_at = now()\` in its ` +
        `\`SET\` list: \`songs\` has no timestamp trigger, so a ` +
        `statement that omits the clause leaves the column stale for every ` +
        `consumer of it (see this file's header). Offending statements:\n` +
        violations.join('\n'),
    ).toEqual([])
  })

  it(`number exactly ${EXPECTED_CATALOG_WRITERS}`, () => {
    const found = scannedFiles().flatMap((full) => {
      const count = countCatalogWrites(fs.readFileSync(full, 'utf8'))
      return count > 0 ? [`${relative(full)} (${count})`] : []
    })
    const total = found.reduce(
      (sum, entry) => sum + Number(/\((\d+)\)$/.exec(entry)?.[1] ?? 0),
      0,
    )

    expect(
      total,
      `A catalog writer was added or removed. Review it against the ` +
        `\`updated_at = now()\` rule above, then update ` +
        `EXPECTED_CATALOG_WRITERS. Found:\n${found.join('\n')}`,
    ).toBe(EXPECTED_CATALOG_WRITERS)
  })
})
