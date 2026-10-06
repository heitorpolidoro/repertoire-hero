/**
 * RH-125 — the `playlist_songs` re-key migration against a real Postgres.
 *
 * `scripts/migrate.mjs` applies each migration file once per database and
 * records it in `_migrations`, so by the time any other `*.db.test.ts` runs the
 * schema is already the post-migration one and nothing has replayed the file.
 * This suite replays it, on the recipe RH-95 established and RH-123 / RH-124
 * adopted, with one change:
 *
 *  1. the file is resolved off disk by its `_playlist_songs_version_id.sql`
 *     **suffix**, never by a four-digit prefix — several approved specs each
 *     claim "the next number", so whichever lands second renumbers and a prefix
 *     written into a test would break on that renumber (ER1);
 *  2. the pre-migration shape is rebuilt **in a throwaway schema** rather than
 *     in `public`, and the whole scenario runs inside one transaction it always
 *     rolls back.
 *
 * WHY A THROWAWAY SCHEMA
 *
 * The sibling replay suites used to rebuild their legacy shape in `public`,
 * which takes an ACCESS EXCLUSIVE lock on a table every other vitest worker is
 * reading and writing at the same time. (RH-129 moved the last two of them —
 * `songFilesMigration` and `ownerSongsMigration` — into throwaway schemas too,
 * so this is now what every replay suite in the repository does, and the
 * advisory lock the `public` ones shared is gone. The reasoning below is why,
 * and is unchanged.) For `playlist_songs` that is not merely slow: this
 * transaction has to hold that lock and then touch `song_versions` (the new
 * column's foreign key), while an ordinary playlist read locks `playlists` and
 * *then* `playlist_songs` — a lock-order inversion, which Postgres resolves by
 * killing one transaction at random. It surfaced as unrelated suites failing
 * with `deadlock detected`.
 *
 * So the scenario creates `rh125_<token>`, puts it first on the transaction's
 * `search_path`, and declares its own `songs`, `albums`, `song_versions`,
 * `playlist_songs` and `migrate_catalog_to_versions()` there. Every unqualified
 * name in the migration file then resolves into that schema, nothing outside it
 * is touched, and no lock is shared with any other worker — so this suite needs
 * no advisory lock either. The tables carry exactly the columns the migration
 * names; what is asserted here is the file's behaviour, while the production
 * DDL it runs against is exercised by `npm run db:migrate` on every build.
 *
 * **Conservation (ER7) is the assertion that cannot be replaced by any other.**
 * An entry that silently disappeared leaves no trace once `song_id` is gone, so
 * the count is captured *before* the file runs and compared against the two
 * places an entry can legitimately have gone. It is specifically what catches
 * the representative-version ordering written as an inner join through
 * `albums`, which would archive every album-less version's entry.
 *
 * **The representative pick is asserted by name, not inherited** (ER2): one
 * song per tier of the ordering, each seeded so that *only* that tier can
 * choose its winner — an `album` version against a `single`, two `album`
 * releases differing only by `release_date`, and two versions of one album
 * differing only by `created_at` — and the assertions name the version each
 * entry must land on. The ordering can diverge from `src/lib/songVersions.ts`'
 * without any other assertion in the suite noticing, which is why it is pinned
 * here rather than by reference, and why each tier needs a fixture of its own:
 * a tier no fixture isolates can be deleted from the migration with the whole
 * suite still green.
 *
 * No transaction-control literal appears in this file: the scenario opens its
 * transaction with `withTransaction`, the only sanctioned way
 * (`transactionGuard.test.ts`), and unwinds it by throwing a sentinel.
 *
 * The assertions that only read the migration **file** — that it names
 * `uq_playlist_song_position` nowhere (ER3), writes no `position` value, and
 * joins `albums` with a `LEFT JOIN` only (ER8) — live in
 * `playlistVersionGuards.test.ts` instead, so they run whether or not
 * `RUN_DB_TESTS` is set. A skipped test asserts nothing.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { withTransaction, type Queryable } from '@/lib/db'
import { legacyPlaylistSongsDdl } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations')
/** The stable half of the migration's name; the four-digit prefix may move. */
const MIGRATION_SUFFIX = '_playlist_songs_version_id.sql'

function migrationFileNames(): string[] {
  return fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(MIGRATION_SUFFIX))
}

function migrationSql(): string {
  const names = migrationFileNames()
  if (names.length !== 1) {
    throw new Error(`expected exactly one *${MIGRATION_SUFFIX} migration, found ${names.length}`)
  }
  return fs.readFileSync(path.join(MIGRATIONS_DIR, names[0]), 'utf8')
}

/** One carried entry, as it stands after the migration. */
interface CarriedEntry {
  id: string
  version_id: string
  position: number
  song_id: string
}

interface ConstraintModeRow {
  conname: string
  condeferrable: boolean
  condeferred: boolean
}

interface MigrationScenario {
  /** `count(*)` of the seeded entries, captured before the file ran. */
  seededCount: number
  entries: CarriedEntry[]
  orphans: { reason: string; row_json: Record<string, unknown> }[]
  playlistSongsColumns: string[]
  /** `(condeferrable, condeferred)` of the two uniques, after the migration. */
  versionUnique: ConstraintModeRow | undefined
  positionUnique: ConstraintModeRow | undefined
  /** The same pair for the position unique, captured *before* the file ran. */
  positionUniqueBefore: ConstraintModeRow | undefined
  /** The versions the ordering has to choose, by name (ER2). */
  albumVersionId: string
  singleVersionId: string
  earlierVersionId: string
  laterVersionId: string
  earlyReleaseVersionId: string
  lateReleaseVersionId: string
  /** ER8: a version with no album row, and one whose album has no release date. */
  albumlessVersionId: string
  nullDateVersionId: string
  /** The entry whose song has no version at all (ER7). */
  versionlessEntryId: string
  /** ER5: two versions of one song in one playlist, and a repeat refused. */
  twoTakesVersionIds: string[]
  duplicateRefused: boolean
  duplicateMessage: string
}

const ROLLBACK = 'RH-125 playlist re-key migration scenario rollback'

async function insertId(client: Queryable, sql: string, params: unknown[]): Promise<string> {
  const res = await client.query<{ id: string }>(sql, params)
  return res.rows[0].id
}

/** The two uniques on the replay schema's `playlist_songs`, by name. */
async function constraintModes(
  client: Queryable,
  schema: string,
): Promise<Map<string, ConstraintModeRow>> {
  const res = await client.query<ConstraintModeRow>(
    `SELECT conname, condeferrable, condeferred
       FROM pg_constraint
      WHERE conrelid = '${schema}.playlist_songs'::regclass AND contype = 'u'`,
    [],
  )
  return new Map(res.rows.map((row) => [row.conname, row]))
}

/**
 * The replay schema: just the columns the migration file names, plus a no-op
 * `migrate_catalog_to_versions()`.
 *
 * The stub matters for ER7: the real function would hand the versionless song a
 * version and make the archive step unreachable, and that step is the one with
 * no second chance once `song_id` is dropped. Step 1 of the migration still
 * *calls* it — a missing function would raise — so it is replaced rather than
 * removed, and in this schema rather than in `public`.
 */
function replaySchemaDdl(schema: string): string {
  return `
    CREATE SCHEMA ${schema};
    CREATE TABLE ${schema}.songs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    );
    CREATE TABLE ${schema}.albums (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        album_type   text NOT NULL DEFAULT 'album',
        release_date date
    );
    CREATE TABLE ${schema}.song_versions (
        id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        song_id    uuid        NOT NULL REFERENCES ${schema}.songs(id) ON DELETE CASCADE,
        album_id   uuid        REFERENCES ${schema}.albums(id) ON DELETE SET NULL,
        label      text,
        created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE FUNCTION ${schema}.migrate_catalog_to_versions() RETURNS void
        LANGUAGE sql AS 'SELECT 1';
  `
}

/** The seeded catalog: six songs, each a different shape of the version pick. */
interface SeededCatalog {
  albumVersionId: string
  singleVersionId: string
  earlierVersionId: string
  laterVersionId: string
  earlyReleaseVersionId: string
  lateReleaseVersionId: string
  albumlessVersionId: string
  nullDateVersionId: string
  pickSongId: string
  createdAtSongId: string
  releaseDateSongId: string
  albumlessSongId: string
  nullDateSongId: string
  versionlessSongId: string
}

/**
 * ER2's and ER8's fixture. Every version is written by hand rather than through
 * RH-122's backfill, because a fixture where every song has exactly one version
 * on exactly one album is the fixture an inner join and a wrong ordering both
 * pass.
 *
 * **Every tier a fixture leans on gets an explicit value.** The default below
 * is `now()`, which is `transaction_timestamp()` and therefore **frozen** for
 * the whole scenario — it opens one transaction — so two versions written
 * without an explicit `created_at` carry the *same* one and that tier decides
 * nothing: the pick falls through to `v.id ASC` on two random UUIDs. A fixture
 * like that passes whatever the ordering does with the tiers above it, which is
 * precisely the mutation this suite exists to catch.
 */
async function seedCatalog(client: Queryable, schema: string): Promise<SeededCatalog> {
  const song = () => insertId(client, `INSERT INTO ${schema}.songs DEFAULT VALUES RETURNING id`, [])
  const album = (type: string, released: string | null) =>
    insertId(
      client,
      `INSERT INTO ${schema}.albums (album_type, release_date) VALUES ($1, $2::date) RETURNING id`,
      [type, released],
    )
  const version = (songId: string, albumId: string | null, label: string, createdAt?: string) =>
    insertId(
      client,
      `INSERT INTO ${schema}.song_versions (song_id, album_id, label, created_at)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, now())) RETURNING id`,
      [songId, albumId, label, createdAt ?? null],
    )

  // ER2, first tier: one song, an `album` version and a `single` version, and
  // **every later tier points at the single**. Its album is the earlier
  // release and its version the earlier `created_at`, so dropping the
  // `album_type` tier flips this assertion whichever tier catches the fall —
  // `release_date`, `created_at` or `id`. Both timestamps are explicit for the
  // reason in the doc comment above.
  const pickSongId = await song()
  const albumVersionId = await version(
    pickSongId,
    await album('album', '1995-06-01'),
    'Album Take',
    '2021-09-09',
  )
  const singleVersionId = await version(
    pickSongId,
    await album('single', '1995-01-01'),
    'Single Edit',
    '2021-01-01',
  )

  // ER2, second tier: two albums that differ **only** by `release_date` — both
  // `album_type = 'album'` — so `release_date` is the only tier that can decide
  // between them. The later-released version carries the *earlier*
  // `created_at`, so deleting `a.release_date ASC NULLS LAST` from the
  // migration falls through to `created_at` and picks the wrong one. Without
  // this song that line is exercised by no fixture at all: the two-album song
  // above differs by `album_type` too, and the `created_at` pair below shares
  // one album.
  const releaseDateSongId = await song()
  const earlyReleaseVersionId = await version(
    releaseDateSongId,
    await album('album', '1998-02-02'),
    'First Pressing',
    '2024-04-04',
  )
  const lateReleaseVersionId = await version(
    releaseDateSongId,
    await album('album', '2012-12-12'),
    'Anniversary Edition',
    '2016-06-06',
  )

  // ER2, third tier: two versions on the **same** album, differing only by
  // `created_at`. Both album-level tiers tie, so the pick is decided by the
  // first version-level tiebreaker.
  //
  // **Both ids are explicit, and `Later` deliberately carries the smaller one.**
  // The tier below `created_at` is `v.id ASC`, so with generated uuids a run
  // that deleted `v.created_at ASC` fell through to a *random* comparison and
  // this assertion was a coin flip — measured at exactly 100/100 over 200
  // trials, i.e. the mutation it exists to catch escaped half the time. Pinning
  // `Later` to the lexicographically smaller uuid makes `v.id ASC` name the
  // *wrong* version, so deleting the `created_at` tier now fails every time.
  const createdAtSongId = await song()
  const sharedAlbumId = await album('album', '2001-03-03')
  const laterVersionId = await insertId(
    client,
    `INSERT INTO ${schema}.song_versions (song_id, album_id, label, created_at, id)
     VALUES ($1, $2, 'Later', '2026-05-05'::timestamptz,
             '00000000-0000-4000-8000-000000000001'::uuid) RETURNING id`,
    [createdAtSongId, sharedAlbumId],
  )
  const earlierVersionId = await insertId(
    client,
    `INSERT INTO ${schema}.song_versions (song_id, album_id, label, created_at, id)
     VALUES ($1, $2, 'Earlier', '2020-01-01'::timestamptz,
             '00000000-0000-4000-8000-000000000002'::uuid) RETURNING id`,
    [createdAtSongId, sharedAlbumId],
  )

  // ER8, first half: the song's only version has **no album row at all**.
  const albumlessSongId = await song()
  const albumlessVersionId = await version(albumlessSongId, null, 'No Release')

  // ER8, second half: an album row whose `release_date` is null.
  const nullDateSongId = await song()
  const nullDateVersionId = await version(nullDateSongId, await album('compilation', null), 'Undated')

  // ER7: a song with no version at all. RH-122's backfill would give it one, so
  // the stub function above is what keeps this reachable — and it is the only
  // way to prove an entry is recorded rather than silently dropped by step 6's
  // `SET NOT NULL`.
  const versionlessSongId = await song()

  return {
    albumVersionId,
    singleVersionId,
    earlierVersionId,
    laterVersionId,
    earlyReleaseVersionId,
    lateReleaseVersionId,
    albumlessVersionId,
    nullDateVersionId,
    pickSongId,
    createdAtSongId,
    releaseDateSongId,
    albumlessSongId,
    nullDateSongId,
    versionlessSongId,
  }
}

/** The six seeded entries, at positions the migration must not touch. */
async function seedEntries(
  client: Queryable,
  schema: string,
  playlistId: string,
  catalog: SeededCatalog,
): Promise<Map<string, string>> {
  // Deliberately starting at 2 and leaving gaps: `position` is not written
  // anywhere in the file, so a renumbering would show up here.
  const seeded: [string, number][] = [
    [catalog.pickSongId, 2],
    [catalog.createdAtSongId, 4],
    [catalog.albumlessSongId, 5],
    [catalog.nullDateSongId, 7],
    [catalog.versionlessSongId, 9],
    [catalog.releaseDateSongId, 11],
  ]
  const entryIds = new Map<string, string>()
  for (const [songId, position] of seeded) {
    entryIds.set(
      songId,
      await insertId(
        client,
        `INSERT INTO ${schema}.playlist_songs (playlist_id, song_id, position)
         VALUES ($1, $2, $3) RETURNING id`,
        [playlistId, songId, position],
      ),
    )
  }
  return entryIds
}

async function runMigrationScenario(): Promise<MigrationScenario> {
  const sql = migrationSql()
  const schema = `rh125_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const playlistId = randomUUID()
  let scenario: MigrationScenario | undefined

  await withTransaction(async (client) => {
    // The whole replay lives in `schema`, and every unqualified name in the
    // migration file resolves into it. `public` stays on the path for the
    // extension functions (`gen_random_uuid`); nothing else there is reached.
    await client.query(replaySchemaDdl(schema))
    await client.query(`SET LOCAL search_path = ${schema}, public`)

    const catalog = await seedCatalog(client, schema)
    await client.query(legacyPlaylistSongsDdl(schema))
    const entryIds = await seedEntries(client, schema, playlistId, catalog)

    // ER3 — RH-103's deferrability, read before the file runs, so "unchanged"
    // is a comparison rather than a claim about what RH-103 happened to leave.
    const before = await constraintModes(client, schema)

    // ER7 — captured **before** the file runs: after the drop there is no
    // evidence left of an entry that disappeared.
    const seededCount = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${schema}.playlist_songs`,
      [],
    )

    // The migration, verbatim off disk, exactly as `scripts/migrate.mjs` runs it.
    await client.query(sql)

    const entries = await client.query<CarriedEntry>(
      `SELECT ps.id, ps.version_id, ps.position, v.song_id
         FROM ${schema}.playlist_songs ps
         JOIN ${schema}.song_versions v ON v.id = ps.version_id
        WHERE ps.playlist_id = $1 ORDER BY ps.position`,
      [playlistId],
    )
    const orphans = await client.query<{ reason: string; row_json: Record<string, unknown> }>(
      `SELECT reason, row_json FROM ${schema}.orphaned_playlist_entries ORDER BY reason`,
      [],
    )
    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'playlist_songs'
        ORDER BY column_name`,
      [schema],
    )

    // ER5 — two versions of **one** song in one playlist, which the dropped
    // `uq_playlist_song (playlist_id, song_id)` refused outright. A fresh
    // playlist id, so the migrated entry for the same song is not what makes
    // the second insert a duplicate.
    const secondPlaylistId = randomUUID()
    await client.query(
      `INSERT INTO ${schema}.playlist_songs (playlist_id, version_id, position)
       VALUES ($1, $2, 1), ($1, $3, 2)`,
      [secondPlaylistId, catalog.albumVersionId, catalog.singleVersionId],
    )
    const twoTakes = await client.query<{ version_id: string }>(
      `SELECT ps.version_id FROM ${schema}.playlist_songs ps
         JOIN ${schema}.song_versions v ON v.id = ps.version_id
        WHERE ps.playlist_id = $1 AND v.song_id = $2 ORDER BY ps.position`,
      [secondPlaylistId, catalog.pickSongId],
    )

    const after = await constraintModes(client, schema)

    // ER4 — the duplicate **raises**, and it is the scenario's **last**
    // statement on purpose: a failed statement aborts the whole transaction, so
    // nothing may be read after it. No savepoint either — `withTransaction`
    // owns the transaction, and a `SAVEPOINT` / `ROLLBACK TO` pair issued
    // through `query(` is what `transactionGuard.test.ts` forbids. The abort is
    // harmless here: this scenario always rolls back anyway.
    let duplicateRefused = false
    let duplicateMessage = ''
    try {
      await client.query(
        `INSERT INTO ${schema}.playlist_songs (playlist_id, version_id, position) VALUES ($1, $2, 3)`,
        [secondPlaylistId, catalog.albumVersionId],
      )
    } catch (error) {
      duplicateRefused = true
      duplicateMessage = error instanceof Error ? error.message : String(error)
    }

    scenario = {
      seededCount: Number(seededCount.rows[0].n),
      entries: entries.rows,
      orphans: orphans.rows,
      playlistSongsColumns: columns.rows.map((row) => row.column_name),
      versionUnique: after.get('uq_playlist_song_version'),
      positionUnique: after.get('uq_playlist_song_position'),
      positionUniqueBefore: before.get('uq_playlist_song_position'),
      albumVersionId: catalog.albumVersionId,
      singleVersionId: catalog.singleVersionId,
      earlierVersionId: catalog.earlierVersionId,
      laterVersionId: catalog.laterVersionId,
      earlyReleaseVersionId: catalog.earlyReleaseVersionId,
      lateReleaseVersionId: catalog.lateReleaseVersionId,
      albumlessVersionId: catalog.albumlessVersionId,
      nullDateVersionId: catalog.nullDateVersionId,
      versionlessEntryId: entryIds.get(catalog.versionlessSongId)!,
      twoTakesVersionIds: twoTakes.rows.map((row) => row.version_id),
      duplicateRefused,
      duplicateMessage,
    }

    throw new Error(ROLLBACK)
  }).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== ROLLBACK) throw error
  })

  if (!scenario) throw new Error('the migration scenario produced no snapshot')
  return scenario
}

describe.skipIf(!RUN_DB_TESTS)('the playlist_songs re-key migration (RH-125 ER1-ER8)', () => {
  let scenario: MigrationScenario

  beforeAll(async () => {
    scenario = await runMigrationScenario()
  }, 60_000)

  it('resolves exactly one migration file by its name suffix, not by a prefix (ER1)', () => {
    expect(migrationFileNames()).toHaveLength(1)
    // The prefix is free to move; only the suffix is pinned.
    expect(migrationFileNames()[0]).toMatch(/^\d{4}_playlist_songs_version_id\.sql$/)
  })

  it('leaves playlist_songs keyed by version_id, with no song_id column (ER1, ER6)', () => {
    expect(scenario.playlistSongsColumns).toEqual(['id', 'playlist_id', 'position', 'version_id'])
    expect(scenario.playlistSongsColumns).not.toContain('song_id')
  })

  it('carries every entry whose song has a version, positions unchanged (ER1, ER6)', () => {
    // The gaps the fixture seeded — 2, 4, 5, 7, 11 — survive verbatim: the file
    // writes no `position` value, so nothing renumbered or reordered.
    expect(scenario.entries.map((row) => row.position)).toEqual([2, 4, 5, 7, 11])
  })

  it('picks the album version over the single, not the earlier release (ER2)', () => {
    const entry = scenario.entries.find((row) => row.position === 2)

    expect(entry?.version_id).toBe(scenario.albumVersionId)
    // The single is the earlier release *and* the earlier `created_at`, so this
    // is specifically the `album_type = 'album'` tier being applied before
    // every tier below it.
    expect(entry?.version_id).not.toBe(scenario.singleVersionId)
  })

  it('picks the earliest release_date when the album_type tier ties (ER2)', () => {
    const entry = scenario.entries.find((row) => row.position === 11)

    // Two `album_type = 'album'` albums differing only by `release_date`: the
    // only tier that can separate them.
    expect(entry?.version_id).toBe(scenario.earlyReleaseVersionId)
    // The later-released version was created *first*, so an ordering missing
    // the `release_date` tier would fall through to `created_at` and land here.
    expect(entry?.version_id).not.toBe(scenario.lateReleaseVersionId)
  })

  it('picks the earlier created_at when both album tiers tie (ER2)', () => {
    const entry = scenario.entries.find((row) => row.position === 4)

    expect(entry?.version_id).toBe(scenario.earlierVersionId)
    // The later version was inserted *first*, so this is the `created_at`
    // tiebreaker and not insertion order falling through.
    expect(entry?.version_id).not.toBe(scenario.laterVersionId)
  })

  it('carries the album-less version and the null-release-date one (ER8)', () => {
    const versionIds = scenario.entries.map((row) => row.version_id)

    expect(versionIds).toContain(scenario.albumlessVersionId)
    expect(versionIds).toContain(scenario.nullDateVersionId)
    // Neither song was archived as unreachable, which is what an inner join
    // onto `albums` in the ordering would have done — the only entry that *was*
    // archived is the versionless one.
    expect(scenario.orphans.map((row) => row.row_json.id)).toEqual([scenario.versionlessEntryId])
  })

  it('loses no entry: the pre-count equals carried plus archived (ER7)', () => {
    const accounted = scenario.entries.length + scenario.orphans.length

    expect(scenario.seededCount).toBe(accounted)
    // Guards the guard: a fixture that seeded nothing would satisfy the
    // equality above and prove nothing at all.
    expect(scenario.seededCount).toBe(6)
  })

  it('archives the versionless entry whole, with a reason, rather than losing it (ER7)', () => {
    expect(scenario.orphans).toHaveLength(1)
    expect(scenario.orphans[0].reason).toBe('no_version')
    // The *whole* row, so the entry is recoverable by hand: its id, its
    // playlist, its position and the song it pointed at.
    expect(scenario.orphans[0].row_json).toMatchObject({
      id: scenario.versionlessEntryId,
      position: 9,
    })
    expect(scenario.orphans[0].row_json.song_id).toEqual(expect.any(String))
  })

  it('accepts two versions of one song in one playlist (ER5)', () => {
    // The old `uq_playlist_song (playlist_id, song_id)` refused the second one
    // outright, which is why importing a playlist holding an album take and a
    // remaster used to fail.
    expect(scenario.twoTakesVersionIds).toEqual([
      scenario.albumVersionId,
      scenario.singleVersionId,
    ])
  })

  it('refuses a repeat of the same (playlist_id, version_id) (ER4, ER5)', () => {
    expect(scenario.duplicateRefused).toBe(true)
    expect(scenario.duplicateMessage).toContain('uq_playlist_song_version')
  })

  it('declares the new unique plain and immediate (ER3)', () => {
    expect(scenario.versionUnique).toMatchObject({ condeferrable: false, condeferred: false })
  })

  it("leaves RH-103's position unique exactly as it found it (ER3)", () => {
    expect(scenario.positionUniqueBefore).toMatchObject({
      condeferrable: true,
      condeferred: false,
    })
    expect(scenario.positionUnique).toEqual(scenario.positionUniqueBefore)
  })
})
