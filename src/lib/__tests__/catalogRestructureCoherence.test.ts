/**
 * RH-105 — the non-database half of the catalog restructure's integration
 * close-out (RH-121…RH-126).
 *
 * Plain `vitest`, no `describe.skipIf`, so every assertion here also runs inside
 * `npm run test:coverage`. Its database-backed twin is
 * `catalogRestructureIntegration.db.test.ts`.
 *
 * Six seams live here:
 *
 *  - the **migration chain** is a gapless, name-ordered sequence, and every
 *    relation the terminus schema expects present or absent is accounted for by
 *    a statement in `migrations/` (the ER1-ER3 expectations as data, so the
 *    shell commands those ERs run have a checked-in counterpart);
 *  - **ER6b** — `src/lib/tabs.ts` keys `song_files` on `id`, `song_id` and
 *    `user_id` and on nothing version-shaped, derived as a **set** rather than
 *    grepped for an absence;
 *  - **ER7** — the export count of `src/app/actions/repertoire.ts`, and the
 *    fact that its seven `resolveWriteOwner` callers are exactly the mutators
 *    the integration suite drives. Adding an export fails this suite and forces
 *    that list to be revisited;
 *  - **ER8** — the offline schema version has a terminus, and every superseded
 *    shape *with no upgrade path* is refused;
 *  - **ER9** — no non-test source removes a row from the shared catalog;
 *  - **ER11** — no `src/`, `scripts/`, `migrations/`, `e2e/` or `public/` path
 *    named in the live documentation dangles.
 *
 * **Every source-text assertion below is a set difference with a positive
 * control**: the same scan has to produce a non-empty result on the population
 * it is meant to search, so a scan that silently matches nothing cannot pass. A
 * bare count, or a grep for a literal the implementation itself supplies, is
 * not acceptable here — that is how an ER passes while the feature is broken.
 */

import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'
import {
  OFFLINE_SCHEMA_VERSION,
  buildOfflineSnapshot,
  readValidSnapshot,
  type OfflineSnapshot,
} from '@/lib/offlineSnapshot'
import { OFFLINE_SCHEMA_VERSION_V5, type OfflineSnapshotV5 } from '@/lib/offlineSnapshotV5'
import type { Repertoire, ResolvedSongEntry } from '@/types/database'
import {
  LEGACY_CATALOG_TABLE,
  LEGACY_REPERTOIRE_TABLE,
  LEGACY_TABS_TABLE,
  findViolations,
  formatViolations,
  stripComments,
} from './test-helpers'

const REPO_ROOT = path.resolve(__dirname, '../../..')

const read = (relative: string): string => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8')

// ---------------------------------------------------------------------------
// The migration chain and the terminus schema, as data (ER1-ER3).
// ---------------------------------------------------------------------------

/**
 * The relations the restructured terminus must and must not have — ER2's
 * `VALUES` list, in TypeScript.
 *
 * The three retired names come from `test-helpers`' assembled constants rather
 * than being spelled here: the repository's guard tests forbid naming the
 * dropped tables beside a SQL keyword, and those constants are the single
 * reviewable place that exception lives.
 */
const TERMINUS_RELATIONS = {
  absent: [LEGACY_CATALOG_TABLE, LEGACY_REPERTOIRE_TABLE, LEGACY_TABS_TABLE],
  present: [
    'songs',
    'albums',
    'song_versions',
    'song_files',
    'user_songs',
    'band_songs',
    'playlist_songs',
  ],
} as const

const migrationNames = (): string[] =>
  fs
    .readdirSync(path.join(REPO_ROOT, 'migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()

/**
 * Blanks `--` tails and `/* *\/` blocks out of SQL, preserving line count.
 *
 * `stripComments` (`./test-helpers`) handles the JS/TS forms only, and the two
 * sibling derivations in this file run through it for a reason: `retires` and
 * `establishes` below are **textual** scans, so a migration carrying
 * `-- CREATE TABLE albums …` in its prose would satisfy one without any
 * statement existing. ER1-ER3's `psql` commands are the real instrument for the
 * terminus; this keeps the cheap scan beside them from being the weaker one.
 */
const stripSqlComments = (sql: string): string =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, '')

const migrationCorpus = (): string =>
  migrationNames()
    .map((name) => stripSqlComments(read(`migrations/${name}`)))
    .join('\n')

/**
 * Where the `NNNN_` prefixes stop being a gapless run from `0001`.
 *
 * `scripts/migrate.mjs` applies the files in name order, so a gap or a repeated
 * prefix means the order a fresh database runs them in is not the order they
 * were written for — the exact thing ER1 proves empirically and nothing else in
 * the repository states.
 */
function chainBreaks(names: string[]): string[] {
  const breaks: string[] = []
  names.forEach((name, index) => {
    const expected = String(index + 1).padStart(4, '0')
    if (!name.startsWith(`${expected}_`)) breaks.push(`expected ${expected}_*, found ${name}`)
  })
  return breaks
}

const retires = (sql: string, name: string): boolean =>
  new RegExp(`DROP\\s+TABLE\\s+(IF\\s+EXISTS\\s+)?${name}\\b`, 'i').test(sql) ||
  new RegExp(`ALTER\\s+TABLE\\s+(IF\\s+EXISTS\\s+)?${name}\\s+RENAME\\s+TO\\b`, 'i').test(sql)

const establishes = (sql: string, name: string): boolean =>
  new RegExp(`CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?${name}\\b`, 'i').test(sql) ||
  new RegExp(`RENAME\\s+TO\\s+${name}\\b`, 'i').test(sql)

/** Every terminus expectation the migration corpus does not account for. */
function unaccountedRelations(
  sql: string,
  expectation: { absent: readonly string[]; present: readonly string[] },
): string[] {
  return [
    ...expectation.absent.filter((name) => !retires(sql, name)).map((n) => `never retired: ${n}`),
    ...expectation.present
      .filter((name) => !establishes(sql, name))
      .map((n) => `never established: ${n}`),
  ]
}

describe('the migration chain reaches the restructured terminus', () => {
  it('is a gapless, name-ordered sequence from 0001', () => {
    const names = migrationNames()

    expect(names.length).toBeGreaterThan(0)
    expect(chainBreaks(names)).toEqual([])
    // Positive control: the same checker on a chain missing `0002`.
    expect(chainBreaks(['0001_initial.sql', '0003_third.sql'])).toEqual([
      'expected 0002_*, found 0003_third.sql',
    ])
  })

  it('retires every legacy relation and establishes every new one', () => {
    const sql = migrationCorpus()

    expect(unaccountedRelations(sql, TERMINUS_RELATIONS)).toEqual([])
    // Positive control: a relation no migration mentions is reported on both
    // sides, so a scan that matched nothing could not pass the assertion above.
    expect(
      unaccountedRelations(sql, { absent: ['rh105_absent'], present: ['rh105_present'] }),
    ).toEqual(['never retired: rh105_absent', 'never established: rh105_present'])
  })
})

// ---------------------------------------------------------------------------
// ER6b — `song_files` is keyed by song, derived from `tabs.ts`'s statements.
// ---------------------------------------------------------------------------

/** Every string literal of a TypeScript source: backtick, single or double. */
const STRING_LITERAL = /`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g

/** A column compared to a bound parameter, e.g. `song_id = $2`. */
const BOUND_COLUMN = /([a-z_]+)\s*=\s*\$\d+/g

/**
 * The sorted set of columns that `song_files`-naming statements in `source`
 * compare to a bound parameter.
 *
 * Comments are stripped first: `tabs.ts`'s prose contains apostrophes, and an
 * unstripped scan would read one as the start of a string literal and swallow
 * the statements after it.
 */
function songFileKeyColumns(source: string): string[] {
  const literals = stripComments(source).match(STRING_LITERAL) ?? []
  const columns = new Set<string>()
  for (const literal of literals.filter((text) => text.includes('song_files'))) {
    for (const match of literal.matchAll(BOUND_COLUMN)) columns.add(match[1])
  }
  return [...columns].sort()
}

describe('song_files is keyed by song and by nothing version-shaped (ER6b)', () => {
  it('tabs.ts compares only id, song_id and user_id to a bound parameter', () => {
    // A resolved value, not an absence: a column named `version_id` fails by
    // inequality, and an extractor that matched nothing fails too, because the
    // empty set is not this value.
    expect(songFileKeyColumns(read('src/lib/tabs.ts'))).toEqual(['id', 'song_id', 'user_id'])

    // Positive control: the violation this is meant to catch is catchable.
    const versionKeyed = "const sql = 'SELECT 1 FROM song_files WHERE version_id = $1'"
    expect(songFileKeyColumns(versionKeyed)).toEqual(['version_id'])
  })
})

// ---------------------------------------------------------------------------
// ER7 — the export surface of the repertoire actions.
// ---------------------------------------------------------------------------

const REPERTOIRE_ACTIONS = 'src/app/actions/repertoire.ts'

/**
 * How many functions `src/app/actions/repertoire.ts` exports.
 *
 * Re-derived against the implementing `HEAD`, never copied from a spec or an
 * earlier commit — concurrent work edits this file, and RH-132 replaced
 * `getSongEntryAction` with `getResolvedEntryForVersionAction` one for one
 * while leaving the count alone. Derive it with:
 *
 *     grep -c '^export async function' src/app/actions/repertoire.ts
 */
const REPERTOIRE_ACTION_EXPORTS = 14

/**
 * The seven mutators ER7 drives: every action that resolves its owner through
 * `resolveWriteOwner`, which is the band-admin gate RH-124 shipped.
 *
 * `updateSongLinksAction` is correctly absent — it authorizes through
 * `assertRepertoireAccess` and writes `song_links` rows rather than an owner
 * table, so it is not an owner-row mutator at all.
 */
const WRITE_OWNER_CALLERS = [
  'addSongAction',
  'createAndAddSongAction',
  'removeSongAction',
  'updateLyricsAction',
  'updateSongAction',
  'updateSongStatusAction',
  'updateSongTagsAction',
]

/** Each `export async function` of `source`, with its own body. */
function exportedAsyncFunctions(source: string): Array<{ name: string; body: string }> {
  return source
    .split(/^export async function /m)
    .slice(1)
    .map((part) => {
      const nameEnd = part.search(/[^A-Za-z0-9_]/)
      const bodyEnd = part.indexOf('\n}\n')
      const whole = bodyEnd === -1 ? part : part.slice(0, bodyEnd)
      // The body starts after the signature, so a function merely *named*
      // `…resolveWriteOwner…` cannot satisfy a caller filter on its own name.
      const bodyStart = whole.indexOf('{')
      return {
        name: part.slice(0, nameEnd),
        body: bodyStart === -1 ? whole : whole.slice(bodyStart),
      }
    })
}

describe('the repertoire actions expose exactly what ER7 enumerates', () => {
  it('exports the derived number of functions, so adding one forces this list to be revisited', () => {
    const names = exportedAsyncFunctions(read(REPERTOIRE_ACTIONS)).map((fn) => fn.name)

    expect(names).toHaveLength(REPERTOIRE_ACTION_EXPORTS)
    // The extractor is not vacuous: it found real identifiers, not empties.
    expect(names.every((name) => /^[a-z][A-Za-z0-9_]*$/.test(name))).toBe(true)
  })

  it('routes exactly seven of them through resolveWriteOwner', () => {
    const functions = exportedAsyncFunctions(read(REPERTOIRE_ACTIONS))
    const gated = functions
      .filter((fn) => fn.body.includes('resolveWriteOwner'))
      .map((fn) => fn.name)
      .sort()

    expect(gated).toEqual(WRITE_OWNER_CALLERS)
    // Positive control: the complement is non-empty, so the filter discriminates.
    expect(functions.length).toBeGreaterThan(gated.length)
  })
})

// ---------------------------------------------------------------------------
// ER8 — the offline schema version's terminus and its refused set.
// ---------------------------------------------------------------------------

/**
 * The live `OFFLINE_SCHEMA_VERSION`, declared here so the module's value is
 * compared to something rather than to itself.
 *
 * Re-derived against the implementing `HEAD`, never copied from a spec:
 *
 *     grep -n 'export const OFFLINE_SCHEMA_VERSION' src/lib/offlineSnapshot.ts
 */
const OFFLINE_TERMINUS = 6

/** The resolved `(owner, version)` pair a current-shape song carries. */
const resolvedEntry = (): ResolvedSongEntry => ({
  ownerRowId: 'rh105-owner-row',
  song_id: 'rh105-song',
  version_id: 'rh105-version',
  status: 'polishing',
  key: 'Em',
  tuning: null,
  lyrics: null,
  map: null,
  tags: [],
  last_practiced: null,
})

/** The member's own row, still a song-keyed `Repertoire`. */
const personalRow = (): Repertoire => ({
  id: 'rh105-owner-row',
  user_id: 'rh105-user',
  band_id: null,
  song_id: 'rh105-song',
  version_id: 'rh105-version',
  key: 'Em',
  tuning: null,
  status: 'polishing',
  tags: [],
  last_practiced: null,
  lyrics: null,
  map: null,
})

/**
 * One otherwise-valid current-shape payload **carrying one song**.
 *
 * The song is not optional: `songs: []` satisfies `isSnapshotV5`'s `.every()`
 * vacuously, so an empty payload stamped 5 would be *upgraded* and return
 * non-null, which would make the refusal assertions below say nothing.
 */
const currentShape = (): OfflineSnapshot =>
  buildOfflineSnapshot({
    playlistId: 'rh105-playlist',
    playlistName: 'RH-105 Setlist',
    bandId: null,
    savedAt: '2026-10-09T12:00:00.000Z',
    songs: [
      {
        entry: {
          repertoireId: 'rh105-owner-row',
          versionId: 'rh105-version',
          songId: 'rh105-song',
          title: 'RH-105',
          artist: null,
        },
        repertoire: resolvedEntry(),
        personalRepertoire: personalRow(),
        tabs: [],
      },
    ],
  })

/** The same playlist as a v5 record: a song keyed by its owner row's id. */
const v5Shape = (): OfflineSnapshotV5 => ({
  schemaVersion: OFFLINE_SCHEMA_VERSION_V5,
  playlistId: 'rh105-playlist',
  playlistName: 'RH-105 Setlist',
  bandId: null,
  savedAt: '2026-10-09T12:00:00.000Z',
  songs: [
    {
      repertoireId: 'rh105-owner-row',
      entry: {
        repertoireId: 'rh105-owner-row',
        versionId: 'rh105-version',
        songId: 'rh105-song',
        title: 'RH-105',
        artist: null,
      },
      repertoire: personalRow(),
      personalRepertoire: null,
      tabs: [],
    },
  ],
})

describe('the offline schema version has a terminus (ER8)', () => {
  it("the offline schema version is the module's terminus", () => {
    expect(OFFLINE_SCHEMA_VERSION).toBe(OFFLINE_TERMINUS)
  })

  it('every superseded snapshot shape without an upgrade path is refused', () => {
    const payload = currentShape()

    // 1-4 have no upgrade path: each bump dropped information the reader needs
    // and the record cannot supply.
    for (const schemaVersion of [1, 2, 3, 4]) {
      expect(readValidSnapshot({ ...payload, schemaVersion })).toBeNull()
    }

    // The control, taken from the live value rather than a literal: it is what
    // proves the four nulls above came from the version check and not from a
    // malformed fixture.
    expect(readValidSnapshot({ ...payload, schemaVersion: OFFLINE_SCHEMA_VERSION })).not.toBeNull()
  })

  it('a v5 record is upgraded, not refused', () => {
    // A genuinely v5-shaped record: every song carries `repertoireId`,
    // `entry.versionId` and `repertoire.id`, which is all the upgrade reads.
    const upgraded = readValidSnapshot(v5Shape())
    expect(upgraded).not.toBeNull()
    expect(upgraded?.schemaVersion).toBe(OFFLINE_SCHEMA_VERSION)

    // The other half of the actual rule: a **current-shape** payload stamped 5
    // is refused, because a v6 song carries `versionId` and
    // `repertoire.ownerRowId` and so fails `isSongSnapshotV5`, is not upgraded,
    // and then fails the `!==` gate.
    expect(
      readValidSnapshot({ ...currentShape(), schemaVersion: OFFLINE_SCHEMA_VERSION_V5 }),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ER9 — no non-test source removes a row from the shared catalog.
// ---------------------------------------------------------------------------

const CATALOG_DELETE = /DELETE\s+FROM\s+(songs|song_versions)\b/i

describe('the shared catalog is never row-deleted by production source (ER9)', () => {
  it('names no catalog delete outside __tests__, while the same scan finds plenty inside', () => {
    const all = findViolations(CATALOG_DELETE)
    const production = all.filter((violation) => !violation.file.includes('__tests__'))

    expect(formatViolations(production)).toEqual([])
    // The control, which is what says "every matching path is a test": the
    // pattern and the scan root really do search the tree.
    expect(new Set(all.map((violation) => violation.file)).size).toBeGreaterThanOrEqual(10)
  })
})

// ---------------------------------------------------------------------------
// ER11 — no path named in the live documentation dangles.
// ---------------------------------------------------------------------------

const LIVE_DOCS = ['AGENTS.md', 'docs/use-cases.md', 'docker-compose.yml', 'README.md']

/**
 * ER11's extractor, with one deliberate difference from the shell form.
 *
 * The extension alternation is ordered **longest first** and closed with a
 * negative lookahead. POSIX ERE (`grep -E`) matches leftmost-*longest*, so
 * `(ts|tsx|…)` picks `.tsx` there; a JavaScript regex is ordered-alternation
 * and would stop at `.ts`, silently truncating `LandingPage.tsx` to
 * `LandingPage.ts` and then reporting that non-existent path as dangling.
 * Measured: the naive order produced three false `MISSING:` entries.
 *
 * The **lookahead** is what guarantees this, not the ordering: it refuses any
 * match whose next character could have extended the extension. The
 * longest-first order is belt-and-braces, so reordering the alternation alone
 * would not reintroduce the truncation — but do not remove the lookahead.
 */
const DOC_PATH =
  /(src|scripts|migrations|e2e|public)\/[A-Za-z0-9_./-]+\.(tsx|ts|mjs|json|js|sql|sh|md)(?![A-Za-z0-9])/g

/**
 * `scripts/ensure-db.sh` is referenced from `AGENTS.md` and `scripts/migrate.mjs`
 * and has never existed in this repository. It predates the catalog split and is
 * declared out of scope, so it is pinned as the one known exception — and it
 * doubles as this scan's positive control: it proves both the extractor and the
 * existence test work, which "no output" could not.
 */
const KNOWN_DANGLING = ['scripts/ensure-db.sh']

function documentedPaths(sources: string[]): string[] {
  const found = new Set<string>()
  for (const source of sources) {
    for (const match of source.matchAll(DOC_PATH)) found.add(match[0])
  }
  return [...found].sort()
}

describe('the live documentation names no path that does not exist (ER11)', () => {
  it('reports exactly the one declared exception', () => {
    const paths = documentedPaths(LIVE_DOCS.map(read))

    // Non-vacuous by construction: the extractor found a real population.
    expect(paths.length).toBeGreaterThanOrEqual(10)
    expect(paths.filter((p) => !fs.existsSync(path.join(REPO_ROOT, p)))).toEqual(KNOWN_DANGLING)
  })

  it('the extractor sees a dangling path when there is one', () => {
    const invented = 'see `scripts/rh105-never-existed.mjs` for details'

    expect(documentedPaths([invented])).toEqual(['scripts/rh105-never-existed.mjs'])
  })
})
