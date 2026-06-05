import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createAdminTestClient, createTestUser, deleteTestUser } from './test-helpers'
import { getProfile, updateProfile } from '../profile'

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const skip = !SERVICE_ROLE_KEY

const adminTestClient = createAdminTestClient()

// profile.ts calls createAdminClient() internally — replace with service role client
// so queries bypass RLS without needing a GoTrue session.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => adminTestClient,
}))

describe.skipIf(skip)('profile integration tests', () => {
  const suffix = Date.now()
  const USER = { email: `test-profile-${suffix}@example.com` }
  let userId: string

  beforeAll(async () => {
    userId = await createTestUser(adminTestClient, {
      email: USER.email,
      name: 'Original Test Name',
    })
  })

  afterAll(async () => {
    if (userId) await deleteTestUser(adminTestClient, userId)
  })

  it('getProfile retrieves the current user profile', async () => {
    const profile = await getProfile(userId)
    expect(profile).not.toBeNull()
    expect(profile!.id).toBe(userId)
    expect(profile!.email).toBe(USER.email)
    expect(profile!.full_name).toBe('Original Test Name')
  })

  it('updateProfile updates the profile data', async () => {
    await updateProfile(userId, {
      full_name: 'Updated Test Name',
      primary_instrument: 'Guitar',
      instruments: ['Guitar', 'Bass'],
    })

    const profile = await getProfile(userId)
    expect(profile).not.toBeNull()
    expect(profile!.full_name).toBe('Updated Test Name')
    expect(profile!.primary_instrument).toBe('Guitar')
    expect(profile!.instruments).toEqual(['Guitar', 'Bass'])
  })
})
