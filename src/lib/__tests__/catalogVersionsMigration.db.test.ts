/**
 * RH-122 — the backfill and the collapse, executed for real.
 *
 * These are the only parts of this task that CI's fresh, empty database cannot
 * observe: there is no legacy row for them to touch. That is why
 * `migrations/0014_add_albums_and_song_versions.sql` packages them as one
 * retained, idempotent `migrate_catalog_to_versions()` — so this file can
 * insert legacy-shaped rows and call it again.
 *
 * Two scenarios, both inside a transaction that is always rolled back (Postgres
 * DDL is transactional, so not even the dropped index leaks into the next
 * test):
 *
 *  - the **whole migration file** replayed over two rows whose titles differ
 *    only by a `" - "` suffix. That is the order assertion: the rewrite turns
 *    them into the same title for the same artist, so a file that recreated the
 *    unique index before the collapse — or never dropped it — would abort on
 *    the `UPDATE`;
 *  - the **function alone**, called twice over legacy-shaped rows, for the
 *    backfill counts, the idempotence, and the collapse's re-pointing.
 *
 * The migration is resolved off disk by its name **suffix**, never by a
 * hardcoded `0014`: several approved specs were written against the same
 * high-water mark, so whichever lands second renumbers, and a prefix written
 * into a test would break on that renumber.
 *
 * No transaction-control literal appears here: `withTransaction` is the only
 * sanctioned way to open one (`transactionGuard.test.ts`), and a thrown
 * sentinel is how the scenario is undone.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { query, withTransaction } from '@/lib/db'
import {
  LEGACY_REPERTOIRE_DDL,
  LEGACY_REPERTOIRE_TABLE,
  LEGACY_TABS_DDL,
  LEGACY_TABS_TABLE,
  lockMigrationReplay,
} from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations')
/** The stable half of the migration's name; the four-digit prefix may move. */
const MIGRATION_SUFFIX = '_add_albums_and_song_versions.sql'

/** The index whose drop/recreate brackets the rewrite. */
const SONGS_UNIQUE = 'uq_songs_artist_title'

function migrationFileNames(): string[] {
  return fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(MIGRATION_SUFFIX))
}

function migrationSql(): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, migrationFileNames()[0]), 'utf8')
}

/**
 * The migration's *statements*, with every `--` comment line blanked out.
 *
 * The file's header explains at length what it deliberately does not do, which
 * includes naming the statement ER14 forbids. A detector that read the prose as
 * code would make the explanation unwriteable.
 */
function migrationStatements(): string {
  return migrationSql().replace(/--[^\n]*/g, '')
}

/** A collision-free token carrying neither a space-dash-space nor a dash. */
function token(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12)
}

/** Narrow enough for the scenario bodies; `withTransaction` hands a real client. */
type Client = { query: typeof query }

/** Rolls a scenario back; the sentinel is how `withTransaction` undoes it. */
const ROLLBACK = 'RH-122 migration scenario rollback'

async function inRolledBackTransaction<T>(body: (client: Client) => Promise<T>): Promise<T> {
  let result: T | undefined
  let captured = false

  await withTransaction(async (client) => {
    // First statement, before any DDL: the four migration-replay suites share
    // one advisory lock so they cannot deadlock on the same table names.
    await lockMigrationReplay(client)
    result = await body(client)
    captured = true
    throw new Error(ROLLBACK)
  }).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== ROLLBACK) throw error
  })

  if (!captured) throw new Error('the scenario produced no result')
  return result as T
}

async function count(client: Client, sql: string, params: unknown[]): Promise<number> {
  const res = await client.query<{ n: string }>(sql, params)
  return Number(res.rows[0].n)
}

// ---------------------------------------------------------------------------
// ER1 / ER11 / ER14 — the migration file itself. No database needed.
// ---------------------------------------------------------------------------
describe('the albums-and-song-versions migration file (RH-122 ER1, ER11, ER14)', () => {
  it('is exactly one file in migrations/', () => {
    expect(migrationFileNames()).toHaveLength(1)
  })

  it('carries a unique four-digit prefix with no gap below it (ER1)', () => {
    const [name] = migrationFileNames()
    const prefixOf = (file: string) => Number(file.slice(0, 4))
    const others = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && f !== name)
      .map(prefixOf)
    const prefix = prefixOf(name)

    expect(others).not.toContain(prefix)
    for (let n = 1; n < prefix; n += 1) expect(others).toContain(n)
  })

  it('leaves the initial schema untouched (ER1)', () => {
    // An append-only ledger: `0001` is never edited, so it still knows nothing
    // about albums or versions.
    const initial = fs.readFileSync(path.join(MIGRATIONS_DIR, '0001_initial_schema.sql'), 'utf8')
    expect(initial).not.toMatch(/\balbums\b/)
    expect(initial).not.toMatch(/\bsong_versions\b/)
  })

  it('drops the songs unique before the backfill and recreates it after (ER11)', () => {
    const sql = migrationSql()

    const drop = sql.indexOf(`DROP INDEX IF EXISTS ${SONGS_UNIQUE}`)
    const call = sql.indexOf('SELECT migrate_catalog_to_versions()')
    const create = sql.indexOf(`CREATE UNIQUE INDEX IF NOT EXISTS ${SONGS_UNIQUE}`)

    expect(drop, 'the migration must drop the songs unique index').toBeGreaterThan(-1)
    expect(call, 'the migration must call the backfill function').toBeGreaterThan(-1)
    expect(create, 'the migration must recreate the songs unique index').toBeGreaterThan(-1)

    // The reverse order would abort on the rewrite inside the function.
    expect(drop).toBeLessThan(call)
    expect(create).toBeGreaterThan(call)
  })

  it('recreates the index on exactly the expressions RH-95 declared (ER4)', () => {
    expect(migrationSql()).toContain('ON songs (lower(btrim(artist)), lower(btrim(title)))')
  })

  // RH-122 claimed the owner-row table untouched; RH-124 is what replaced it.
  // The assertion still holds of `migrations/0014`, which is history.
  it('contains no ALTER TABLE on the owner-row table (RH-122 ER14)', () => {
    expect(migrationStatements()).not.toMatch(/ALTER\s+TABLE\s+(IF\s+EXISTS\s+)?repertoire\b/i)
    // The detector has to be able to see the real thing.
    expect('ALTER TABLE repertoire ADD COLUMN version_id uuid').toMatch(
      /ALTER\s+TABLE\s+(IF\s+EXISTS\s+)?repertoire\b/i,
    )
  })
})

// ---------------------------------------------------------------------------
// ER11 — the whole file, replayed over rows the rewrite collapses.
// ---------------------------------------------------------------------------
describe.skipIf(!RUN_DB_TESTS)('replaying the migration over colliding titles (ER11)', () => {
  let surviving: number
  let titles: string[]

  beforeAll(async () => {
    const sfx = token()
    const artist = `Collide Artist ${sfx}`
    const plain = `Collide Song ${sfx}`
    const sql = migrationSql()

    const outcome = await inRolledBackTransaction(async (client) => {
      // RH-123 dropped the table the migration's collapse re-points tab rows
      // in, and RH-124 dropped the owner-row table its foreign key names, so
      // the replay needs both back (see `test-helpers.ts`).
      await client.query(LEGACY_REPERTOIRE_DDL)
      await client.query(LEGACY_TABS_DDL)

      // Both rows are legal today — the titles differ. The rewrite is what
      // makes them the same, which is why the index has to come off first.
      await client.query(
        `INSERT INTO songs (title, artist, created_at)
         VALUES ($1, $2, now() - interval '2 days')`,
        [plain, artist],
      )
      await client.query(
        `INSERT INTO songs (title, artist, created_at)
         VALUES ($1, $2, now() - interval '1 day')`,
        [`${plain} - 2018 Remaster`, artist],
      )

      // If the file ordered its steps differently this throws here.
      await client.query(sql)

      return {
        surviving: await count(client, 'SELECT count(*)::text AS n FROM songs WHERE artist = $1', [
          artist,
        ]),
        titles: (
          await client.query<{ title: string }>('SELECT title FROM songs WHERE artist = $1', [
            artist,
          ])
        ).rows.map((r) => r.title),
      }
    })

    surviving = outcome.surviving
    titles = outcome.titles
  })

  it('completes with no error and leaves one songs row', () => {
    expect(surviving).toBe(1)
  })

  it('leaves the survivor carrying the split title', () => {
    expect(titles).toHaveLength(1)
    expect(titles[0]).not.toContain(' - ')
    expect(titles[0]).toMatch(/^Collide Song /)
  })

  it('puts the unique index back, so the collapse is not a one-way door', async () => {
    // Asserted outside the rolled-back transaction: the real migration already
    // created it, and the scenario must not have left it dropped.
    const res = await query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
      [SONGS_UNIQUE],
    )
    expect(res.rows.map((r) => r.indexname)).toEqual([SONGS_UNIQUE])
  })
})

// ---------------------------------------------------------------------------
// ER12 — the backfill counts, and idempotence, on legacy-shaped rows.
// ---------------------------------------------------------------------------
interface BackfillOutcome {
  albumsAfterFirst: number
  albumsAfterSecond: number
  versionsAfterFirst: number
  versionsAfterSecond: number
  joinedArtists: string[]
  versions: Array<{ title: string; label: string | null; key: string | null; album: string | null }>
}

describe.skipIf(!RUN_DB_TESTS)('the backfill, on legacy-shaped rows (ER12)', () => {
  let outcome: BackfillOutcome

  beforeAll(async () => {
    const sfx = token()
    const joined = `Michael Jackson, Akon ${sfx}`

    outcome = await inRolledBackTransaction(async (client) => {
      // Four legacy rows: two sharing an album in different case, one whose
      // artist is a pre-RH-95 joined credit string, one with no album at all.
      const rows: Array<[string, string, string | null, string | null]> = [
        [`Legacy One ${sfx} - 2018 Remaster`, `Legacy Artist ${sfx}`, `Legacy Album ${sfx}`, 'G'],
        [`Legacy Two ${sfx}`, `Legacy Artist ${sfx}`, `legacy album ${sfx}`, null],
        [`Legacy Three ${sfx} - Live at Wembley`, joined, `Thriller ${sfx}`, 'Bm'],
        [`Legacy Four ${sfx}`, `Legacy Artist ${sfx}`, null, null],
      ]
      const ids: string[] = []
      for (const [title, artist, album, key] of rows) {
        const res = await client.query<{ id: string }>(
          `INSERT INTO songs (title, artist, album, standard_key, duration_seconds)
           VALUES ($1, $2, $3, $4, 200) RETURNING id`,
          [title, artist, album, key],
        )
        ids.push(res.rows[0].id)
      }

      const albums = () =>
        count(client, 'SELECT count(*)::text AS n FROM albums WHERE name LIKE $1', [`%${sfx}%`])
      const versions = () =>
        count(client, 'SELECT count(*)::text AS n FROM song_versions WHERE song_id = ANY($1)', [
          ids,
        ])

      await client.query('SELECT migrate_catalog_to_versions()')
      const albumsAfterFirst = await albums()
      const versionsAfterFirst = await versions()

      // A second call must change nothing: that is what makes the function safe
      // to re-apply and what lets this test exist at all.
      await client.query('SELECT migrate_catalog_to_versions()')

      return {
        albumsAfterFirst,
        versionsAfterFirst,
        albumsAfterSecond: await albums(),
        versionsAfterSecond: await versions(),
        joinedArtists: (
          await client.query<{ artist: string }>('SELECT artist FROM albums WHERE name = $1', [
            `Thriller ${sfx}`,
          ])
        ).rows.map((r) => r.artist),
        versions: (
          await client.query<BackfillOutcome['versions'][number]>(
            `SELECT s.title, v.label, v.key, a.name AS album
               FROM song_versions v
               JOIN songs s ON s.id = v.song_id
               LEFT JOIN albums a ON a.id = v.album_id
              WHERE v.song_id = ANY($1) ORDER BY s.title`,
            [ids],
          )
        ).rows,
      }
    })
  })

  it('inserts one album per distinct case-insensitive (artist, album) pair', () => {
    // `Legacy Album` and `legacy album` are one release; `Thriller` is another.
    // The album-less row contributes none.
    expect(outcome.albumsAfterFirst).toBe(2)
  })

  it('does not comma-split a legacy joined artist string', () => {
    // One row, under the artist text exactly as `songs` stored it. Splitting on
    // ', ' in SQL would also cut "Earth, Wind & Fire", and `albums` has no
    // delete path to undo the wrong merge.
    expect(outcome.joinedArtists).toHaveLength(1)
    expect(outcome.joinedArtists[0]).toMatch(/^Michael Jackson, Akon /)
  })

  it('inserts exactly one version per pre-existing catalog row', () => {
    expect(outcome.versionsAfterFirst).toBe(4)
  })

  it('changes nothing on a second call', () => {
    expect(outcome.albumsAfterSecond).toBe(outcome.albumsAfterFirst)
    expect(outcome.versionsAfterSecond).toBe(outcome.versionsAfterFirst)
  })

  it('takes each version label from the right half of its title', () => {
    const labels = new Map(outcome.versions.map((v) => [v.title.replace(/ [0-9a-f]{12}$/, ''), v]))

    expect(labels.get('Legacy One')?.label).toBe('2018 Remaster')
    expect(labels.get('Legacy Two')?.label).toBeNull()
    expect(labels.get('Legacy Three')?.label).toBe('Live at Wembley')
    expect(labels.get('Legacy Four')?.label).toBeNull()
  })

  it('rewrites every title to its left half and carries standard_key onto the version', () => {
    for (const version of outcome.versions) {
      expect(version.title).not.toContain(' - ')
    }
    const one = outcome.versions.find((v) => v.title.startsWith('Legacy One'))
    expect(one?.key).toBe('G')
    // Case-insensitive on purpose: the two seeded rows spell the album in
    // different cases and are one release, so which spelling the `DISTINCT ON`
    // picks is decided by the id tiebreak and is not a behaviour to pin.
    expect(one?.album?.toLowerCase()).toMatch(/^legacy album /)
  })

  it('leaves the version of the album-less row album-less', () => {
    const four = outcome.versions.find((v) => v.title.startsWith('Legacy Four'))
    expect(four?.album).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ER13 — the collapse: re-point, and delete the loser rather than merge it.
// ---------------------------------------------------------------------------
interface CollapseOutcome {
  survivingSongs: number
  keeperRepertoire: {
    id: string
    status: string
    tags: string[]
    personal_key: string | null
    last_practiced: string | null
  }
  loserRepertoireRows: number
  tabRepertoireIds: string[]
  playlistSongIds: string[]
  editSongIds: string[]
  versionLabels: Array<string | null>
}

describe.skipIf(!RUN_DB_TESTS)('the collapse (ER13)', () => {
  let outcome: CollapseOutcome
  let keeperId: string

  beforeAll(async () => {
    const sfx = token()
    const artist = `Merge Artist ${sfx}`
    const plain = `Merge Song ${sfx}`

    const result = await inRolledBackTransaction(async (client) => {
      // The index has to come off before two rows that the rewrite makes
      // duplicates can be seeded at all.
      await client.query(`DROP INDEX IF EXISTS ${SONGS_UNIQUE}`)

      // RH-123 dropped the table `migrate_catalog_to_versions()` re-points tab
      // rows in, and RH-124 dropped the owner-row table both hang off, so this
      // replay needs both back. Inside this transaction only, and rolled back
      // with everything else; `test-helpers.ts` is the one place either is
      // spelled (RH-123 ER5, RH-124 ER5).
      await client.query(LEGACY_REPERTOIRE_DDL)
      await client.query(LEGACY_TABS_DDL)

      const userId = randomUUID()
      const email = `rh122-merge-${sfx}@test.local`
      await client.query(
        'INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)',
        [userId, 'Merge Owner', email],
      )
      await client.query('INSERT INTO profiles (id, email, full_name) VALUES ($1, $2, $3)', [
        userId,
        email,
        'Merge Owner',
      ])

      const insertSong = async (title: string, ageDays: number, album: string | null) =>
        (
          await client.query<{ id: string }>(
            `INSERT INTO songs (title, artist, album, created_at)
             VALUES ($1, $2, $3, now() - ($4 || ' days')::interval) RETURNING id`,
            [title, artist, album, String(ageDays)],
          )
        ).rows[0].id

      // The keeper is the older row, so it is the survivor.
      const keeper = await insertSong(plain, 2, `Keeper Album ${sfx}`)
      const loser = await insertSong(`${plain} - 2011 Remaster`, 1, `Loser Album ${sfx}`)

      // One owner holding *both* rows: the re-point would duplicate
      // `uq_repertoire_user_song`, so the loser's row is deleted and the
      // keeper's is kept exactly as it is.
      const keeperRep = (
        await client.query<{ id: string }>(
          `INSERT INTO ${LEGACY_REPERTOIRE_TABLE} (user_id, song_id, status, tags, personal_key, last_practiced)
           VALUES ($1, $2, 'learning', ARRAY['keeper-tag'], 'C', now() - interval '10 days')
           RETURNING id`,
          [userId, keeper],
        )
      ).rows[0].id
      const loserRep = (
        await client.query<{ id: string }>(
          `INSERT INTO ${LEGACY_REPERTOIRE_TABLE} (user_id, song_id, status, tags, personal_key, last_practiced)
           VALUES ($1, $2, 'mastered', ARRAY['loser-tag'], 'G', now()) RETURNING id`,
          [userId, loser],
        )
      ).rows[0].id

      // The one thing the collapse rescues: a scanned, annotated PDF would be
      // cascaded away with the loser's repertoire row.
      await client.query(
        `INSERT INTO ${LEGACY_TABS_TABLE} (repertoire_id, title, file_url) VALUES ($1, $2, $3)`,
        [loserRep, `Tab ${sfx}`, 'http://blob/tab.pdf'],
      )

      const playlistId = (
        await client.query<{ id: string }>(
          'INSERT INTO playlists (user_id, name) VALUES ($1, $2) RETURNING id',
          [userId, `Merge Playlist ${sfx}`],
        )
      ).rows[0].id
      // Both rows in one playlist: `uq_playlist_song` makes the re-point a
      // duplicate, so the loser's entry goes and the keeper's position stands.
      for (const [songId, position] of [
        [keeper, 1],
        [loser, 2],
      ] as const) {
        await client.query(
          'INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES ($1, $2, $3)',
          [playlistId, songId, position],
        )
      }

      // The moderation queue has no unique on `song_id`, so this simply follows.
      await client.query(
        'INSERT INTO global_song_edits (song_id, requested_by, proposed_data) VALUES ($1, $2, $3::jsonb)',
        [loser, userId, JSON.stringify({ links: [] })],
      )

      await client.query('SELECT migrate_catalog_to_versions()')

      return {
        keeperId: keeper,
        outcome: {
          survivingSongs: await count(
            client,
            'SELECT count(*)::text AS n FROM songs WHERE artist = $1',
            [artist],
          ),
          keeperRepertoire: (
            await client.query<CollapseOutcome['keeperRepertoire']>(
              `SELECT id, status::text AS status, tags, personal_key,
                      to_char(last_practiced, 'YYYY-MM-DD') AS last_practiced
                 FROM ${LEGACY_REPERTOIRE_TABLE} WHERE id = $1`,
              [keeperRep],
            )
          ).rows[0],
          loserRepertoireRows: await count(
            client,
            `SELECT count(*)::text AS n FROM ${LEGACY_REPERTOIRE_TABLE} WHERE id = $1`,
            [loserRep],
          ),
          tabRepertoireIds: (
            await client.query<{ repertoire_id: string }>(
              `SELECT repertoire_id FROM ${LEGACY_TABS_TABLE} WHERE title = $1`,
              [`Tab ${sfx}`],
            )
          ).rows.map((r) => r.repertoire_id),
          playlistSongIds: (
            await client.query<{ song_id: string }>(
              'SELECT song_id FROM playlist_songs WHERE playlist_id = $1',
              [playlistId],
            )
          ).rows.map((r) => r.song_id),
          editSongIds: (
            await client.query<{ song_id: string }>(
              'SELECT song_id FROM global_song_edits WHERE requested_by = $1',
              [userId],
            )
          ).rows.map((r) => r.song_id),
          versionLabels: (
            await client.query<{ label: string | null }>(
              'SELECT label FROM song_versions WHERE song_id = $1 ORDER BY label NULLS FIRST',
              [keeper],
            )
          ).rows.map((r) => r.label),
        },
      }
    })

    keeperId = result.keeperId
    outcome = result.outcome
  })

  it('leaves one songs row for the artist', () => {
    expect(outcome.survivingSongs).toBe(1)
  })

  it('keeps the survivor repertoire row untouched — not merged, not maxed, not unioned', () => {
    // Every one of these is the keeper's own value. The loser's 'mastered',
    // 'loser-tag', 'G' and more recent practice date are discarded, which is
    // the stated loss, not a bug.
    expect(outcome.keeperRepertoire.status).toBe('learning')
    expect(outcome.keeperRepertoire.tags).toEqual(['keeper-tag'])
    expect(outcome.keeperRepertoire.personal_key).toBe('C')
    expect(outcome.keeperRepertoire.last_practiced).toBeTruthy()
  })

  it('deletes the loser repertoire row rather than re-pointing it', () => {
    expect(outcome.loserRepertoireRows).toBe(0)
  })

  it('re-points the loser repertoire tabs at the surviving repertoire row', () => {
    // Not cascaded away: the FK is ON DELETE CASCADE, so the re-point has to
    // happen before the delete or the uploaded chart is gone.
    expect(outcome.tabRepertoireIds).toEqual([outcome.keeperRepertoire.id])
  })

  it('leaves one playlist entry, pointing at the survivor', () => {
    expect(outcome.playlistSongIds).toEqual([keeperId])
  })

  it('re-points the pending moderation edit at the survivor', () => {
    expect(outcome.editSongIds).toEqual([keeperId])
  })

  it('re-points both versions at the survivor, keeping their distinct labels', () => {
    expect(outcome.versionLabels).toEqual([null, '2011 Remaster'])
  })
})
