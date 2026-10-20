/**
 * RH-119 — `recordPracticeAction` with present ids: admin-only, band members
 * only, and a refusal writes nothing (real database, only the session mocked).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { asUser, RUN_DB_TESTS } from './authzFixtures'
import { createTestUser, deleteTestUser } from '@/lib/__tests__/test-helpers'
import { createBand } from '@/lib/bands'
import { query } from '@/lib/db'
import { recordPracticeAction } from '../repertoire'

describe.skipIf(!RUN_DB_TESTS)('RH-119: presence through the action (real database)', () => {
  const suffix = Date.now()
  let adminId: string
  let memberId: string
  let otherMemberId: string
  let outsiderId: string
  let bandId: string
  let songId: string
  let versionId: string

  const lastPracticed = async (userId: string) =>
    (
      await query<{ lp: Date | null }>('SELECT last_practiced AS lp FROM user_songs WHERE user_id = $1 AND version_id = $2', [
        userId,
        versionId,
      ])
    ).rows[0]

  beforeAll(async () => {
    adminId = await createTestUser({ email: `rh119-admin-${suffix}@example.com` })
    memberId = await createTestUser({ email: `rh119-member-${suffix}@example.com` })
    otherMemberId = await createTestUser({ email: `rh119-other-${suffix}@example.com` })
    outsiderId = await createTestUser({ email: `rh119-out-${suffix}@example.com` })
    bandId = await createBand(adminId, `RH-119 Band ${suffix}`, null, null)
    for (const u of [memberId, otherMemberId])
      await query("INSERT INTO band_members (band_id, user_id, role) VALUES ($1, $2, 'member')", [bandId, u])
    songId = (
      await query<{ id: string }>('INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id', [
        `RH-119 Action ${suffix}`,
        `RH-119 Artist ${suffix}`,
      ])
    ).rows[0].id
    versionId = (
      await query<{ id: string }>("INSERT INTO song_versions (song_id, label) VALUES ($1, 'v1') RETURNING id", [songId])
    ).rows[0].id
    await query("INSERT INTO user_songs (user_id, version_id, status) VALUES ($1, $2, 'learning')", [
      otherMemberId,
      versionId,
    ])
  })

  afterAll(async () => {
    if (bandId) await query('DELETE FROM bands WHERE id = $1', [bandId])
    for (const u of [adminId, memberId, otherMemberId, outsiderId]) if (u) await deleteTestUser(u)
    if (songId) await query('DELETE FROM songs WHERE id = $1', [songId])
  })

  it('credits a present member when the admin names them', async () => {
    asUser(adminId)
    await recordPracticeAction([{ versionId }], bandId, [memberId])
    expect((await lastPracticed(memberId)).lp).not.toBeNull()
    expect((await lastPracticed(otherMemberId)).lp).toBeNull()
  })

  it('refuses present ids from a plain member and writes nothing', async () => {
    asUser(otherMemberId)
    await expect(recordPracticeAction([{ versionId }], bandId, [memberId])).rejects.toThrow(
      'Access denied: band admin required',
    )
    expect((await lastPracticed(otherMemberId)).lp).toBeNull()
  })

  it('refuses an id outside the band and writes nothing', async () => {
    await query('DELETE FROM user_songs WHERE user_id = $1 AND version_id = $2', [adminId, versionId])
    asUser(adminId)
    await expect(recordPracticeAction([{ versionId }], bandId, [outsiderId])).rejects.toThrow(
      'Access denied: present user is not a member of this band',
    )
    expect(await lastPracticed(adminId)).toBeUndefined()
    expect(await lastPracticed(outsiderId)).toBeUndefined()
  })

  it('refuses present ids without a band', async () => {
    asUser(adminId)
    await expect(recordPracticeAction([{ versionId }], null, [memberId])).rejects.toThrow('band')
  })

  it('an empty present list is today’s behaviour', async () => {
    asUser(otherMemberId)
    await expect(recordPracticeAction([{ versionId }], bandId, [])).resolves.toBeUndefined()
  })
})
