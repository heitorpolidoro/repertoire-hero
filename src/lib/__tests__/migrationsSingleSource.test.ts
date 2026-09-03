/**
 * RH-17 — Guardrail: `migrations/` is the single source of truth for the schema.
 *
 * The repository used to carry a second, divergent copy of the schema under
 * `supabase/migrations/`. It could not build the database (it had no
 * counterpart for `0002_add_tabs_and_lyrics.sql` and its initial schema was
 * named `20260707000000_initial_schema.sql`, which sorts *after*
 * `0003_add_band_color.sql`). It was deleted; this test makes the drift
 * structurally detectable instead of policed by convention.
 *
 * Four invariants are enforced:
 *   a) no directory named `migrations` exists anywhere in the repository other
 *      than `<repoRoot>/migrations`;
 *   b) every entry in `migrations/` is a file named `NNNN_snake_case.sql`;
 *   c) the four-digit prefixes are unique and contiguous starting at `0001`
 *      (lexicographic sort must equal intended apply order, because both
 *      `scripts/migrate.mjs` and `docker/init-migrations.sh` rely on it);
 *   d) `docker-compose.yml` bind-mounts `./migrations` for first-boot init.
 *
 * Invariant (a) is a filesystem walk, deliberately *not* a walk over
 * `git ls-files`: drift arrives untracked before it arrives committed, and an
 * untracked `supabase/migrations/0007_x.sql` must trip this guard too.
 *
 * No database is required by any test here.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations')
const DOCKER_COMPOSE = path.join(REPO_ROOT, 'docker-compose.yml')

/**
 * Directory names the walk refuses to descend into.
 *
 * Build/tooling output is skipped for speed; the agent directories are skipped
 * for correctness. `.claude/worktrees/` is gitignored and holds full agent
 * checkouts of this very repository — several of them still contain a
 * `supabase/migrations/` directory of their own, so a walk that descended into
 * `.claude` would report drift against a correct working tree. `.gemini`,
 * `.agents`, `.meridian` and `.idea` are skipped for the same reason (and for
 * symmetry with the `exclude` list in `vitest.config.ts`). Bare `.temp` and
 * `.branches` cover `supabase/.temp` and `supabase/.branches`.
 */
export const SKIPPED_DIRECTORY_NAMES: readonly string[] = [
  'node_modules',
  '.git',
  '.next',
  'coverage',
  '.vercel',
  'playwright-report',
  'postgres-data',
  '.temp',
  '.branches',
  '.claude',
  '.gemini',
  '.agents',
  '.meridian',
  '.idea',
]

const SKIPPED = new Set(SKIPPED_DIRECTORY_NAMES)

/** A migration filename: four-digit ordering prefix + snake_case name + `.sql`. */
export const MIGRATION_FILENAME_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/

/**
 * Returns every directory named `migrations` at or below `root`, as absolute
 * paths, sorted. Directories in {@link SKIPPED_DIRECTORY_NAMES} are not
 * descended into. Symlinks are not followed (`Dirent.isDirectory()` is false
 * for them).
 */
export function findMigrationDirectories(root: string): string[] {
  const found: string[] = []

  const walk = (dir: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIPPED.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.name === 'migrations') found.push(full)
      walk(full)
    }
  }

  walk(root)
  return found.sort()
}

/**
 * Returns the entry names that do not match {@link MIGRATION_FILENAME_PATTERN}.
 */
export function findMigrationNamingViolations(names: string[]): string[] {
  return names.filter((name) => !MIGRATION_FILENAME_PATTERN.test(name))
}

/**
 * Returns human-readable complaints about the four-digit ordering prefixes of
 * `names`: duplicates, gaps, or a sequence that does not start at `0001`.
 * Empty array when the numbering is unique and contiguous.
 */
export function findNumberingViolations(names: string[]): string[] {
  const violations: string[] = []
  const seen = new Set<string>()

  for (const name of [...names].sort()) {
    const prefix = name.slice(0, 4)
    if (seen.has(prefix)) {
      violations.push(`duplicate migration number ${prefix} (${name})`)
    } else {
      seen.add(prefix)
    }
  }

  const actual = [...seen].sort()
  const expected = actual.map((_, index) => String(index + 1).padStart(4, '0'))
  actual.forEach((prefix, index) => {
    if (prefix !== expected[index]) {
      violations.push(
        `migration numbering is not contiguous: expected ${expected[index]}, found ${prefix}`,
      )
    }
  })

  return violations
}

describe('findMigrationDirectories (detector)', () => {
  it('finds nested migrations directories but never descends into skipped ones', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rh17-'))
    try {
      fs.mkdirSync(path.join(root, 'migrations'))
      fs.mkdirSync(path.join(root, 'supabase', 'migrations'), { recursive: true })
      fs.mkdirSync(path.join(root, 'node_modules', 'pkg', 'migrations'), { recursive: true })
      fs.mkdirSync(path.join(root, '.claude', 'worktrees', 'a', 'supabase', 'migrations'), {
        recursive: true,
      })
      fs.mkdirSync(path.join(root, '.meridian', 'migrations'), { recursive: true })
      fs.mkdirSync(path.join(root, 'supabase', '.temp', 'migrations'), { recursive: true })

      expect(findMigrationDirectories(root)).toEqual([
        path.join(root, 'migrations'),
        path.join(root, 'supabase', 'migrations'),
      ])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns only the top-level directory when nothing else is named migrations', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rh17-'))
    try {
      fs.mkdirSync(path.join(root, 'migrations'))
      fs.mkdirSync(path.join(root, 'supabase'))
      expect(findMigrationDirectories(root)).toEqual([path.join(root, 'migrations')])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips every documented tooling directory', () => {
    for (const name of [
      'node_modules',
      '.git',
      '.next',
      'coverage',
      '.vercel',
      'playwright-report',
      'postgres-data',
      '.temp',
      '.branches',
      '.claude',
      '.gemini',
      '.agents',
      '.meridian',
      '.idea',
    ]) {
      expect(SKIPPED_DIRECTORY_NAMES).toContain(name)
    }
  })
})

describe('findMigrationNamingViolations (detector)', () => {
  it('accepts the NNNN_snake_case.sql convention', () => {
    expect(
      findMigrationNamingViolations(['0001_initial_schema.sql', '0012_add_tab_annotations.sql']),
    ).toEqual([])
  })

  it('rejects a timestamp-prefixed name, an uppercase name and a non-sql entry', () => {
    expect(
      findMigrationNamingViolations([
        '20260707000000_initial_schema.sql',
        '0002_AddTabs.sql',
        '0003_add_band_color.txt',
        'README.md',
      ]),
    ).toEqual([
      '20260707000000_initial_schema.sql',
      '0002_AddTabs.sql',
      '0003_add_band_color.txt',
      'README.md',
    ])
  })
})

describe('findNumberingViolations (detector)', () => {
  it('accepts a contiguous sequence starting at 0001', () => {
    expect(
      findNumberingViolations(['0001_a.sql', '0002_b.sql', '0003_c.sql']),
    ).toEqual([])
  })

  it('reports duplicated numbers (two branches both adding 0007)', () => {
    const violations = findNumberingViolations(['0001_a.sql', '0002_b.sql', '0002_c.sql'])
    expect(violations.join('\n')).toContain('duplicate migration number 0002')
  })

  it('reports a gap left by an accidental deletion', () => {
    const violations = findNumberingViolations(['0001_a.sql', '0003_c.sql'])
    expect(violations.join('\n')).toContain('not contiguous')
  })

  it('reports a sequence that does not start at 0001', () => {
    const violations = findNumberingViolations(['20260707000000_initial_schema.sql'])
    expect(violations.join('\n')).toContain('not contiguous')
  })
})

describe('repository migration layout', () => {
  it('has exactly one migrations directory, at the repository root', () => {
    const directories = findMigrationDirectories(REPO_ROOT)
    const unexpected = directories
      .filter((dir) => dir !== MIGRATIONS_DIR)
      .map((dir) => path.relative(REPO_ROOT, dir))

    expect(
      unexpected,
      `Schema migrations live only in \`migrations/\`; do not create a second ` +
        `copy. Delete the following director${unexpected.length === 1 ? 'y' : 'ies'} ` +
        `and keep every migration in \`migrations/\`:\n${unexpected.join('\n')}`,
    ).toEqual([])

    expect(directories).toContain(MIGRATIONS_DIR)
  })

  it('contains only files named NNNN_snake_case.sql', () => {
    const entries = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })

    const subdirectories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join('migrations', entry.name))
    expect(
      subdirectories,
      `\`migrations/\` must contain migration files only — no subdirectories. ` +
        `Offending paths:\n${subdirectories.join('\n')}`,
    ).toEqual([])

    const names = entries.map((entry) => entry.name)
    const violations = findMigrationNamingViolations(names).map((name) =>
      path.join('migrations', name),
    )
    expect(
      violations,
      `Every migration must be named \`NNNN_snake_case.sql\` so that a ` +
        `lexicographic sort equals the intended apply order used by ` +
        `scripts/migrate.mjs and docker/init-migrations.sh. Rename:\n` +
        violations.join('\n'),
    ).toEqual([])
  })

  it('numbers its migrations uniquely and contiguously from 0001', () => {
    const names = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)

    const violations = findNumberingViolations(names)
    expect(
      violations,
      `Migration numbering in \`migrations/\` must be unique and contiguous ` +
        `starting at 0001. Renumber the new migration to continue the ` +
        `sequence:\n${violations.join('\n')}`,
    ).toEqual([])
  })
})

describe('docker-compose.yml database initialisation', () => {
  const compose = fs.readFileSync(DOCKER_COMPOSE, 'utf8')

  it('bind-mounts ./migrations into the db init directory', () => {
    expect(
      /^\s*-\s*\.\/migrations:\/docker-entrypoint-initdb\.d\/migrations(:ro)?\s*$/m.test(compose),
      'docker-compose.yml must mount `./migrations` at ' +
        '`/docker-entrypoint-initdb.d/migrations` so a fresh local database is ' +
        'built from the single source of truth.',
    ).toBe(true)
  })

  it('never mounts a second migrations directory', () => {
    expect(
      compose.includes('supabase/migrations'),
      'docker-compose.yml must not reference `supabase/migrations`; that ' +
        'directory was deleted in RH-17 and `migrations/` is the only source ' +
        'of truth.',
    ).toBe(false)
  })
})
