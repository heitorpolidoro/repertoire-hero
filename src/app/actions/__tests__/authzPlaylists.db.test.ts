/**
 * RH-34 — cross-tenant playlist authorization, against the real database.
 *
 * Same shape as `authzBands.db.test.ts`: only the session is mocked, every
 * refusal is checked together with a read-back proving nothing was written.
 *
 * Fixture: user A owns personal playlist P (holding one song); band Y has A as
 * admin and B as member, with band-owned playlist PB; band Z belongs to C
 * alone, so it is a band A is *not* a member of; user C is unrelated to P.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))

import { createAdminTestClient, createTestUser, deleteTestUser } from '@/lib/__tests__/test-helpers'
import { asUser, countRows, createTestSong, SERVICE_ROLE_KEY } from './authzFixtures'
import {
  updatePlaylistAction,
  deletePlaylistAction,
  addSongToPlaylistAction,
  removeSongFromPlaylistAction,
  getPlaylistWithSongsAction,
  getPlaylistDetailsWithEntriesAction,
} from '../playlists'
import { createBand } from '@/lib/bands'
import { query } from '@/lib/db'

const admin = createAdminTestClient()

describe.skipIf(!SERVICE_ROLE_KEY)('playlist actions refuse non-owners (real database)', () => {
  const suffix = Date.now()

  let userAId: string
  let userBId: string
  let userCId: string
  let bandYId: string
  let bandZId: string
  let playlistId: string
  let bandPlaylistId: string
  let songOneId: string
  let songTwoId: string

  const playlistFields = async () => {
    const res = await query('SELECT name, description, tags FROM playlists WHERE id = $1', [playlistId])
    return res.rows[0] ?? null
  }

  const songCount = () =>
    countRows('SELECT count(*)::int AS count FROM playlist_songs WHERE playlist_id = $1', [playlistId])

  beforeAll(async () => {
    userAId = await createTestUser(admin, { email: `rh34-pl-a-${suffix}@example.com` })
    userBId = await createTestUser(admin, { email: `rh34-pl-b-${suffix}@example.com` })
    userCId = await createTestUser(admin, { email: `rh34-pl-c-${suffix}@example.com` })

    bandYId = await createBand(userAId, `RH-34 Playlist Band ${suffix}`, null, null)
    await query("INSERT INTO band_members (band_id, user_id, role) VALUES ($1, $2, 'member')", [
      bandYId,
      userBId,
    ])
    bandZId = await createBand(userCId, `RH-34 Foreign Band ${suffix}`, null, null)

    songOneId = await createTestSong(`RH-34 Playlist Song One ${suffix}`)
    songTwoId = await createTestSong(`RH-34 Playlist Song Two ${suffix}`)

    const personal = await query(
      'INSERT INTO playlists (user_id, name, description) VALUES ($1, $2, $3) RETURNING id',
      [userAId, `RH-34 Personal Playlist ${suffix}`, 'authz fixture'],
    )
    playlistId = personal.rows[0].id as string
    await query('INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES ($1, $2, 1)', [
      playlistId,
      songOneId,
    ])
    await query("INSERT INTO repertoire (user_id, song_id, status) VALUES ($1, $2, 'unknown')", [
      userAId,
      songOneId,
    ])

    const bandPlaylist = await query(
      'INSERT INTO playlists (band_id, name) VALUES ($1, $2) RETURNING id',
      [bandYId, `RH-34 Band Playlist ${suffix}`],
    )
    bandPlaylistId = bandPlaylist.rows[0].id as string
  })

  afterAll(async () => {
    for (const band of [bandYId, bandZId]) {
      if (band) await query('DELETE FROM bands WHERE id = $1', [band])
    }
    for (const user of [userAId, userBId, userCId]) {
      if (user) await deleteTestUser(admin, user)
    }
    for (const song of [songOneId, songTwoId]) {
      if (song) await query('DELETE FROM global_songs WHERE id = $1', [song])
    }
  })

  describe('an unrelated caller changes nothing', () => {
    it.each([
      ['updatePlaylistAction', () => updatePlaylistAction(playlistId, { name: 'Hijacked', tags: ['x'] })],
      ['deletePlaylistAction', () => deletePlaylistAction(playlistId)],
      ['removeSongFromPlaylistAction', () => removeSongFromPlaylistAction(playlistId, songOneId)],
      ['addSongToPlaylistAction', () => addSongToPlaylistAction(playlistId, songTwoId)],
    ])('%s is refused', async (_label, run) => {
      const fieldsBefore = await playlistFields()
      const countBefore = await songCount()
      asUser(userCId)

      await expect(run()).rejects.toThrow('Access denied')

      expect(await playlistFields()).toEqual(fieldsBefore)
      expect(await songCount()).toBe(countBefore)
    })

    it('getPlaylistWithSongsAction resolves null instead of the contents', async () => {
      asUser(userCId)

      await expect(getPlaylistWithSongsAction(playlistId)).resolves.toBeNull()
    })

    it('getPlaylistDetailsWithEntriesAction is refused', async () => {
      asUser(userCId)

      await expect(getPlaylistDetailsWithEntriesAction(playlistId, null)).rejects.toThrow('Access denied')
    })
  })

  it('refuses a band owner context the caller does not belong to', async () => {
    asUser(userAId)

    await expect(getPlaylistDetailsWithEntriesAction(playlistId, bandZId)).rejects.toThrow('Access denied')
  })

  describe('the authorized paths still work', () => {
    it('the owner reads the playlist and its entries', async () => {
      asUser(userAId)

      const playlist = await getPlaylistWithSongsAction(playlistId)
      expect(playlist).not.toBeNull()
      expect(playlist!.id).toBe(playlistId)
      expect(playlist!.songs!.map((s) => s.song_id)).toEqual([songOneId])

      const details = await getPlaylistDetailsWithEntriesAction(playlistId, null)
      expect(details.name).toBe(`RH-34 Personal Playlist ${suffix}`)
      expect(details.entries.map((e) => e.songId)).toEqual([songOneId])
    })

    it('the owner renames and re-tags the playlist', async () => {
      asUser(userAId)

      await updatePlaylistAction(playlistId, { name: `RH-34 Renamed ${suffix}`, tags: ['setlist-2026'] })

      const fields = await playlistFields()
      expect(fields.name).toBe(`RH-34 Renamed ${suffix}`)
      expect(fields.tags).toEqual(['setlist-2026'])
    })

    it('the owner adds and removes a song', async () => {
      asUser(userAId)

      await addSongToPlaylistAction(playlistId, songTwoId)
      expect(await songCount()).toBe(2)

      await removeSongFromPlaylistAction(playlistId, songTwoId)
      expect(await songCount()).toBe(1)
    })

    it('a band member updates the band-owned playlist', async () => {
      asUser(userBId)

      await updatePlaylistAction(bandPlaylistId, { name: `RH-34 Band Renamed ${suffix}` })

      const res = await query('SELECT name FROM playlists WHERE id = $1', [bandPlaylistId])
      expect(res.rows[0].name).toBe(`RH-34 Band Renamed ${suffix}`)
    })

    it('the owner deletes the playlist', async () => {
      asUser(userAId)

      await deletePlaylistAction(playlistId)

      expect(await playlistFields()).toBeNull()
    })
  })
})
