/**
 * RH-154 — the admin catalog data layer against the real database.
 *
 * Every fixture id is fresh per test and every snapshot is scoped to those ids,
 * because vitest runs files in parallel workers over shared tables. The
 * atomicity fault is a Postgres trigger scoped to one version id.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createTestUser, deleteTestUser } from '@/lib/__tests__/test-helpers'
import { query } from '@/lib/db'
import {
  deleteSongVersion,
  getCatalogBlastRadius,
  mergeSongVersions,
} from '@/lib/catalogAdmin'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''
const DENIED = 'Access denied: User is not a system admin'

interface Fixture {
  admin: string
  plain: string
  u1: string
  u2: string
  band: string
  songId: string
  vA: string
  vB: string
  p1: string
  p2: string
}

describe.skipIf(!RUN_DB_TESTS)('admin catalog data layer (real database)', () => {
  let f: Fixture
  const triggers: string[] = []
  const users: string[] = []

  const one = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows[0]
  const newVersion = async (songId: string, label: string) =>
    (await one(
      'INSERT INTO song_versions (song_id, label) VALUES ($1, $2) RETURNING id',
      [songId, label],
    )).id as string
  const ownerRow = async (table: 'user_songs' | 'band_songs', owner: string, version: string, status: string) => {
    const col = table === 'user_songs' ? 'user_id' : 'band_id'
    return (await one(
      `INSERT INTO ${table} (${col}, version_id, status) VALUES ($1, $2, $3::song_status) RETURNING id`,
      [owner, version, status],
    )).id as string
  }
  const playlistRow = async (playlist: string, version: string, position: number) =>
    (await one(
      'INSERT INTO playlist_songs (playlist_id, version_id, position) VALUES ($1, $2, $3) RETURNING id',
      [playlist, version, position],
    )).id as string

  /** Every row of the affected tables that touches this fixture, in a stable order. */
  const snapshot = async () => {
    const versions = [f.vA, f.vB]
    const out: Record<string, unknown[]> = {}
    for (const table of ['user_songs', 'band_songs', 'playlist_songs']) {
      out[table] = (await query(
        `SELECT * FROM ${table} WHERE version_id = ANY($1::uuid[]) ORDER BY id`,
        [versions],
      )).rows
    }
    out.song_versions = (await query(
      'SELECT id FROM song_versions WHERE id = ANY($1::uuid[]) ORDER BY id',
      [versions],
    )).rows
    out.catalog_suggestions = (await query(
      'SELECT id, target_id FROM catalog_suggestions WHERE target_id = ANY($1::uuid[]) ORDER BY id',
      [versions],
    )).rows
    return out
  }

  beforeEach(async () => {
    const s = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const mk = async (tag: string) => {
      const id = await createTestUser({ email: `rh154-${tag}-${s}@example.com` })
      users.push(id)
      return id
    }
    const admin = await mk('admin')
    await query('UPDATE profiles SET is_system_admin = true WHERE id = $1', [admin])
    const plain = await mk('plain')
    const u1 = await mk('u1')
    const u2 = await mk('u2')
    const band = (await one('INSERT INTO bands (name, invite_code) VALUES ($1, $2) RETURNING id', [
      `RH-154 band ${s}`,
      `rh154-${s}`,
    ])).id as string
    const songId = (await one('INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id', [
      `RH-154 Song ${s}`,
      `RH-154 Artist ${s}`,
    ])).id as string
    // The catalog trigger-less insert may auto-create no version; labels keep ours distinct.
    const vA = await newVersion(songId, `A-${s}`)
    const vB = await newVersion(songId, `B-${s}`)
    const p1 = (await one('INSERT INTO playlists (user_id, name) VALUES ($1, $2) RETURNING id', [u1, `p1 ${s}`])).id as string
    const p2 = (await one('INSERT INTO playlists (user_id, name) VALUES ($1, $2) RETURNING id', [u2, `p2 ${s}`])).id as string
    f = { admin, plain, u1, u2, band, songId, vA, vB, p1, p2 }
  })

  afterEach(async () => {
    while (triggers.length > 0) {
      await query(triggers.pop()!)
    }
    await query('DELETE FROM catalog_suggestions WHERE target_id = ANY($1::uuid[])', [[f.vA, f.vB]])
    await query('DELETE FROM playlists WHERE id = ANY($1::uuid[])', [[f.p1, f.p2]])
    await query('DELETE FROM bands WHERE id = $1', [f.band])
    await query('DELETE FROM songs WHERE id = $1', [f.songId])
    while (users.length > 0) await deleteTestUser(users.pop()!)
  })

  const suggest = async (target: string) => {
    const id = randomUUID()
    await query(
      `INSERT INTO catalog_suggestions (group_id, target_table, target_id, target_column, value, requested_by)
       VALUES ($1, 'songs', $2, 'title', $3::jsonb, $4)`,
      [randomUUID(), target, JSON.stringify('x'), f.u1],
    )
    return id
  }

  describe('non-admin', () => {
    it('is rejected by every function and changes nothing', async () => {
      await ownerRow('user_songs', f.u1, f.vA, 'learning')
      await playlistRow(f.p1, f.vA, 1)
      await suggest(f.vA)
      const before = await snapshot()

      await expect(getCatalogBlastRadius(f.plain, { versionId: f.vA })).rejects.toThrow(DENIED)
      await expect(mergeSongVersions(f.plain, f.vA, f.vB)).rejects.toThrow(DENIED)
      await expect(deleteSongVersion(f.plain, f.vB)).rejects.toThrow(DENIED)
      await expect(deleteSongVersion(randomUUID(), f.vB)).rejects.toThrow(DENIED)

      expect(await snapshot()).toEqual(before)
    })
  })

  describe('blast radius', () => {
    it('counts distinct repertoire owners and playlists for a version and its song', async () => {
      // u1 holds A in user_songs and the band holds A: 2 repertoires.
      await ownerRow('user_songs', f.u1, f.vA, 'learning')
      await ownerRow('band_songs', f.band, f.vA, 'learning')
      // u2 holds B only.
      await ownerRow('user_songs', f.u2, f.vB, 'mastered')
      // u1 holds B too: must not add a second repertoire for the song.
      await ownerRow('user_songs', f.u1, f.vB, 'mastered')
      await playlistRow(f.p1, f.vA, 1)
      await playlistRow(f.p1, f.vB, 2)
      await playlistRow(f.p2, f.vB, 1)

      expect(await getCatalogBlastRadius(f.admin, { versionId: f.vA })).toEqual({
        repertoires: 2,
        playlists: 1,
      })
      expect(await getCatalogBlastRadius(f.admin, { versionId: f.vB })).toEqual({
        repertoires: 2,
        playlists: 2,
      })
      // Song: u1, u2 (user_songs) + band (band_songs) = 3; p1 and p2 = 2.
      expect(await getCatalogBlastRadius(f.admin, { songId: f.songId })).toEqual({
        repertoires: 3,
        playlists: 2,
      })
    })

    it('returns zeros for an unreferenced version', async () => {
      expect(await getCatalogBlastRadius(f.admin, { versionId: f.vA })).toEqual({
        repertoires: 0,
        playlists: 0,
      })
    })
  })

  describe('merge', () => {
    it('repoints user_songs, band_songs, playlist_songs and suggestions and removes A', async () => {
      await ownerRow('user_songs', f.u1, f.vA, 'learning')
      await ownerRow('band_songs', f.band, f.vA, 'polishing')
      await playlistRow(f.p1, f.vA, 1)
      const suggestionTarget = await suggest(f.vA)
      expect(suggestionTarget).toBeTruthy()

      await mergeSongVersions(f.admin, f.vA, f.vB)

      const snap = await snapshot()
      for (const table of ['user_songs', 'band_songs', 'playlist_songs']) {
        const rows = snap[table] as Array<{ version_id: string }>
        expect(rows).toHaveLength(1)
        expect(rows[0].version_id).toBe(f.vB)
      }
      expect(snap.song_versions).toEqual([{ id: f.vB }])
      expect(snap.catalog_suggestions).toEqual([
        expect.objectContaining({ target_id: f.vB }),
      ])
    })

    it('unions the album links of A onto B, ignoring a shared album (RH-120)', async () => {
      const s = randomUUID().slice(0, 8)
      const albums: string[] = []
      for (const n of ['one', 'two', 'three']) {
        albums.push(
          (await one('INSERT INTO albums (artist, name) VALUES ($1, $2) RETURNING id', [
            `RH-120 Artist ${s}`,
            `RH-120 ${n} ${s}`,
          ])).id as string,
        )
      }
      const link = (version: string, album: string) =>
        query('INSERT INTO version_albums (version_id, album_id) VALUES ($1, $2)', [version, album])
      await link(f.vA, albums[0])
      await link(f.vA, albums[1])
      await link(f.vB, albums[1])
      await link(f.vB, albums[2])

      try {
        await mergeSongVersions(f.admin, f.vA, f.vB)

        const linked = await query<{ album_id: string }>(
          'SELECT album_id FROM version_albums WHERE version_id = $1',
          [f.vB],
        )
        expect(linked.rows.map((r) => r.album_id).sort()).toEqual([...albums].sort())
        const orphaned = await query('SELECT 1 FROM version_albums WHERE version_id = $1', [f.vA])
        expect(orphaned.rows).toHaveLength(0)
      } finally {
        await query('DELETE FROM albums WHERE id = ANY($1::uuid[])', [albums])
      }
    })

    it('keeps B and drops A on a collision, with contiguous playlist positions', async () => {
      const userA = await ownerRow('user_songs', f.u1, f.vA, 'learning')
      const userB = await ownerRow('user_songs', f.u1, f.vB, 'mastered')
      const bandA = await ownerRow('band_songs', f.band, f.vA, 'learning')
      const bandB = await ownerRow('band_songs', f.band, f.vB, 'mastered')
      const other = (await one('INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id', [
        `RH-154 Other ${randomUUID()}`,
        'RH-154 Other',
      ])).id as string
      const vO1 = await newVersion(other, 'o1')
      const vO2 = await newVersion(other, 'o2')
      // p1: [O1, A, B, O2] -> A collides with B; expected [O1, B, O2] at 1..3.
      await playlistRow(f.p1, vO1, 1)
      const plA = await playlistRow(f.p1, f.vA, 2)
      const plB = await playlistRow(f.p1, f.vB, 3)
      await playlistRow(f.p1, vO2, 4)
      // p2 holds only A: repoint, untouched position.
      await playlistRow(f.p2, f.vA, 5)

      try {
        await mergeSongVersions(f.admin, f.vA, f.vB)

        const ids = async (table: string, id: string) =>
          (await query(`SELECT status FROM ${table} WHERE id = $1`, [id])).rows
        expect(await ids('user_songs', userA)).toEqual([])
        expect(await ids('user_songs', userB)).toEqual([{ status: 'mastered' }])
        expect(await ids('band_songs', bandA)).toEqual([])
        expect(await ids('band_songs', bandB)).toEqual([{ status: 'mastered' }])

        const gone = await query('SELECT 1 FROM playlist_songs WHERE id = $1', [plA])
        expect(gone.rows).toHaveLength(0)
        const kept = await query('SELECT version_id, position FROM playlist_songs WHERE id = $1', [plB])
        expect(kept.rows).toEqual([{ version_id: f.vB, position: 2 }])

        const p1 = await query(
          'SELECT position FROM playlist_songs WHERE playlist_id = $1 ORDER BY position',
          [f.p1],
        )
        expect(p1.rows.map((r) => r.position)).toEqual([1, 2, 3])
        const p2 = await query(
          'SELECT version_id, position FROM playlist_songs WHERE playlist_id = $1',
          [f.p2],
        )
        expect(p2.rows).toEqual([{ version_id: f.vB, position: 5 }])
      } finally {
        await query('DELETE FROM songs WHERE id = $1', [other])
      }
    })

    it('refuses to merge a version into itself or a missing version', async () => {
      const before = await snapshot()
      await expect(mergeSongVersions(f.admin, f.vA, f.vA)).rejects.toThrow(
        'Cannot merge a version into itself',
      )
      await expect(mergeSongVersions(f.admin, f.vA, randomUUID())).rejects.toThrow(
        'Both versions must exist to merge',
      )
      expect(await snapshot()).toEqual(before)
    })

    it('rolls everything back when the merge fails midway', async () => {
      await ownerRow('user_songs', f.u1, f.vA, 'learning')
      await ownerRow('user_songs', f.u1, f.vB, 'mastered')
      await ownerRow('band_songs', f.band, f.vA, 'learning')
      await playlistRow(f.p1, f.vA, 1)
      await playlistRow(f.p1, f.vB, 2)
      await suggest(f.vA)
      const before = await snapshot()

      const name = `rh154_fn_${randomUUID().replace(/-/g, '').slice(0, 10)}`
      await query(
        `CREATE FUNCTION ${name}() RETURNS trigger AS $fn$
         BEGIN RAISE EXCEPTION 'RH-154 injected failure'; END; $fn$ LANGUAGE plpgsql`,
      )
      triggers.push(`DROP FUNCTION IF EXISTS ${name}() CASCADE`)
      await query(
        `CREATE TRIGGER ${name} BEFORE DELETE ON song_versions
         FOR EACH ROW WHEN (OLD.id = '${f.vA}') EXECUTE FUNCTION ${name}()`,
      )

      await expect(mergeSongVersions(f.admin, f.vA, f.vB)).rejects.toThrow(
        /^Failed to merge song versions:.*injected failure/,
      )
      expect(await snapshot()).toEqual(before)
    })
  })

  describe('delete', () => {
    it('deletes an unreferenced version', async () => {
      await deleteSongVersion(f.admin, f.vA)
      expect((await snapshot()).song_versions).toEqual([{ id: f.vB }])
    })

    it('refuses a missing version', async () => {
      await expect(deleteSongVersion(f.admin, randomUUID())).rejects.toThrow('Song version not found')
    })

    it.each([
      ['user_songs', () => ownerRow('user_songs', f.u1, f.vA, 'learning')],
      ['band_songs', () => ownerRow('band_songs', f.band, f.vA, 'learning')],
      ['playlist_songs', () => playlistRow(f.p1, f.vA, 1)],
      ['catalog_suggestions', () => suggest(f.vA)],
    ])('refuses a version still referenced by %s', async (_name, seed) => {
      await seed()
      const before = await snapshot()
      await expect(deleteSongVersion(f.admin, f.vA)).rejects.toThrow(
        'Cannot delete a song version that is still referenced',
      )
      expect(await snapshot()).toEqual(before)
      expect((await snapshot()).song_versions).toHaveLength(2)
    })
  })
})
