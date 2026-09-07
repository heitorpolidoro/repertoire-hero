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
import { createAdminTestClient, createTestUser, deleteTestUser } from '@/lib/__tests__/test-helpers'
import { query, withTransaction } from '@/lib/db'
import { updateSong } from '@/lib/songs'
import { updateEmail } from '@/lib/profile'
import { reviewGlobalSongEdit } from '@/lib/moderation'
import { addSongToPlaylist, removeSongFromPlaylist } from '@/lib/playlists'
import type { Repertoire } from '@/types/database'

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const admin = createAdminTestClient()

/** The position-computing insert `addSongToPlaylist` runs, verbatim. */
const POSITION_INSERT = `
  INSERT INTO playlist_songs (playlist_id, song_id, position)
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

describe.skipIf(!SERVICE_ROLE_KEY)('multi-statement writes are atomic (real database)', () => {
  const suffix = Date.now()

  let userId: string
  let adminUserId: string
  let songId: string
  let entryId: string
  let editId: string
  let playlistId: string
  const extraSongIds: string[] = []

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

    userId = await createTestUser(admin, { email: `rh36-user-${suffix}@example.com` })
    adminUserId = await createTestUser(admin, { email: `rh36-admin-${suffix}@example.com` })
    await query('UPDATE profiles SET is_system_admin = true WHERE id = $1', [adminUserId])

    const song = await one(
      'INSERT INTO global_songs (title, artist) VALUES ($1, $2) RETURNING id',
      [`RH-36 Song ${suffix}`, 'RH-36 Artist'],
    )
    songId = song.id as string

    const entry = await one(
      `INSERT INTO repertoire (user_id, song_id, status, tags)
       VALUES ($1, $2, 'unknown', '{}') RETURNING id`,
      [userId, songId],
    )
    entryId = entry.id as string

    const edit = await one(
      `INSERT INTO global_song_edits (song_id, requested_by, proposed_data, status)
       VALUES ($1, $2, $3, 'pending') RETURNING id`,
      [songId, userId, JSON.stringify({ title: `RH-36 Proposed ${suffix}` })],
    )
    editId = edit.id as string

    const playlist = await one(
      'INSERT INTO playlists (user_id, name) VALUES ($1, $2) RETURNING id',
      [userId, `RH-36 Playlist ${suffix}`],
    )
    playlistId = playlist.id as string

    for (const label of ['A', 'B', 'C', 'D']) {
      const extra = await one(
        'INSERT INTO global_songs (title, artist) VALUES ($1, $2) RETURNING id',
        [`RH-36 Extra ${label} ${suffix}`, 'RH-36 Artist'],
      )
      extraSongIds.push(extra.id as string)
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
      if (user) await deleteTestUser(admin, user)
    }
    for (const song of [songId, ...extraSongIds]) {
      if (song) await query('DELETE FROM global_songs WHERE id = $1', [song])
    }
    await query('DROP FUNCTION IF EXISTS rh36_raise() CASCADE')
  })

  it('updateSong leaves global_songs untouched when the repertoire update fails', async () => {
    await injectFailure('rh36_fail_repertoire', 'repertoire', 'UPDATE', `OLD.id = '${entryId}'`)

    const entry = (await one('SELECT * FROM repertoire WHERE id = $1', [entryId])) as Repertoire

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

    const song = await one('SELECT album, standard_key FROM global_songs WHERE id = $1', [songId])
    expect(song.album).toBeNull()
    expect(song.standard_key).toBeNull()

    const after = await one('SELECT status, tags, personal_key FROM repertoire WHERE id = $1', [
      entryId,
    ])
    expect(after.status).toBe('unknown')
    expect(after.tags).toEqual([])
    expect(after.personal_key).toBeNull()
  })

  it('updateEmail leaves the user row untouched when the profiles update fails', async () => {
    await injectFailure('rh36_fail_profiles', 'profiles', 'UPDATE', `OLD.id = '${userId}'`)

    const original = `rh36-user-${suffix}@example.com`

    await expect(updateEmail(userId, `rh36-changed-${suffix}@example.com`)).rejects.toThrow(
      /^Failed to update email:/,
    )

    const user = await one('SELECT email FROM "user" WHERE id = $1', [userId])
    expect(user.email).toBe(original)
  })

  it('reviewGlobalSongEdit leaves global_songs untouched when marking the edit reviewed fails', async () => {
    await injectFailure('rh36_fail_edits', 'global_song_edits', 'UPDATE', `OLD.id = '${editId}'`)

    await expect(reviewGlobalSongEdit(adminUserId, editId, 'approve')).rejects.toThrow(
      /^Failed to review global song edit:/,
    )

    const song = await one('SELECT title FROM global_songs WHERE id = $1', [songId])
    expect(song.title).toBe(`RH-36 Song ${suffix}`)

    const edit = await one('SELECT status FROM global_song_edits WHERE id = $1', [editId])
    expect(edit.status).toBe('pending')
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
    const [a, b, c, d] = extraSongIds

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
    const [songA, songB] = extraSongIds

    const firstInserted = deferred()
    const releaseFirst = deferred()
    const secondPid = deferred<number>()

    // (1) A takes position 1 and holds its transaction open.
    const first = withTransaction(async (client) => {
      await client.query(POSITION_INSERT, [concurrentPlaylistId, songA])
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
      await client.query(POSITION_INSERT, [concurrentPlaylistId, songB])
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
      'SELECT song_id, position FROM playlist_songs WHERE playlist_id = $1',
      [concurrentPlaylistId],
    )
    expect(rows.rows).toEqual([{ song_id: songA, position: 1 }])

    await query('DELETE FROM playlists WHERE id = $1', [concurrentPlaylistId])
  }, 20000)
})
