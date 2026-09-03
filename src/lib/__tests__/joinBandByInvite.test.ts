/**
 * Real-database integration test for the Postgres function `join_band_by_invite`
 * (migration 0004_join_band_by_invite_already_member.sql).
 *
 * This file deliberately does NOT mock `@/lib/db`: it runs the actual SQL
 * function against a live local Postgres through the app's own data-access
 * functions, locking in the `already_member` re-join semantics that the mocked
 * unit tests in `bands.server.test.ts` can only assert at the mapping layer.
 *
 * The suite is self-contained: it creates its own users and band in `beforeAll`
 * and deletes everything it created in `afterAll`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminTestClient, createTestUser, deleteTestUser } from './test-helpers'
import {
  createBand,
  deleteBand,
  getBandMembers,
  getBandWithMembers,
  joinBandByInviteClient,
} from '../bands'
import { joinBandByInviteServer } from '../bands.server'
import { query } from '@/lib/db'

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const skip = !SERVICE_ROLE_KEY

const admin = createAdminTestClient()

describe.skipIf(skip)('join_band_by_invite already_member semantics (real database)', () => {
  // Unique suffix so parallel/repeated runs don't collide
  const suffix = Date.now()
  const USER_A = { email: `test-rh18-a-${suffix}@example.com` }
  const USER_B = { email: `test-rh18-b-${suffix}@example.com` }
  const BAND_NAME = `RH-18 Invite Band ${suffix}`

  let userAId: string
  let userBId: string
  let bandId: string
  let inviteCode: string

  /** Number of band_members rows for one (band_id, user_id) pair. */
  const membershipCount = async (band: string, user: string): Promise<number> => {
    const res = await query<{ count: number }>(
      'SELECT count(*)::int AS count FROM band_members WHERE band_id = $1 AND user_id = $2',
      [band, user],
    )
    return res.rows[0].count
  }

  /** The role stored for one (band_id, user_id) pair, or null when absent. */
  const membershipRole = async (band: string, user: string): Promise<string | null> => {
    const res = await query<{ role: string }>(
      'SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2',
      [band, user],
    )
    return res.rowCount === 0 ? null : res.rows[0].role
  }

  beforeAll(async () => {
    userAId = await createTestUser(admin, { email: USER_A.email })
    userBId = await createTestUser(admin, { email: USER_B.email })

    bandId = await createBand(userAId, BAND_NAME, 'RH-18 invite semantics fixture', null)

    const band = await getBandWithMembers(bandId)
    expect(band).not.toBeNull()
    inviteCode = band!.invite_code
  })

  afterAll(async () => {
    // Delete the band first: `deleteTestUser` cascades user -> profiles -> band_members,
    // but the `bands` table has no owner FK, so it must be removed explicitly.
    if (bandId) await deleteBand(bandId)
    if (userAId) await deleteTestUser(admin, userAId)
    if (userBId) await deleteTestUser(admin, userBId)
  })

  it('reports already_member = false on a fresh join and inserts exactly one row', async () => {
    expect(await membershipCount(bandId, userBId)).toBe(0)

    const result = await joinBandByInviteServer(userBId, inviteCode)

    expect(result).not.toBeNull()
    expect(result!.bandId).toBe(bandId)
    expect(result!.alreadyMember).toBe(false)
    expect(await membershipCount(bandId, userBId)).toBe(1)
  })

  it('reports already_member = true on a re-join without leaving and keeps a single row', async () => {
    const result = await joinBandByInviteServer(userBId, inviteCode)

    expect(result).not.toBeNull()
    expect(result!.bandId).toBe(bandId)
    expect(result!.alreadyMember).toBe(true)
    expect(await membershipCount(bandId, userBId)).toBe(1)
    expect(await membershipRole(bandId, userBId)).toBe('member')

    const band = await getBandWithMembers(bandId)
    expect(band).not.toBeNull()
    const members = getBandMembers(band!)
    expect(members.length).toBe(2)
    expect(members.filter((m) => m.user_id === userBId).length).toBe(1)
  })

  it('joinBandByInviteClient is idempotent: two calls return the same band id and one row', async () => {
    const first = await joinBandByInviteClient(userBId, inviteCode)
    const second = await joinBandByInviteClient(userBId, inviteCode)

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first).toBe(bandId)
    expect(second).toBe(bandId)
    expect(await membershipCount(bandId, userBId)).toBe(1)
  })

  it('returns null for an invite code that resolves to no band, for both callers', async () => {
    const unknownCode = `nope${suffix}`

    const serverResult = await joinBandByInviteServer(userBId, unknownCode)
    const clientResult = await joinBandByInviteClient(userBId, unknownCode)

    expect(serverResult).toBeNull()
    expect(clientResult).toBeNull()
    // No stray membership was created by the unresolved code.
    expect(await membershipCount(bandId, userBId)).toBe(1)
  })

  it('keeps the creator role as admin when the creator re-accepts their own invite', async () => {
    expect(await membershipRole(bandId, userAId)).toBe('admin')

    const result = await joinBandByInviteServer(userAId, inviteCode)

    expect(result).not.toBeNull()
    expect(result!.bandId).toBe(bandId)
    expect(result!.alreadyMember).toBe(true)
    expect(await membershipCount(bandId, userAId)).toBe(1)
    expect(await membershipRole(bandId, userAId)).toBe('admin')
  })
})
