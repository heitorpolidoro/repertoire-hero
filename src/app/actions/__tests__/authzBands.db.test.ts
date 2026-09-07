/**
 * RH-34 — cross-tenant band authorization, against the real database.
 *
 * Only `@/lib/auth-session` (and `next/cache`) are mocked: every query runs
 * against the live local Postgres, so a refusal here is a refusal in
 * production. Each unauthorized case asserts both that the call was refused
 * *and* that the target rows were left byte-identical, read back with a direct
 * `query()` — a throw that still wrote would pass the first check alone.
 *
 * Fixture: user A is the admin/creator of band X, user B is a plain member,
 * user C is not a member at all.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))

import {
  getBandWithMembersAction,
  getBandPlaylistsAction,
  updateBandAction,
  deleteBandAction,
  removeBandMemberAction,
  createBandPlaylistAction,
} from '../bands'
import { asUser, countRows, SERVICE_ROLE_KEY } from './authzFixtures'
import { query } from '@/lib/db'
import { createBand } from '@/lib/bands'
import { createAdminTestClient, createTestUser, deleteTestUser } from '@/lib/__tests__/test-helpers'

const admin = createAdminTestClient()

describe.skipIf(!SERVICE_ROLE_KEY)('band actions refuse non-admins and non-members (real database)', () => {
  const suffix = Date.now()

  let userAId: string
  let userBId: string
  let userCId: string
  let bandId: string
  let memberBRowId: string

  const bandFields = async () => {
    const res = await query('SELECT name, description, color FROM bands WHERE id = $1', [bandId])
    return res.rows[0] ?? null
  }

  const bandCount = () => countRows('SELECT count(*)::int AS count FROM bands WHERE id = $1', [bandId])
  const memberRowCount = () =>
    countRows('SELECT count(*)::int AS count FROM band_members WHERE id = $1', [memberBRowId])
  const bandPlaylistCount = () =>
    countRows('SELECT count(*)::int AS count FROM playlists WHERE band_id = $1', [bandId])

  beforeAll(async () => {
    userAId = await createTestUser(admin, { email: `rh34-bands-a-${suffix}@example.com` })
    userBId = await createTestUser(admin, { email: `rh34-bands-b-${suffix}@example.com` })
    userCId = await createTestUser(admin, { email: `rh34-bands-c-${suffix}@example.com` })

    bandId = await createBand(userAId, `RH-34 Band ${suffix}`, 'authz fixture', null, '#1d4ed8')

    const membership = await query(
      "INSERT INTO band_members (band_id, user_id, role) VALUES ($1, $2, 'member') RETURNING id",
      [bandId, userBId],
    )
    memberBRowId = membership.rows[0].id as string

    await query('INSERT INTO playlists (band_id, name) VALUES ($1, $2)', [
      bandId,
      `RH-34 Fixture Setlist ${suffix}`,
    ])
  })

  afterAll(async () => {
    if (bandId) await query('DELETE FROM bands WHERE id = $1', [bandId])
    if (userAId) await deleteTestUser(admin, userAId)
    if (userBId) await deleteTestUser(admin, userBId)
    if (userCId) await deleteTestUser(admin, userCId)
  })

  describe('mutations fail closed and change nothing', () => {
    it.each([
      ['a plain member', () => userBId],
      ['a non-member', () => userCId],
    ])('updateBandAction called as %s is refused', async (_label, caller) => {
      const before = await bandFields()
      asUser(caller())

      await expect(updateBandAction(bandId, { name: 'Hijacked', color: '#000000' })).rejects.toThrow(
        'Access denied',
      )

      expect(await bandFields()).toEqual(before)
    })

    it.each([
      ['a plain member', () => userBId],
      ['a non-member', () => userCId],
    ])('deleteBandAction called as %s is refused', async (_label, caller) => {
      asUser(caller())

      await expect(deleteBandAction(bandId)).rejects.toThrow('Access denied')

      expect(await bandCount()).toBe(1)
    })

    it.each([
      ['a plain member', () => userBId],
      ['a non-member', () => userCId],
    ])('removeBandMemberAction called as %s is refused', async (_label, caller) => {
      asUser(caller())

      await expect(removeBandMemberAction(memberBRowId)).rejects.toThrow('Access denied')

      expect(await memberRowCount()).toBe(1)
    })

    it('createBandPlaylistAction called as a non-member is refused', async () => {
      const before = await bandPlaylistCount()
      asUser(userCId)

      await expect(createBandPlaylistAction(bandId, 'Intruder Setlist')).rejects.toThrow('Access denied')

      expect(await bandPlaylistCount()).toBe(before)
    })
  })

  describe('reads return the not-found value rather than leaking', () => {
    it('getBandWithMembersAction resolves null for a non-member', async () => {
      asUser(userCId)

      await expect(getBandWithMembersAction(bandId)).resolves.toBeNull()
    })

    it('getBandPlaylistsAction resolves [] for a non-member', async () => {
      asUser(userCId)

      await expect(getBandPlaylistsAction(bandId)).resolves.toEqual([])
    })
  })

  describe('the authorized paths still work', () => {
    it('a member reads the band with its members and its playlists', async () => {
      asUser(userBId)

      const band = await getBandWithMembersAction(bandId)
      expect(band).not.toBeNull()
      expect(band!.id).toBe(bandId)
      expect((band!.members ?? []).map((m) => m.user_id).sort()).toEqual([userAId, userBId].sort())

      const playlists = await getBandPlaylistsAction(bandId)
      expect(playlists.length).toBeGreaterThanOrEqual(1)
    })

    it('the admin renames the band', async () => {
      asUser(userAId)

      await updateBandAction(bandId, { name: `RH-34 Renamed ${suffix}` })

      expect((await bandFields()).name).toBe(`RH-34 Renamed ${suffix}`)
    })

    it('the admin adds a band playlist', async () => {
      const before = await bandPlaylistCount()
      asUser(userAId)

      const playlistId = await createBandPlaylistAction(bandId, `RH-34 Encore ${suffix}`)

      expect(playlistId).toBeDefined()
      expect(await bandPlaylistCount()).toBe(before + 1)
    })

    it('the admin removes the member', async () => {
      asUser(userAId)

      await removeBandMemberAction(memberBRowId)

      expect(await memberRowCount()).toBe(0)
    })

    it('the admin deletes the band', async () => {
      asUser(userAId)

      await deleteBandAction(bandId)

      expect(await bandCount()).toBe(0)
    })
  })
})
