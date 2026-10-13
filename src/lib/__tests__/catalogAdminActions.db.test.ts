/**
 * RH-117 — the admin catalog Server Actions against the real database.
 *
 * Only the session is mocked; the real actions, lib and database run. Every
 * fixture id is fresh per test, and snapshots are scoped to those ids because
 * vitest runs files in parallel workers over shared tables.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))

import { getRequiredUserId } from '@/lib/auth-session'
import { createTestUser, deleteTestUser } from '@/lib/__tests__/test-helpers'
import { query } from '@/lib/db'
import {
  deleteSongVersionAction,
  getCatalogBlastRadiusAction,
  mergeSongVersionsAction,
  mergeSongsAction,
  splitSongVersionsAction,
} from '@/app/actions/catalogAdmin'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''
const DENIED = 'Access denied: User is not a system admin'

describe.skipIf(!RUN_DB_TESTS)('admin catalog actions (real database)', () => {
  const users: string[] = []
  let admin: string
  let plain: string
  let u1: string
  let playlist: string
  let songId: string
  let otherSongId: string
  let vA: string
  let vB: string
  let vC: string

  const one = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows[0]
  const asUser = (id: string) => vi.mocked(getRequiredUserId).mockResolvedValue(id)
  const newVersion = async (song: string, label: string) =>
    (await one('INSERT INTO song_versions (song_id, label) VALUES ($1, $2) RETURNING id', [
      song,
      label,
    ])).id as string

  const snapshot = async () => {
    const versions = [vA, vB, vC]
    const out: Record<string, unknown[]> = {}
    for (const table of ['user_songs', 'playlist_songs']) {
      out[table] = (await query(
        `SELECT * FROM ${table} WHERE version_id = ANY($1::uuid[]) ORDER BY id`,
        [versions],
      )).rows
    }
    out.song_versions = (await query(
      'SELECT id, song_id FROM song_versions WHERE id = ANY($1::uuid[]) ORDER BY id',
      [versions],
    )).rows
    out.songs = (await query(
      'SELECT id FROM songs WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[songId, otherSongId]],
    )).rows
    return out
  }

  beforeEach(async () => {
    const s = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const mk = async (tag: string) => {
      const id = await createTestUser({ email: `rh117-${tag}-${s}@example.com` })
      users.push(id)
      return id
    }
    admin = await mk('admin')
    await query('UPDATE profiles SET is_system_admin = true WHERE id = $1', [admin])
    plain = await mk('plain')
    u1 = await mk('u1')
    songId = (await one('INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id', [
      `RH-117 Song ${s}`,
      `RH-117 Artist ${s}`,
    ])).id as string
    otherSongId = (await one('INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id', [
      `RH-117 Other ${s}`,
      `RH-117 Artist ${s}`,
    ])).id as string
    vA = await newVersion(songId, `A-${s}`)
    vB = await newVersion(songId, `B-${s}`)
    vC = await newVersion(otherSongId, `C-${s}`)
    playlist = (await one('INSERT INTO playlists (user_id, name) VALUES ($1, $2) RETURNING id', [
      u1,
      `p ${s}`,
    ])).id as string
  })

  afterEach(async () => {
    vi.mocked(getRequiredUserId).mockReset()
    await query('DELETE FROM playlists WHERE id = $1', [playlist])
    await query('DELETE FROM songs WHERE id = ANY($1::uuid[])', [[songId, otherSongId]])
    while (users.length > 0) await deleteTestUser(users.pop()!)
  })

  const seedHolders = async (version: string) => {
    await query(
      "INSERT INTO user_songs (user_id, version_id, status) VALUES ($1, $2, 'learning'::song_status)",
      [u1, version],
    )
    await query('INSERT INTO playlist_songs (playlist_id, version_id, position) VALUES ($1, $2, 1)', [
      playlist,
      version,
    ])
  }

  it('reports the blast radius and merges through the real action as a system admin', async () => {
    await seedHolders(vA)
    asUser(admin)

    expect(await getCatalogBlastRadiusAction({ versionId: vA })).toEqual({
      repertoires: 1,
      playlists: 1,
    })

    await mergeSongVersionsAction(vA, vB)

    const us = await query('SELECT version_id FROM user_songs WHERE user_id = $1', [u1])
    expect(us.rows).toEqual([{ version_id: vB }])
    const ps = await query('SELECT version_id FROM playlist_songs WHERE playlist_id = $1', [playlist])
    expect(ps.rows).toEqual([{ version_id: vB }])
    const gone = await query('SELECT id FROM song_versions WHERE id = $1', [vA])
    expect(gone.rows).toHaveLength(0)
    const kept = await query('SELECT id FROM song_versions WHERE id = $1', [vB])
    expect(kept.rows).toHaveLength(1)
  })

  it('rejects a non-admin caller on all five actions and leaves the rows unchanged', async () => {
    await seedHolders(vA)
    asUser(plain)
    const before = await snapshot()

    await expect(getCatalogBlastRadiusAction({ versionId: vA })).rejects.toThrow(DENIED)
    await expect(mergeSongVersionsAction(vA, vB)).rejects.toThrow(DENIED)
    await expect(deleteSongVersionAction(vB)).rejects.toThrow(DENIED)
    await expect(
      splitSongVersionsAction(songId, [vA], { new: { artist: 'X', title: 'Y' } }),
    ).rejects.toThrow(DENIED)
    await expect(mergeSongsAction(songId, otherSongId)).rejects.toThrow(DENIED)

    expect(await snapshot()).toEqual(before)
  })
})
