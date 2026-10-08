/**
 * RH-36 — the multi-statement writes of `src/lib` against the real database.
 *
 * Fault injection happens *in Postgres*, not by mocking: a trigger whose `WHEN`
 * clause names exactly one fixture row raises an exception, so the failure lands
 * mid-transaction on the real connection. Scoping every trigger by row id
 * matters because vitest runs files in parallel workers and these tables are
 * shared with the other `*.db.test.ts` suites.
 *
 * No transaction-control literal appears anywhere in this file: a transaction
 * the test needs for itself is opened with `withTransaction`, which is the only
 * sanctioned way (see `transactionGuard.test.ts`).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  createTestUser,
  deleteTestUser,
  representativeVersionId,
  seedOwnerSong,
} from '@/lib/__tests__/test-helpers'
import { query, withTransaction } from '@/lib/db'
import { getSongEntry, updateSong } from '@/lib/ownerSongs'
import { reviewCatalogSuggestionGroup } from '@/lib/moderation'
import { addSongToPlaylist, removeSongFromPlaylist } from '@/lib/playlists'
import type { Repertoire } from '@/types/database'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''
/**
 * The position-computing insert `addSongToPlaylist` runs, verbatim. RH-125:
 * `$2` is a `song_versions.id`, and there is no `ON CONFLICT` clause — the
 * insert is positional, so an arbiter would leave a gap behind a skipped row.
 */
const POSITION_INSERT = `
  INSERT INTO playlist_songs (playlist_id, version_id, position)
  SELECT $1, $2, COALESCE(MAX(position), 0) + 1 FROM playlist_songs WHERE playlist_id = $1
`

const FAILURE_MESSAGE = 'RH-36 injected failure'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

describe.skipIf(!RUN_DB_TESTS)('multi-statement writes are atomic (real database)', () => {
  const suffix = Date.now()

  let userId: string
  let adminUserId: string
  let songId: string
  let entryId: string
  let suggestionGroupId: string
  let playlistId: string
  const extraSongIds: string[] = []
  /** The representative version of each of the four, in the same order. */
  const extraVersionIds: string[] = []

  /** Triggers installed by the test currently running, dropped in afterEach. */
  const installedTriggers: Array<{ name: string; table: string }> = []

  /**
   * Installs a row-scoped fault: `<event>` on `<table>` raises as soon as the
   * row named by `whenClause` is touched.
   */
  const injectFailure = async (
    name: string,
    table: string,
    event: 'UPDATE' | 'INSERT',
    whenClause: string,
  ) => {
    await query(
      `CREATE TRIGGER ${name} BEFORE ${event} ON ${table}
       FOR EACH ROW WHEN (${whenClause}) EXECUTE FUNCTION rh36_raise()`,
    )
    installedTriggers.push({ name, table })
  }

  const one = async (sql: string, params: unknown[] = []) => {
    const res = await query(sql, params as never)
    return res.rows[0]
  }

  beforeAll(async () => {
    await query(
      `CREATE OR REPLACE FUNCTION rh36_raise() RETURNS trigger AS $fn$
       BEGIN RAISE EXCEPTION '${FAILURE_MESSAGE}'; END;
       $fn$ LANGUAGE plpgsql`,
    )

    userId = await createTestUser({ email: `rh36-user-${suffix}@example.com` })
    adminUserId = await createTestUser({ email: `rh36-admin-${suffix}@example.com` })
    await query('UPDATE profiles SET is_system_admin = true WHERE id = $1', [adminUserId])

    const song = await one(
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [`RH-36 Song ${suffix}`, 'RH-36 Artist'],
    )
    songId = song.id as string

    entryId = await seedOwnerSong({ userId }, songId)

    suggestionGroupId = randomUUID()
    await query(
      `INSERT INTO catalog_suggestions
         (group_id, target_table, target_id, target_column, value, requested_by)
       VALUES ($1, 'songs', $2, 'title', $3::jsonb, $4)`,
      [suggestionGroupId, songId, JSON.stringify(`RH-36 Proposed ${suffix}`), userId],
    )

    const playlist = await one(
      'INSERT INTO playlists (user_id, name) VALUES ($1, $2) RETURNING id',
      [userId, `RH-36 Playlist ${suffix}`],
    )
    playlistId = playlist.id as string

    for (const label of ['A', 'B', 'C', 'D']) {
      const extra = await one(
        'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
        [`RH-36 Extra ${label} ${suffix}`, 'RH-36 Artist'],
      )
      extraSongIds.push(extra.id as string)
      // RH-125: both playlist writes take a version, so each song's
      // representative one is resolved here, once.
      extraVersionIds.push(await representativeVersionId(extra.id as string))
    }
  })

  afterEach(async () => {
    while (installedTriggers.length > 0) {
      const trigger = installedTriggers.pop()!
      await query(`DROP TRIGGER IF EXISTS ${trigger.name} ON ${trigger.table}`)
    }
  })

  afterAll(async () => {
    if (playlistId) await query('DELETE FROM playlists WHERE id = $1', [playlistId])
    for (const user of [userId, adminUserId]) {
      if (user) await deleteTestUser(user)
    }
    for (const song of [songId, ...extraSongIds]) {
      if (song) await query('DELETE FROM songs WHERE id = $1', [song])
    }
    await query('DROP FUNCTION IF EXISTS rh36_raise() CASCADE')
  })

  it('updateSong leaves songs untouched when the owner-row update fails', async () => {
    await injectFailure('rh36_fail_owner_row', 'user_songs', 'UPDATE', `OLD.id = '${entryId}'`)

    const entry = (await getSongEntry({ userId }, entryId)) as Repertoire

    await expect(
      updateSong({ userId }, entry, {
        title: `RH-36 Song ${suffix}`,
        artist: 'RH-36 Artist',
        album: 'RH-36 Album',
        key: 'C',
        status: 'learning',
        tags: ['rh36'],
        links: [],
      }),
    ).rejects.toThrow(/^Failed to update song:/)

    const song = await one('SELECT album, standard_key FROM songs WHERE id = $1', [songId])
    expect(song.album).toBeNull()
    expect(song.standard_key).toBeNull()

    const after = await one('SELECT status, tags, key FROM user_songs WHERE id = $1', [entryId])
    expect(after.status).toBe('unknown')
    expect(after.tags).toEqual([])
    expect(after.key).toBeNull()
  })

  it('reviewCatalogSuggestionGroup leaves songs untouched when flipping the group fails', async () => {
    await injectFailure(
      'rh36_fail_suggestions',
      'catalog_suggestions',
      'UPDATE',
      `OLD.group_id = '${suggestionGroupId}'`,
    )

    await expect(
      reviewCatalogSuggestionGroup(adminUserId, suggestionGroupId, 'approve'),
    ).rejects.toThrow(/^Failed to review a catalog suggestion group:/)

    const song = await one('SELECT title FROM songs WHERE id = $1', [songId])
    expect(song.title).toBe(`RH-36 Song ${suffix}`)

    const suggestion = await one(
      'SELECT status FROM catalog_suggestions WHERE group_id = $1',
      [suggestionGroupId],
    )
    expect(suggestion.status).toBe('pending')
  })

  it('leaves no connection idle in transaction after a failed write', async () => {
    // `pg_stat_activity` is refreshed at statement boundaries, so a connection
    // that is on its way back to the pool can still read as in-transaction for
    // an instant. Poll rather than sample once.
    let idle = -1
    for (let attempt = 0; attempt < 20; attempt++) {
      const row = await one(
        `SELECT count(*)::int AS count FROM pg_stat_activity
         WHERE datname = current_database() AND state = 'idle in transaction'`,
      )
      idle = row.count as number
      if (idle === 0) break
      await sleep(100)
    }

    expect(idle, 'a connection stayed idle in transaction after a rolled-back write').toBe(0)
  }, 10000)

  it('assigns MAX(position) + 1 so a removal does not produce a duplicate position', async () => {
    const [a, b, c, d] = extraVersionIds

    await addSongToPlaylist(playlistId, userId, a)
    await addSongToPlaylist(playlistId, userId, b)
    await addSongToPlaylist(playlistId, userId, c)

    await removeSongFromPlaylist(playlistId, userId, a)

    await addSongToPlaylist(playlistId, userId, d)

    const res = await query(
      'SELECT position FROM playlist_songs WHERE playlist_id = $1 ORDER BY position',
      [playlistId],
    )
    expect(res.rows.map((row) => row.position)).toEqual([2, 3, 4])
  })

  it('rejects two concurrent inserts that would take the same position', async () => {
    const fresh = await one(
      'INSERT INTO playlists (user_id, name) VALUES ($1, $2) RETURNING id',
      [userId, `RH-36 Concurrent ${suffix}`],
    )
    const concurrentPlaylistId = fresh.id as string
    const [versionA, versionB] = extraVersionIds

    const firstInserted = deferred()
    const releaseFirst = deferred()
    const secondPid = deferred<number>()

    // (1) A takes position 1 and holds its transaction open.
    const first = withTransaction(async (client) => {
      await client.query(POSITION_INSERT, [concurrentPlaylistId, versionA])
      firstInserted.resolve()
      await releaseFirst.promise
    })
    await firstInserted.promise

    // (2) B publishes its backend pid, then runs the same insert: under READ
    // COMMITTED it cannot see A's uncommitted row, computes position 1 too and
    // blocks on the unique index.
    const second = withTransaction(async (client) => {
      const pid = await client.query('SELECT pg_backend_pid() AS pid')
      secondPid.resolve(Number(pid.rows[0].pid))
      await client.query(POSITION_INSERT, [concurrentPlaylistId, versionB])
    })
    // Attached early so a rejection before the assertion is never unhandled.
    const secondOutcome = second.then(
      () => null,
      (error: unknown) => error,
    )

    // (3) Wait for the block to be real, scoped to B's own backend — an
    // unscoped count would be satisfied by an unrelated parallel worker.
    const pid = await secondPid.promise
    let waiting = 0
    for (let attempt = 0; attempt < 50 && waiting < 1; attempt++) {
      const row = await one(
        'SELECT count(*)::int AS count FROM pg_locks WHERE pid = $1 AND NOT granted',
        [pid],
      )
      waiting = row.count as number
      if (waiting < 1) await sleep(100)
    }
    expect(
      waiting,
      'the second insert never blocked: releasing now would let it read the ' +
        'committed row and legitimately compute the next position, so the test ' +
        'would pass against the buggy code too',
    ).toBeGreaterThanOrEqual(1)

    // (4) Only now let A commit, with B already waiting on the index.
    releaseFirst.resolve()
    await first

    const error = await secondOutcome
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('uq_playlist_song_position')

    const rows = await query(
      'SELECT version_id, position FROM playlist_songs WHERE playlist_id = $1',
      [concurrentPlaylistId],
    )
    expect(rows.rows).toEqual([{ version_id: versionA, position: 1 }])

    await query('DELETE FROM playlists WHERE id = $1', [concurrentPlaylistId])
  }, 20000)
})
