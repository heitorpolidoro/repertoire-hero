/**
 * RH-136 — the `song_links` migration against a real Postgres.
 *
 * `scripts/migrate.mjs` applies each file once per database, so by the time any
 * other `*.db.test.ts` runs the schema is already the post-migration one and
 * nothing has replayed the file. This suite replays it, on the recipe
 * `ownerSongsMigration.db.test.ts` established:
 *
 *  1. the file is resolved off disk by its `_song_links.sql` **suffix**, never
 *     by a four-digit prefix — several approved specs each claim "the next
 *     number", so whichever lands second renumbers;
 *  2. the pre-migration shape is rebuilt by `legacyCatalogReplayDdl` inside a
 *     throwaway `rh136_<token>` schema that is **first on the transaction's
 *     `search_path`**, the file runs, the assertions are taken, and the
 *     transaction is **always** rolled back through a sentinel throw.
 *
 * THE LOCAL `songs` TABLE IS A PREREQUISITE, NOT A CONVENIENCE. Every name in
 * this migration is unqualified — `REFERENCES songs(id)`, the backfill's
 * `FROM songs`, `CREATE TRIGGER ... ON songs` — and an unqualified name resolves
 * along the `search_path`. Without a `songs` in the replay schema all three find
 * `public.songs` and take ACCESS EXCLUSIVE on the live catalog inside a long
 * test transaction: the deadlock class `ownerSongsMigration.db.test.ts:24-41`
 * measured at "2 occurrences in 24 full runs". It would also fold `public`'s own
 * songs and link elements into the backfill the literal expectations below are
 * written against.
 *
 * THE AWKWARD ROWS ARE SEEDED, NOT HOPED FOR. The live dev database holds no
 * duplicate url, no non-object element, no url-less element and no non-http url,
 * so every one of them is authored here. And every expectation is a **literal**
 * list rather than one recomputed from the seed: a helper carrying the
 * backfill's own bug would agree with it.
 *
 * THE GENERATED-COLUMN REJECTION GETS ITS OWN TRANSACTION. Asserting that
 * `INSERT INTO song_links (... provider ...)` is refused necessarily aborts the
 * transaction it runs in — the insert fails `428C9` and the very next statement
 * in that session returns `25P02 current transaction is aborted`. The only
 * in-transaction escape is a savepoint, and `transactionGuard.test.ts` bans
 * transaction control through `query()` in every file under `src/`, test files
 * included. So it is a second scenario, in its own `withTransaction`, which
 * issues the offending insert as the **last statement** and lets the thrown
 * error carry the rollback.
 *
 * No transaction-control literal appears in this file.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { query, withTransaction, type Queryable } from '@/lib/db'
import { legacyCatalogReplayDdl, migrationSqlBySuffix } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

/** The stable half of the migration's name; the four-digit prefix may move. */
const MIGRATION_SUFFIX = '_song_links.sql'

const ROLLBACK = 'RH-136 song_links migration scenario rollback'

/** One backfilled row, in the canonical read order. */
interface LinkRow {
  url: string
  label: string
  provider: string
  position: number
}

/** The `songs.links` column as seeded, for the conservation assertion (ER4). */
interface SnapshotRow {
  title: string
  links: unknown
}

interface Scenario {
  /** Backfilled rows per seeded song title, in `ORDER BY position, created_at, id`. */
  byTitle: Record<string, LinkRow[]>
  /** `songs.links` before the file ran. */
  before: SnapshotRow[]
  /** `songs.links` after the file ran — must be byte-identical to `before`. */
  after: SnapshotRow[]
}

/**
 * The seeded fixture: one song per case, keyed by the title it is seeded under.
 * `notarray` is its own row because `links` is `NOT NULL` and a non-array value
 * cannot share a multi-row `VALUES` list with the jsonb arrays above it without
 * obscuring which row raised.
 */
const SEED: Record<string, string> = {
  wellformed:
    '[{"label":"Spotify","url":"https://open.spotify.com/track/1"},{"label":"Tube","url":"https://youtu.be/abc"}]',
  nonhttp: '[{"label":"Cifra","url":"www.cifraclub.com.br/x"}]',
  duplicated:
    '[{"label":"kept","url":"https://open.spotify.com/track/dup"},{"label":"dropped","url":"https://open.spotify.com/track/dup"}]',
  stringelement: '["https://open.spotify.com/track/ignored"]',
  urlless: '[{"label":"orphan"}]',
  emptyarray: '[]',
}

/** ER6 — every provider case, friendly and hostile, as one song's links. */
const PROVIDER_CASES: Array<[string, string]> = [
  ['https://open.spotify.com/track/1', 'spotify'],
  ['https://spotify.com/x', 'spotify'],
  ['HTTPS://OPEN.SPOTIFY.COM/track/2', 'spotify'],
  ['https://user:pw@spotify.com/x', 'spotify'],
  ['https://youtu.be/abc', 'youtube'],
  ['https://www.youtube.com/watch?v=1', 'youtube'],
  ['https://music.youtube.com/x', 'youtube'],
  ['https://notspotify.com/x', 'other'],
  ['http://NOTYOUTUBE.COM/y', 'other'],
  ['https://notyoutu.be/y', 'other'],
  ['https://myyoutu.be/x', 'other'],
  ['https://www.youtube.com.br/x', 'other'],
  ['https://spotify.com@evil.com/x', 'other'],
  ['https://evil.com\\@spotify.com/x', 'other'],
  ['https://example.com/youtube.com/x', 'other'],
  ['https://evil.com:8080/?x=youtube.com', 'other'],
  ['ftp://spotify.com/x', 'other'],
  ['https://www.cifraclub.com.br/eagles/hotel-california/', 'other'],
  ['https://tabs.ultimate-guitar.com/tab/123', 'other'],
  ['www.cifraclub.com.br/x', 'other'],
]

const PROVIDER_TITLE = 'providers'

function replaySchema(): string {
  return `rh136_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

/** `legacyCatalogReplayDdl` + the schema first on the path. Both scenarios need it. */
async function buildReplaySchema(client: Queryable, schema: string): Promise<void> {
  await client.query(legacyCatalogReplayDdl(schema))
  await client.query(`SET LOCAL search_path = ${schema}, public`)
}

async function readLinkRows(client: Queryable): Promise<Record<string, LinkRow[]>> {
  const res = await client.query<LinkRow & { title: string }>(
    `SELECT s.title, l.url, l.label, l.provider, l.position
       FROM songs s JOIN song_links l ON l.song_id = s.id
      ORDER BY s.title, l.position, l.created_at, l.id`,
    [],
  )
  const byTitle: Record<string, LinkRow[]> = {}
  for (const row of res.rows) {
    byTitle[row.title] ??= []
    byTitle[row.title].push({
      url: row.url,
      label: row.label,
      provider: row.provider,
      position: row.position,
    })
  }
  return byTitle
}

async function readSnapshot(client: Queryable): Promise<SnapshotRow[]> {
  const res = await client.query<SnapshotRow>(
    'SELECT title, links FROM songs ORDER BY title',
    [],
  )
  return res.rows
}

async function runBackfillScenario(): Promise<Scenario> {
  const sql = migrationSqlBySuffix(MIGRATION_SUFFIX)
  const schema = replaySchema()
  let scenario: Scenario | undefined

  await withTransaction(async (client) => {
    await buildReplaySchema(client, schema)

    for (const [title, links] of Object.entries(SEED)) {
      await client.query('INSERT INTO songs (title, artist, links) VALUES ($1, $2, $3::jsonb)', [
        title,
        'RH-136 Artist',
        links,
      ])
    }
    // Its own row: a `links` value that is not a jsonb array at all. The column
    // is unvalidated, so this is a state the database really can hold.
    await client.query('INSERT INTO songs (title, artist, links) VALUES ($1, $2, $3::jsonb)', [
      'notarray',
      'RH-136 Artist',
      '{"nope": true}',
    ])
    await client.query('INSERT INTO songs (title, artist, links) VALUES ($1, $2, $3::jsonb)', [
      PROVIDER_TITLE,
      'RH-136 Artist',
      JSON.stringify(PROVIDER_CASES.map(([url], i) => ({ label: `p${i}`, url }))),
    ])

    // ER4 — captured **before** the file runs: "the new table has rows" says
    // nothing about whether the old data arrived.
    const before = await readSnapshot(client)

    // The migration, verbatim off disk, exactly as `scripts/migrate.mjs` runs it.
    await client.query(sql)

    scenario = {
      byTitle: await readLinkRows(client),
      before,
      after: await readSnapshot(client),
    }

    throw new Error(ROLLBACK)
  }).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== ROLLBACK) throw error
  })

  if (!scenario) throw new Error('the migration scenario produced no snapshot')
  return scenario
}

/**
 * ER7, in its own transaction: `provider` is generated, so naming it in an
 * insert's column list is refused. The offending insert is the **last**
 * statement — the transaction is aborted afterwards and `25P02` would swallow
 * anything issued next — and the thrown error carries the rollback.
 */
async function runGeneratedColumnScenario(): Promise<string> {
  const sql = migrationSqlBySuffix(MIGRATION_SUFFIX)
  const schema = replaySchema()
  let code = ''

  await withTransaction(async (client) => {
    await buildReplaySchema(client, schema)
    await client.query('INSERT INTO songs (title, artist) VALUES ($1, $2)', [
      'generated',
      'RH-136 Artist',
    ])
    await client.query(sql)
    await client.query(
      `INSERT INTO song_links (song_id, url, label, position, provider)
       SELECT id, 'https://open.spotify.com/track/forced', 'forced', 1, 'youtube' FROM songs LIMIT 1`,
      [],
    )
  }).catch((error: unknown) => {
    code = (error as { code?: string }).code ?? ''
  })

  return code
}

describe.skipIf(!RUN_DB_TESTS)('the song_links migration (RH-136 ER1-ER7)', () => {
  let scenario: Scenario
  let generatedColumnCode: string
  let leakedSongs: number
  let leakedLinks: number

  beforeAll(async () => {
    scenario = await runBackfillScenario()
    generatedColumnCode = await runGeneratedColumnScenario()
    // Asserted by marker rather than by a before/after row count: other suites
    // insert into `public.songs` concurrently, so a count comparison would be
    // racy, while a marker is deterministic — nothing but this replay ever
    // writes these two values.
    leakedSongs = Number(
      (
        await query<{ n: string }>(
          'SELECT count(*)::text AS n FROM public.songs WHERE artist = $1',
          ['RH-136 Artist'],
        )
      ).rows[0].n,
    )
    leakedLinks = Number(
      (
        await query<{ n: string }>(
          'SELECT count(*)::text AS n FROM public.song_links WHERE url = $1',
          ['https://open.spotify.com/track/dup'],
        )
      ).rows[0].n,
    )
  }, 60_000)

  it('leaves public untouched: every statement resolved inside the replay schema (ER2)', () => {
    // `REFERENCES songs(id)`, the backfill's `FROM songs` and
    // `CREATE TRIGGER ... ON songs` are all unqualified, so without a local
    // `songs` they would resolve to `public`'s — and the backfill would have
    // written `public.song_links` rows for `public`'s catalog.
    expect(leakedSongs).toBe(0)
    expect(leakedLinks).toBe(0)
  })

  it('backfills both well-formed elements in array order (ER3, ER5)', () => {
    expect(scenario.byTitle.wellformed).toEqual([
      { url: 'https://open.spotify.com/track/1', label: 'Spotify', provider: 'spotify', position: 1 },
      { url: 'https://youtu.be/abc', label: 'Tube', provider: 'youtube', position: 2 },
    ])
  })

  it('keeps a non-http url, with its label, as provider other (ER3)', () => {
    expect(scenario.byTitle.nonhttp).toEqual([
      { url: 'www.cifraclub.com.br/x', label: 'Cifra', provider: 'other', position: 1 },
    ])
  })

  it('collapses a duplicated url to the lowest-ordinality label (ER3, ER4)', () => {
    expect(scenario.byTitle.duplicated).toEqual([
      {
        url: 'https://open.spotify.com/track/dup',
        label: 'kept',
        provider: 'spotify',
        position: 1,
      },
    ])
    // The other label is discarded, not merged in alongside it.
    expect(scenario.byTitle.duplicated.map((row) => row.label)).not.toContain('dropped')
  })

  it('contributes nothing for a string element, a url-less object, an empty array or a non-array value (ER3)', () => {
    expect(scenario.byTitle.stringelement).toBeUndefined()
    expect(scenario.byTitle.urlless).toBeUndefined()
    expect(scenario.byTitle.emptyarray).toBeUndefined()
    // The guard that matters most: `jsonb_array_elements` on a scalar raises and
    // would have aborted the whole file rather than skipping this row.
    expect(scenario.byTitle.notarray).toBeUndefined()
  })

  it('returns every seeded song urls in the order its jsonb array held them (ER5)', () => {
    expect(scenario.byTitle[PROVIDER_TITLE].map((row) => row.url)).toEqual(
      PROVIDER_CASES.map(([url]) => url),
    )
    expect(scenario.byTitle[PROVIDER_TITLE].map((row) => row.position)).toEqual(
      PROVIDER_CASES.map((_, i) => i + 1),
    )
  })

  it.each(PROVIDER_CASES)('derives provider %s -> %s, host-anchored (ER6)', (url, provider) => {
    const row = scenario.byTitle[PROVIDER_TITLE].find((candidate) => candidate.url === url)
    expect(row, `no song_links row for ${url}`).toBeDefined()
    expect(row!.provider).toBe(provider)
  })

  it('conserves every non-duplicated element of the pre-migration snapshot (ER4)', () => {
    const rowsFor = (title: string) => scenario.byTitle[title] ?? []
    let checked = 0
    for (const row of scenario.before) {
      if (!Array.isArray(row.links)) continue
      const urls = row.links
        .filter((el): el is { url: string } => typeof el === 'object' && el !== null && 'url' in el)
        .map((el) => el.url)
      row.links.forEach((element, index) => {
        if (typeof element !== 'object' || element === null || !('url' in element)) return
        const { url, label } = element as { url: string; label?: string }
        const isDuplicated = urls.filter((candidate) => candidate === url).length > 1
        const matching = rowsFor(row.title).filter((candidate) => candidate.url === url)
        expect(matching, `${row.title} / ${url}`).toHaveLength(1)
        if (!isDuplicated) {
          expect(matching[0].label).toBe(label ?? '')
          checked += 1
        } else if (urls.indexOf(url) === index) {
          // The kept row is the lowest-ordinality occurrence's label.
          expect(matching[0].label).toBe(label ?? '')
          checked += 1
        }
      })
    }
    // Guards the guard: a fixture that conserved nothing would pass the loop.
    expect(checked).toBe(24)
  })

  it('leaves songs.links byte-identical to the snapshot (ER4)', () => {
    expect(scenario.after).toEqual(scenario.before)
  })

  it('refuses an application-supplied provider with 428C9 (ER7)', () => {
    expect(generatedColumnCode).toBe('428C9')
  })
})
