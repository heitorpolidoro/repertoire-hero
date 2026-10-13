/**
 * RH-155 — split a song's versions onto another song, and merge one song into
 * another, against the real database.
 *
 * Every fixture carries a per-test suffix `s` in its artist, so snapshots are
 * scoped to this test's rows only (vitest runs files in parallel workers over
 * shared tables). The atomicity fault is a Postgres trigger scoped to one id.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createTestUser, deleteTestUser } from '@/lib/__tests__/test-helpers'
import { query } from '@/lib/db'
import { mergeSongs, splitSongVersions } from '@/lib/catalogAdmin'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''
const DENIED = 'Access denied: User is not a system admin'

describe.skipIf(!RUN_DB_TESTS)('admin song split and merge (real database)', () => {
  let s: string
  let admin: string
  let plain: string
  let u1: string
  let u2: string
  let band: string
  let p1: string
  let src: string
  let tgt: string
  let v1: string
  let v2: string
  let v3: string
  let t1: string
  const triggers: string[] = []
  const users: string[] = []

  const one = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows[0]
  const newSong = async (tag: string) =>
    (await one('INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id', [
      `RH-155 ${tag} ${s}`,
      `RH-155 Artist ${s}`,
    ])).id as string
  const newVersion = async (songId: string, label: string) =>
    (await one('INSERT INTO song_versions (song_id, label) VALUES ($1, $2) RETURNING id', [
      songId,
      label,
    ])).id as string
  const ownerRow = async (table: 'user_songs' | 'band_songs', owner: string, version: string) =>
    (await one(
      `INSERT INTO ${table} (${table === 'user_songs' ? 'user_id' : 'band_id'}, version_id, status)
       VALUES ($1, $2, 'learning'::song_status) RETURNING id`,
      [owner, version],
    )).id as string
  const playlistRow = async (version: string, position: number) =>
    (await one(
      'INSERT INTO playlist_songs (playlist_id, version_id, position) VALUES ($1, $2, $3) RETURNING id',
      [p1, version, position],
    )).id as string
  const link = async (songId: string, url: string, position: number) =>
    (await one(
      'INSERT INTO song_links (song_id, url, label, position) VALUES ($1, $2, $3, $4) RETURNING id',
      [songId, url, `L-${url}`, position],
    )).id as string
  const file = async (userId: string, songId: string) =>
    (await one(
      "INSERT INTO song_files (user_id, song_id, title, file_url) VALUES ($1, $2, 't', 'https://x/f.pdf') RETURNING id",
      [userId, songId],
    )).id as string
  const suggestion = async (table: string, column: string, target: string) => {
    const id = (await one(
      `INSERT INTO catalog_suggestions (group_id, target_table, target_id, target_column, value, requested_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id`,
      [randomUUID(), table, target, column, JSON.stringify('x'), u1],
    )).id as string
    return id
  }
  const songOf = async (versionId: string) =>
    (await one('SELECT song_id FROM song_versions WHERE id = $1', [versionId]))?.song_id as
      | string
      | undefined

  /** Every row of every affected table that belongs to this test. */
  const snapshot = async () => {
    const songs = (await query(
      'SELECT id, title, artist FROM songs WHERE artist LIKE $1 ORDER BY id',
      [`%${s}`],
    )).rows
    const ids = songs.map((r) => r.id as string)
    const versions = (await query(
      'SELECT id, song_id FROM song_versions WHERE song_id = ANY($1::uuid[]) ORDER BY id',
      [ids],
    )).rows
    const vids = versions.map((r) => r.id as string)
    const out: Record<string, unknown[]> = { songs, song_versions: versions }
    for (const table of ['user_songs', 'band_songs', 'playlist_songs']) {
      out[table] = (await query(
        `SELECT * FROM ${table} WHERE version_id = ANY($1::uuid[]) ORDER BY id`,
        [vids],
      )).rows
    }
    for (const table of ['song_files', 'song_links']) {
      out[table] = (await query(
        `SELECT id, song_id FROM ${table} WHERE song_id = ANY($1::uuid[]) ORDER BY id`,
        [ids],
      )).rows
    }
    out.catalog_suggestions = (await query(
      'SELECT id, target_id FROM catalog_suggestions WHERE target_id = ANY($1::uuid[]) ORDER BY id',
      [[...ids, ...vids, ...(await linkIds(ids))]],
    )).rows
    return out
  }
  const linkIds = async (songIds: string[]) =>
    (await query('SELECT id FROM song_links WHERE song_id = ANY($1::uuid[])', [songIds])).rows.map(
      (r) => r.id as string,
    )

  const installFault = async (table: string, event: string, whenClause: string) => {
    const name = `rh155_fn_${randomUUID().replace(/-/g, '').slice(0, 10)}`
    await query(
      `CREATE FUNCTION ${name}() RETURNS trigger AS $fn$
       BEGIN RAISE EXCEPTION 'RH-155 injected failure'; END; $fn$ LANGUAGE plpgsql`,
    )
    triggers.push(`DROP FUNCTION IF EXISTS ${name}() CASCADE`)
    await query(
      `CREATE TRIGGER ${name} BEFORE ${event} ON ${table}
       FOR EACH ROW WHEN (${whenClause}) EXECUTE FUNCTION ${name}()`,
    )
  }

  beforeEach(async () => {
    s = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const mk = async (tag: string) => {
      const id = await createTestUser({ email: `rh155-${tag}-${s}@example.com` })
      users.push(id)
      return id
    }
    admin = await mk('admin')
    await query('UPDATE profiles SET is_system_admin = true WHERE id = $1', [admin])
    plain = await mk('plain')
    u1 = await mk('u1')
    u2 = await mk('u2')
    band = (await one('INSERT INTO bands (name, invite_code) VALUES ($1, $2) RETURNING id', [
      `RH-155 band ${s}`,
      `rh155-${s}`,
    ])).id as string
    p1 = (await one('INSERT INTO playlists (user_id, name) VALUES ($1, $2) RETURNING id', [
      u1,
      `p1 ${s}`,
    ])).id as string
    src = await newSong('Source')
    tgt = await newSong('Target')
    v1 = await newVersion(src, 'one')
    v2 = await newVersion(src, 'two')
    v3 = await newVersion(src, 'three')
    t1 = await newVersion(tgt, 'one')
  })

  afterEach(async () => {
    while (triggers.length > 0) await query(triggers.pop()!)
    const snap = await snapshot()
    const songIds = (snap.songs as Array<{ id: string }>).map((r) => r.id)
    const vids = (snap.song_versions as Array<{ id: string }>).map((r) => r.id)
    const lids = await linkIds(songIds)
    await query('DELETE FROM catalog_suggestions WHERE target_id = ANY($1::uuid[])', [
      [...songIds, ...vids, ...lids],
    ])
    await query('DELETE FROM playlists WHERE id = $1', [p1])
    await query('DELETE FROM bands WHERE id = $1', [band])
    await query('DELETE FROM songs WHERE id = ANY($1::uuid[])', [songIds])
    while (users.length > 0) await deleteTestUser(users.pop()!)
  })

  describe('non-admin', () => {
    it('is rejected by both functions and changes nothing', async () => {
      await ownerRow('user_songs', u1, v1)
      await link(src, 'https://a.example/1', 1)
      await file(u1, src)
      await suggestion('songs', 'title', src)
      const before = await snapshot()

      await expect(splitSongVersions(plain, src, [v1], { songId: tgt })).rejects.toThrow(DENIED)
      await expect(
        splitSongVersions(plain, src, [v1], { new: { artist: `N ${s}`, title: 'N' } }),
      ).rejects.toThrow(DENIED)
      await expect(mergeSongs(plain, src, tgt)).rejects.toThrow(DENIED)
      await expect(mergeSongs(randomUUID(), src, tgt)).rejects.toThrow(DENIED)

      expect(await snapshot()).toEqual(before)
    })
  })

  describe('split', () => {
    it('moves exactly the chosen versions onto a new song', async () => {
      await splitSongVersions(admin, src, [v1, v2], {
        new: { artist: `RH-155 New ${s}`, title: 'Fresh' },
      })
      const created = await one(
        'SELECT id, standard_key FROM songs WHERE title = $1 AND artist = $2',
        ['Fresh', `RH-155 New ${s}`],
      )
      expect(created).toBeTruthy()
      expect(await songOf(v1)).toBe(created.id)
      expect(await songOf(v2)).toBe(created.id)
      expect(await songOf(v3)).toBe(src)
      await query('DELETE FROM songs WHERE id = $1', [created.id])
    })

    it('copies cover, key and duration from the source onto the new song', async () => {
      await query(
        "UPDATE songs SET standard_key = 'Am', cover_url = 'https://c/x.png', duration_seconds = 200 WHERE id = $1",
        [src],
      )
      await splitSongVersions(admin, src, [v1], { new: { artist: `RH-155 New ${s}`, title: 'Fresh' } })
      const created = await one(
        'SELECT standard_key, cover_url, duration_seconds FROM songs WHERE title = $1 AND artist = $2',
        ['Fresh', `RH-155 New ${s}`],
      )
      expect(created).toEqual({ standard_key: 'Am', cover_url: 'https://c/x.png', duration_seconds: 200 })
      await query('DELETE FROM songs WHERE artist = $1', [`RH-155 New ${s}`])
    })

    it('refuses a new (artist, title) equal to an existing song, ignoring case and spaces', async () => {
      const before = await snapshot()
      const title = (await one('SELECT title FROM songs WHERE id = $1', [tgt])).title as string
      const artist = (await one('SELECT artist FROM songs WHERE id = $1', [tgt])).artist as string
      await expect(
        splitSongVersions(admin, src, [v1], {
          new: { artist: `  ${artist.toUpperCase()} `, title: ` ${title.toLowerCase()}` },
        }),
      ).rejects.toThrow(/already exists/)
      expect(await snapshot()).toEqual(before)
    })

    it('refuses moving every version, a foreign version, an empty list and the same target', async () => {
      const before = await snapshot()
      const to = { songId: tgt }
      await expect(splitSongVersions(admin, src, [v1, v2, v3], to)).rejects.toThrow(/merge/i)
      await expect(splitSongVersions(admin, src, [t1], to)).rejects.toThrow(/belong/)
      await expect(splitSongVersions(admin, src, [], to)).rejects.toThrow(/at least one/)
      await expect(splitSongVersions(admin, src, [v1], { songId: src })).rejects.toThrow(/differ/)
      await expect(splitSongVersions(admin, src, [v1], { songId: randomUUID() })).rejects.toThrow(
        /not found/,
      )
      await expect(splitSongVersions(admin, randomUUID(), [v1], to)).rejects.toThrow(/not found/)
      expect(await snapshot()).toEqual(before)
    })

    it('attaches the chosen versions to an existing song and merges a duplicate', async () => {
      const uSrc = await ownerRow('user_songs', u1, v1) // v1 collides with t1 (label one)
      await playlistRow(v1, 1)
      const sug = await suggestion('songs', 'title', v1)
      await splitSongVersions(admin, src, [v1, v2], { songId: tgt })

      expect(await songOf(v1)).toBeUndefined() // merged into t1
      expect(await songOf(v2)).toBe(tgt)
      expect(await songOf(v3)).toBe(src)
      expect((await one('SELECT version_id FROM user_songs WHERE id = $1', [uSrc])).version_id).toBe(t1)
      expect((await one('SELECT version_id FROM playlist_songs WHERE playlist_id = $1', [p1])).version_id).toBe(t1)
      expect((await one('SELECT target_id FROM catalog_suggestions WHERE id = $1', [sug])).target_id).toBe(t1)
    })

    it('copies links deduped by url after the target max position and leaves the source its own', async () => {
      await link(src, 'https://a.example/shared', 1)
      await link(src, 'https://a.example/only-src', 2)
      await link(tgt, 'https://a.example/shared', 7)
      await splitSongVersions(admin, src, [v1], { songId: tgt })

      const rows = (await query(
        'SELECT url, position FROM song_links WHERE song_id = $1 ORDER BY position',
        [tgt],
      )).rows
      expect(rows.map((r) => r.url)).toEqual(['https://a.example/shared', 'https://a.example/only-src'])
      expect(rows[1].position).toBeGreaterThan(7)
      const srcRows = await query('SELECT 1 FROM song_links WHERE song_id = $1', [src])
      expect(srcRows.rows).toHaveLength(2)
    })

    it('moves a file only for a user who holds a moved version and no remaining one', async () => {
      await ownerRow('user_songs', u1, v1) // moved only -> file moves
      await ownerRow('user_songs', u2, v1) // moved ...
      await ownerRow('user_songs', u2, v3) // ... and remaining -> file stays
      const f1 = await file(u1, src)
      const f2 = await file(u2, src)
      const fOther = await file(admin, src) // holds nothing -> stays
      await splitSongVersions(admin, src, [v1], { songId: tgt })

      const at = async (id: string) => (await one('SELECT song_id FROM song_files WHERE id = $1', [id])).song_id
      expect(await at(f1)).toBe(tgt)
      expect(await at(f2)).toBe(src)
      expect(await at(fOther)).toBe(src)
    })

    it('rolls everything back when it fails midway', async () => {
      await ownerRow('user_songs', u1, v1)
      await link(src, 'https://a.example/1', 1)
      await file(u1, src)
      await installFault('song_files', 'UPDATE', `OLD.user_id = '${u1}'`)
      const before = await snapshot()
      await expect(splitSongVersions(admin, src, [v1], { songId: tgt })).rejects.toThrow(
        /^Failed to split song versions:.*injected failure/,
      )
      expect(await snapshot()).toEqual(before)
    })

    it('rolls back a new song insert when a later step fails', async () => {
      await installFault('song_versions', 'UPDATE', `OLD.id = '${v1}'`)
      const before = await snapshot()
      await expect(
        splitSongVersions(admin, src, [v1], { new: { artist: `RH-155 New ${s}`, title: 'Fresh' } }),
      ).rejects.toThrow(/injected failure/)
      expect(await snapshot()).toEqual(before)
    })
  })

  describe('merge songs', () => {
    it('moves versions, files, links and songs suggestions and deletes A', async () => {
      const vNew = v2
      const f1 = await file(u1, src)
      await link(src, 'https://a.example/shared', 1)
      const lKeep = await link(src, 'https://a.example/only-src', 2)
      const lDup = await link(src, 'https://a.example/dup', 3)
      await link(tgt, 'https://a.example/shared', 4)
      const lSurvivor = await link(tgt, 'https://a.example/dup', 5)
      const sSong = await suggestion('songs', 'title', src)
      const sKeep = await suggestion('song_links', 'label', lKeep)
      const sDup = await suggestion('song_links', 'label', lDup)

      await mergeSongs(admin, src, tgt)

      expect(await one('SELECT 1 AS x FROM songs WHERE id = $1', [src])).toBeUndefined()
      expect(await songOf(vNew)).toBe(tgt)
      expect(await songOf(v3)).toBe(tgt)
      expect(await songOf(v1)).toBeUndefined() // label "one" collides with t1 -> merged away
      const q = async (sql: string, id: string) => (await one(sql, [id])) as Record<string, string>
      expect((await q('SELECT song_id FROM song_files WHERE id = $1', f1)).song_id).toBe(tgt)
      expect((await q('SELECT target_id FROM catalog_suggestions WHERE id = $1', sSong)).target_id).toBe(tgt)
      expect((await q('SELECT song_id FROM song_links WHERE id = $1', lKeep)).song_id).toBe(tgt)
      expect(await one('SELECT 1 AS x FROM song_links WHERE id = $1', [lDup])).toBeUndefined()
      expect((await q('SELECT target_id FROM catalog_suggestions WHERE id = $1', sKeep)).target_id).toBe(lKeep)
      expect((await q('SELECT target_id FROM catalog_suggestions WHERE id = $1', sDup)).target_id).toBe(lSurvivor)
      const urls = (await query('SELECT url, position FROM song_links WHERE song_id = $1 ORDER BY position', [tgt])).rows
      expect(urls.map((r) => r.url)).toEqual([
        'https://a.example/shared',
        'https://a.example/dup',
        'https://a.example/only-src',
      ])
      expect(urls[2].position).toBeGreaterThan(5)
    })

    it('merges duplicate versions through the version merge, keeping B and contiguous positions', async () => {
      const uA = await ownerRow('user_songs', u1, v1)
      const uB = await ownerRow('user_songs', u1, t1)
      const bA = await ownerRow('band_songs', band, v1)
      await ownerRow('user_songs', u2, v2)
      const plA = await playlistRow(v1, 1)
      await playlistRow(t1, 2)
      await playlistRow(v2, 3)
      const sug = await suggestion('songs', 'title', v1)

      await mergeSongs(admin, src, tgt)

      expect(await one('SELECT 1 AS x FROM user_songs WHERE id = $1', [uA])).toBeUndefined()
      expect(await one('SELECT 1 AS x FROM user_songs WHERE id = $1', [uB])).toBeTruthy()
      expect((await one('SELECT version_id FROM band_songs WHERE id = $1', [bA])).version_id).toBe(t1)
      expect(await one('SELECT 1 AS x FROM playlist_songs WHERE id = $1', [plA])).toBeUndefined()
      const pos = (await query('SELECT position FROM playlist_songs WHERE playlist_id = $1 ORDER BY position', [p1])).rows
      expect(pos.map((r) => r.position)).toEqual([1, 2])
      expect((await one('SELECT target_id FROM catalog_suggestions WHERE id = $1', [sug])).target_id).toBe(t1)
      const left = await query('SELECT 1 FROM song_versions WHERE song_id = $1', [src])
      expect(left.rows).toHaveLength(0)
    })

    it('refuses a missing song or the same song and changes nothing', async () => {
      const before = await snapshot()
      await expect(mergeSongs(admin, src, src)).rejects.toThrow(/into itself/)
      await expect(mergeSongs(admin, src, randomUUID())).rejects.toThrow(/must exist/)
      await expect(mergeSongs(admin, randomUUID(), tgt)).rejects.toThrow(/must exist/)
      expect(await snapshot()).toEqual(before)
    })

    it('rolls everything back when it fails midway', async () => {
      await ownerRow('user_songs', u1, v1)
      await ownerRow('user_songs', u1, t1)
      await link(src, 'https://a.example/1', 1)
      await file(u1, src)
      await suggestion('songs', 'title', src)
      await installFault('songs', 'DELETE', `OLD.id = '${src}'`)
      const before = await snapshot()
      await expect(mergeSongs(admin, src, tgt)).rejects.toThrow(
        /^Failed to merge songs:.*injected failure/,
      )
      expect(await snapshot()).toEqual(before)
    })
  })
})
