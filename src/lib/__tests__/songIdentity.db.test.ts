/**
 * RH-95 — the one song-identity rule against a real Postgres.
 *
 * Three things are checked here that a mocked `pg` cannot answer:
 *
 *  1. the migration. It is resolved off disk by its `_unify_song_identity.sql`
 *     suffix, never by a hardcoded prefix — three specs were written against the
 *     same `0008` high-water mark, so whichever landed second had to renumber,
 *     and a prefix in a test would have broken on that renumber. It is executed
 *     against seeded duplicates inside a transaction that is always rolled back,
 *     then executed a second time to prove idempotence.
 *  2. the rule itself: album out of the key, artist in it, both UI paths
 *     converging on one row, in both orders.
 *  3. what only the database can enforce — the unique index under concurrency,
 *     and the rollback that keeps a failed create from leaving a catalog row
 *     behind.
 *
 * No transaction-control literal appears anywhere in this file: the migration
 * scenario opens its transaction with `withTransaction`, which is the only
 * sanctioned way (`transactionGuard.test.ts`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { query, withTransaction } from '@/lib/db'
import { createAndAddSong, removeSongFromRepertoire } from '@/lib/ownerSongs'
import { findOrCreateSong } from '@/lib/spotifyPlaylistSync'
import type { SpotifyRawTrack } from '@/lib/spotifyPlaylistSync'
import {
  LEGACY_CATALOG_TABLE,
  LEGACY_REPERTOIRE_DDL,
  LEGACY_REPERTOIRE_TABLE,
  LEGACY_TABS_DDL,
  LEGACY_TABS_TABLE,
  createTestUser,
  deleteTestUser,
  lockMigrationReplay,
} from './test-helpers'
import type { SongLink } from '@/types/database'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations')
/** The stable half of the migration's name; the four-digit prefix may move. */
const MIGRATION_SUFFIX = '_unify_song_identity.sql'

/** Resolves the migration by suffix and fails unless there is exactly one. */
function migrationFileNames(): string[] {
  return fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(MIGRATION_SUFFIX))
}

/**
 * The migration's text, re-addressed at the catalog table's current name.
 *
 * `migrations/0009` was written when the catalog was still called by the name
 * `LEGACY_CATALOG_TABLE` holds; RH-121's `migrations/0013` renamed it to
 * `songs`. The ledger is append-only, so `0009` keeps the old name forever and
 * replaying its text verbatim against a migrated database fails with
 * `relation ... does not exist`.
 *
 * Substituting the name is sound because that is the *only* difference RH-121
 * made to this table: a rename is a catalogue-only operation, so every
 * statement below — the duplicate grouping, the column fill, the link union,
 * the repointing of `repertoire`, `playlist_songs` and `global_song_edits`, and
 * the unique index it ends with — operates on exactly the rows and the index it
 * did before. What this file tests is `0009`'s merge logic, and that logic is
 * untouched. The substitution does not reach `global_song_edits`: its name
 * does not contain the catalog table's, which is why RH-121 could leave it
 * alone.
 *
 * It also keeps the index name aligned. `0009` ends by creating its unique
 * index under the old table's prefix, which `0013` renamed to
 * `uq_songs_artist_title` — the same name the substitution produces, and the
 * one the scenario drops before seeding its duplicates.
 */
function unifyMigrationSql(): string {
  const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, migrationFileNames()[0]), 'utf8')
  return raw.replaceAll(LEGACY_CATALOG_TABLE, 'songs')
}

/** A collision-free, dash-free token: a spaced dash is the title separator. */
function token(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12)
}

function spotifyTrack(overrides: Partial<SpotifyRawTrack>): SpotifyRawTrack {
  return {
    spotifyTrackId: 'track-1',
    title: 'Track',
    artist: 'Artist',
    album: null,
    albumArt: null,
    spotifyUrl: 'https://open.spotify.com/track/track-1',
    durationSeconds: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// ER1 — the migration file's name and place in the sequence. No database.
// ---------------------------------------------------------------------------
describe('the unify-song-identity migration file (RH-95 ER1)', () => {
  it('is exactly one file in migrations/', () => {
    expect(migrationFileNames()).toHaveLength(1)
  })

  it('carries a unique four-digit prefix with no gap below it', () => {
    const [name] = migrationFileNames()
    const prefixOf = (file: string) => Number(file.slice(0, 4))
    const others = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && f !== name)
      .map(prefixOf)
    const prefix = prefixOf(name)

    // It took the next free number when it landed, and nothing may share it.
    // Asserting it is still the *highest* would break on every later migration
    // (RH-96's drop took the next one), which says nothing about this file.
    expect(others).not.toContain(prefix)
    for (let n = 1; n < prefix; n += 1) expect(others).toContain(n)
  })
})

// ---------------------------------------------------------------------------
// ER2 / ER3 — the merge, executed for real against seeded duplicates.
// ---------------------------------------------------------------------------

interface MergeSnapshot {
  songs: Array<{
    id: string
    title: string
    album: string | null
    standard_key: string | null
    cover_url: string | null
    duration_seconds: number | null
    links: SongLink[] | null
  }>
  repertoire: Array<{ id: string; user_id: string | null; song_id: string }>
  tabs: Array<{ repertoire_id: string }>
  playlistSongs: Array<{ song_id: string; position: number }>
  edits: Array<{ song_id: string }>
}

interface MergeScenario {
  keeperId: string
  dupId: string
  otherId: string
  repA: string
  repC: string
  first: MergeSnapshot
  second: MergeSnapshot
}

/** Rolls the whole scenario back; the sentinel is how `withTransaction` undoes it. */
const ROLLBACK = 'RH-95 migration scenario rollback'

async function runMergeScenario(): Promise<MergeScenario> {
  const migrationSql = unifyMigrationSql()
  const sfx = token()
  let scenario: MergeScenario | undefined

  const seedUser = async (client: { query: typeof query }, label: string) => {
    const id = randomUUID()
    const email = `rh95-${label}-${sfx}@example.com`
    await client.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)', [id, label, email])
    await client.query('INSERT INTO profiles (id, email, full_name) VALUES ($1, $2, $3)', [id, email, label])
    return id
  }

  const insertId = async (client: { query: typeof query }, sql: string, params: unknown[]) =>
    (await client.query<{ id: string }>(sql, params)).rows[0].id

  const snapshot = async (client: { query: typeof query }, ids: string[], users: string[], playlistId: string): Promise<MergeSnapshot> => ({
    songs: (
      await client.query<MergeSnapshot['songs'][number]>(
        `SELECT id, title, album, standard_key, cover_url, duration_seconds, links
         FROM songs WHERE id = ANY($1) ORDER BY title`,
        [ids],
      )
    ).rows,
    repertoire: (
      await client.query<MergeSnapshot['repertoire'][number]>(
        `SELECT id, user_id, song_id FROM ${LEGACY_REPERTOIRE_TABLE} WHERE user_id = ANY($1) ORDER BY user_id, id`,
        [users],
      )
    ).rows,
    tabs: (
      await client.query<MergeSnapshot['tabs'][number]>(
        `SELECT rt.repertoire_id FROM ${LEGACY_TABS_TABLE} rt WHERE rt.title = $1`,
        [`Tab ${sfx}`],
      )
    ).rows,
    playlistSongs: (
      await client.query<MergeSnapshot['playlistSongs'][number]>(
        'SELECT song_id, position FROM playlist_songs WHERE playlist_id = $1 ORDER BY position',
        [playlistId],
      )
    ).rows,
    edits: (
      await client.query<MergeSnapshot['edits'][number]>(
        'SELECT song_id FROM global_song_edits WHERE requested_by = ANY($1)',
        [users],
      )
    ).rows,
  })

  await withTransaction(async (client) => {
    // First statement, before any DDL: shared with the other replay suites.
    await lockMigrationReplay(client)

    // The index the migration creates has to be gone before duplicates can be
    // seeded — `npm run db:migrate` has already run it in this database.
    await client.query('DROP INDEX IF EXISTS uq_songs_artist_title')

    // RH-123 dropped the table `0009` re-points tab rows in, and RH-124
    // dropped the owner-row table both of them hang off, so the replay needs
    // both back — the tabs table's foreign key names the latter. Inside this
    // transaction only, and rolled back with everything else;
    // `test-helpers.ts` is the one place either is spelled.
    await client.query(LEGACY_REPERTOIRE_DDL)
    await client.query(LEGACY_TABS_DDL)

    const userId = await seedUser(client, 'owner')
    const otherUserId = await seedUser(client, 'second')

    // The keeper is the oldest row and the emptiest one; the duplicate differs
    // in case and whitespace only, which is exactly what the index folds.
    const keeperId = await insertId(
      client,
      `INSERT INTO songs (title, artist, links, created_at)
       VALUES ($1, $2, $3::jsonb, now() - interval '2 days') RETURNING id`,
      [`Dup Song ${sfx}`, `Dup Artist ${sfx}`, JSON.stringify([{ label: 'Chords', url: 'http://chords' }])],
    )
    const dupId = await insertId(
      client,
      `INSERT INTO songs (title, artist, album, standard_key, cover_url, duration_seconds, links, created_at)
       VALUES ($1, $2, 'Album B', 'G', 'http://cover', 200, $3::jsonb, now() - interval '1 day') RETURNING id`,
      [
        `  dup song ${sfx}  `,
        ` DUP ARTIST ${sfx} `,
        JSON.stringify([
          { label: 'Chords again', url: 'http://chords' },
          { label: 'YT', url: 'http://yt' },
        ]),
      ],
    )
    const otherId = await insertId(
      client,
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [`Other Song ${sfx}`, `Other Artist ${sfx}`],
    )

    // The owner holds *both* rows of the group: repA already points at the
    // keeper, so repB is the one that has to go — after its tab is repointed.
    const repA = await insertId(
      client,
      `INSERT INTO ${LEGACY_REPERTOIRE_TABLE} (user_id, song_id, status) VALUES ($1, $2, 'learning') RETURNING id`,
      [userId, keeperId],
    )
    const repB = await insertId(
      client,
      `INSERT INTO ${LEGACY_REPERTOIRE_TABLE} (user_id, song_id, status) VALUES ($1, $2, 'mastered') RETURNING id`,
      [userId, dupId],
    )
    // A second owner holds only the duplicate: nothing to collide with, so the
    // row is repointed rather than dropped.
    const repC = await insertId(
      client,
      `INSERT INTO ${LEGACY_REPERTOIRE_TABLE} (user_id, song_id, status) VALUES ($1, $2, 'polishing') RETURNING id`,
      [otherUserId, dupId],
    )
    await client.query(
      `INSERT INTO ${LEGACY_TABS_TABLE} (repertoire_id, title, file_url) VALUES ($1, $2, $3)`,
      [repB, `Tab ${sfx}`, 'http://blob/tab.pdf'],
    )

    // ER3: one playlist holding both rows of the group, keeper first.
    const playlistId = await insertId(
      client,
      'INSERT INTO playlists (user_id, name) VALUES ($1, $2) RETURNING id',
      [userId, `RH95 Playlist ${sfx}`],
    )
    for (const [songId, position] of [[keeperId, 1], [otherId, 2], [dupId, 3]] as const) {
      await client.query('INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES ($1, $2, $3)', [
        playlistId,
        songId,
        position,
      ])
    }

    await client.query(
      "INSERT INTO global_song_edits (song_id, requested_by, proposed_data) VALUES ($1, $2, $3::jsonb)",
      [dupId, userId, JSON.stringify({ links: [] })],
    )

    const ids = [keeperId, dupId, otherId]
    const users = [userId, otherUserId]

    await client.query(migrationSql)
    const first = await snapshot(client, ids, users, playlistId)
    await client.query(migrationSql)
    const second = await snapshot(client, ids, users, playlistId)

    scenario = { keeperId, dupId, otherId, repA, repC, first, second }
    throw new Error(ROLLBACK)
  }).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== ROLLBACK) throw error
  })

  if (!scenario) throw new Error('the migration scenario produced no snapshot')
  return scenario
}

describe.skipIf(!RUN_DB_TESTS)('the unify-song-identity migration (RH-95 ER2, ER3)', () => {
  let scenario: MergeScenario

  beforeAll(async () => {
    scenario = await runMergeScenario()
  }, 60_000)

  it('keeps the oldest row of the group and drops the rest', () => {
    const ids = scenario.first.songs.map((s) => s.id)
    expect(ids).toContain(scenario.keeperId)
    expect(ids).not.toContain(scenario.dupId)
    expect(ids).toContain(scenario.otherId)
  })

  it('unions the links by URL, keeping the keeper copy of a shared URL', () => {
    const keeper = scenario.first.songs.find((s) => s.id === scenario.keeperId)
    expect(keeper?.links).toEqual([
      { label: 'Chords', url: 'http://chords' },
      { label: 'YT', url: 'http://yt' },
    ])
  })

  it('fills the keeper columns that were empty', () => {
    const keeper = scenario.first.songs.find((s) => s.id === scenario.keeperId)
    expect(keeper?.album).toBe('Album B')
    expect(keeper?.standard_key).toBe('G')
    expect(keeper?.cover_url).toBe('http://cover')
    expect(keeper?.duration_seconds).toBe(200)
  })

  it('collapses the owner who held both rows to the repertoire row already on the keeper', () => {
    const rows = scenario.first.repertoire.filter((r) => r.song_id === scenario.keeperId)
    expect(rows).toHaveLength(2) // one per owner
    expect(rows.map((r) => r.id)).toContain(scenario.repA)
    expect(rows.map((r) => r.id)).toContain(scenario.repC)
    expect(scenario.first.repertoire).toHaveLength(2)
  })

  it('repoints the dropped repertoire row tabs at the surviving row', () => {
    expect(scenario.first.tabs).toEqual([{ repertoire_id: scenario.repA }])
  })

  it('repoints the pending catalog edit at the keeper', () => {
    expect(scenario.first.edits).toEqual([{ song_id: scenario.keeperId }])
  })

  it('leaves one playlist row for the keeper, at the lower of the two positions, with no gap', () => {
    expect(scenario.first.playlistSongs).toEqual([
      { song_id: scenario.keeperId, position: 1 },
      { song_id: scenario.otherId, position: 2 },
    ])
  })

  it('changes nothing when it is executed a second time', () => {
    expect(scenario.second).toEqual(scenario.first)
  })
})

// ---------------------------------------------------------------------------
// ER1 (index), ER5-ER9, ER12 — the rule as the application applies it.
// ---------------------------------------------------------------------------
describe.skipIf(!RUN_DB_TESTS)('the song identity rule (RH-95)', () => {
  const sfx = token()
  let userId: string
  let secondUserId: string
  let blockedUserId: string
  const songIds = new Set<string>()

  /** Every catalog row whose title carries our suffix, so nothing is missed. */
  const catalogRows = async (title: string) => {
    const res = await query<{ id: string }>(
      'SELECT id FROM songs WHERE LOWER(BTRIM(title)) = LOWER(BTRIM($1))',
      [title],
    )
    res.rows.forEach((r) => songIds.add(r.id))
    return res.rows
  }

  const track = async (entryId: string) => {
    const res = await query<{ song_id: string }>(
      'SELECT v.song_id FROM user_songs o JOIN song_versions v ON v.id = o.version_id WHERE o.id = $1',
      [entryId],
    )
    return res.rows[0].song_id
  }

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh95-rule-a-${sfx}@example.com` })
    secondUserId = await createTestUser({ email: `rh95-rule-b-${sfx}@example.com` })
    blockedUserId = await createTestUser({ email: `rh95-rule-c-${sfx}@example.com` })
  })

  afterAll(async () => {
    for (const id of [userId, secondUserId, blockedUserId]) {
      if (id) await deleteTestUser(id)
    }
    if (songIds.size > 0) {
      await query('DELETE FROM songs WHERE id = ANY($1)', [Array.from(songIds)])
    }
  })

  it('ER1 — the identity index exists and the album index is gone', async () => {
    const res = await query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'songs'",
    )
    const byName = new Map(res.rows.map((r) => [r.indexname, r.indexdef]))

    expect(byName.get('uq_songs_artist_title')).toContain(
      '(lower(btrim(artist)), lower(btrim(title)))',
    )
    expect(byName.get('uq_songs_artist_title')).toContain('CREATE UNIQUE INDEX')
    expect(byName.has('uq_songs_title_album')).toBe(false)
  })

  it('ER5 — one title, two artists, no album: two catalog rows', async () => {
    const title = `Shared Title ${sfx}`
    const first = await createAndAddSong({ userId }, { title, artist: `Artist One ${sfx}` })
    const second = await createAndAddSong({ userId }, { title, artist: `Artist Two ${sfx}` })

    expect(second.song_id).not.toBe(first.song_id)
    expect(await catalogRows(title)).toHaveLength(2)
  })

  it('ER6 — same artist and title, different album: one row, first values intact', async () => {
    const title = `Album Blind ${sfx}`
    const artist = `Album Blind Artist ${sfx}`
    const first = await createAndAddSong(
      { userId },
      {
        title,
        artist,
        album: 'First Album',
        standard_key: 'C',
        cover_url: 'http://first-cover',
        duration_seconds: 100,
        links: [{ label: 'First', url: 'http://first' }],
      },
    )
    await removeSongFromRepertoire({ userId }, first.id)

    const second = await createAndAddSong(
      { userId },
      {
        title,
        artist,
        album: 'Second Album',
        standard_key: 'D',
        cover_url: 'http://second-cover',
        duration_seconds: 222,
        links: [{ label: 'Second', url: 'http://second' }],
      },
    )

    expect(second.song_id).toBe(first.song_id)
    expect(await catalogRows(title)).toHaveLength(1)
    expect(second.song?.album).toBe('First Album')
    expect(second.song?.standard_key).toBe('C')
    expect(second.song?.cover_url).toBe('http://first-cover')
    expect(second.song?.duration_seconds).toBe(100)
    expect(second.song?.links).toEqual([{ label: 'First', url: 'http://first' }])
  })

  it('ER7 — the manual path then the Spotify path converge on one row', async () => {
    const title = `Manual First ${sfx}`
    const artist = `Manual First Artist ${sfx}`
    const entry = await createAndAddSong({ userId }, { title, artist })

    const songId = await findOrCreateSong(
      spotifyTrack({ title, artist, spotifyUrl: 'https://open.spotify.com/track/manual-first' }),
    )

    expect(songId).toBe(entry.song_id)
    expect(await catalogRows(title)).toHaveLength(1)
  })

  it('ER7 — the Spotify path then the manual path converge on one row', async () => {
    const title = `Spotify First ${sfx}`
    const artist = `Spotify First Artist ${sfx}`
    const songId = await findOrCreateSong(
      spotifyTrack({ title, artist, spotifyUrl: 'https://open.spotify.com/track/spotify-first' }),
    )

    const entry = await createAndAddSong({ userId }, { title, artist })

    expect(entry.song_id).toBe(songId)
    expect(await catalogRows(title)).toHaveLength(1)
  })

  it('ER11 — a featured credit resolves to the primary artist row', async () => {
    const title = `Hold My Hand ${sfx}`
    const artist = `Michael Jackson ${sfx}`
    const entry = await createAndAddSong({ userId }, { title, artist })

    const songId = await findOrCreateSong(
      spotifyTrack({
        title,
        // What `primarySpotifyArtist` hands the sync for ["Michael Jackson", "Akon"].
        artist,
        spotifyUrl: 'https://open.spotify.com/track/hold-my-hand',
      }),
    )

    expect(songId).toBe(entry.song_id)
    expect(await catalogRows(title)).toHaveLength(1)
  })

  it('ER12 — a remaster title resolves to the existing sanitized row', async () => {
    const title = `Song X ${sfx}`
    const artist = `Song X Artist ${sfx}`
    const base = await createAndAddSong({ userId }, { title, artist })
    await removeSongFromRepertoire({ userId }, base.id)

    const remastered = await createAndAddSong({ userId }, { title: `${title} - 2011 Remaster`, artist })

    expect(remastered.song_id).toBe(base.song_id)
    expect(await catalogRows(title)).toHaveLength(1)
    expect(await catalogRows(`${title} - 2011 Remaster`)).toHaveLength(0)
  })

  it('ER8 — a failure at the owner-row insert leaves no catalog row behind', async () => {
    const title = `Rolled Back ${sfx}`
    const guard = `rh95_block_${sfx}`

    await query(
      `CREATE OR REPLACE FUNCTION ${guard}() RETURNS trigger AS $$
       BEGIN RAISE EXCEPTION 'RH-95 injected failure'; END; $$ LANGUAGE plpgsql`,
    )
    await query(
      `CREATE TRIGGER ${guard} BEFORE INSERT ON user_songs
       FOR EACH ROW WHEN (NEW.user_id = '${blockedUserId}'::uuid) EXECUTE FUNCTION ${guard}()`,
    )

    try {
      await expect(
        createAndAddSong({ userId: blockedUserId }, { title, artist: `Rolled Back Artist ${sfx}` }),
      ).rejects.toThrow('Failed to create and add song')
      expect(await catalogRows(title)).toHaveLength(0)
    } finally {
      await query(`DROP TRIGGER IF EXISTS ${guard} ON user_songs`)
      await query(`DROP FUNCTION IF EXISTS ${guard}()`)
    }
  })

  it('ER9 — two concurrent creates by one owner: one catalog row, one owner row', async () => {
    const title = `Race Same Owner ${sfx}`
    const data = { title, artist: `Race Artist ${sfx}` }

    const results = await Promise.allSettled([
      createAndAddSong({ userId }, data),
      createAndAddSong({ userId }, data),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toHaveProperty(
      'message',
      'Song already in your repertoire',
    )

    const rows = await catalogRows(title)
    expect(rows).toHaveLength(1)

    const reps = await query<{ id: string }>(
      `SELECT o.id FROM user_songs o
       JOIN song_versions v ON v.id = o.version_id
       WHERE o.user_id = $1 AND v.song_id = $2`,
      [userId, rows[0].id],
    )
    expect(reps.rowCount).toBe(1)
  })

  it('ER9 — two concurrent creates by different owners: one catalog row, two owner rows', async () => {
    const title = `Race Two Owners ${sfx}`
    const data = { title, artist: `Race Two Artist ${sfx}` }

    const [a, b] = await Promise.all([
      createAndAddSong({ userId }, data),
      createAndAddSong({ userId: secondUserId }, data),
    ])

    const rows = await catalogRows(title)
    expect(rows).toHaveLength(1)
    expect(await track(a.id)).toBe(rows[0].id)
    expect(await track(b.id)).toBe(rows[0].id)
    expect(a.id).not.toBe(b.id)
  })
})
