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

describe.skipIf(skip)('profile branches not reached by the happy path', () => {
  const suffix = `${Date.now()}-branches`
  const EMAIL = `test-profile-${suffix}@example.com`
  let userId: string

  beforeAll(async () => {
    userId = await createTestUser(adminTestClient, { email: EMAIL, name: 'Branch User' })
  })

  afterAll(async () => {
    if (userId) await deleteTestUser(adminTestClient, userId)
  })

  it('getProfile returns null for an id with no profile row', async () => {
    await expect(getProfile('00000000-0000-0000-0000-000000000000')).resolves.toBeNull()
  })

  it('getProfile wraps a driver failure in the L1 prefixed message', async () => {
    await expect(getProfile('not-a-uuid')).rejects.toThrow(/^Failed to fetch profile: /)
  })

  it('updateProfile writes avatar_url on its own', async () => {
    await updateProfile(userId, { avatar_url: 'https://cdn.example/me.png' })

    const profile = await getProfile(userId)
    expect(profile!.avatar_url).toBe('https://cdn.example/me.png')
    expect(profile!.full_name).toBe('Branch User')
  })

  it('updateProfile clears a nullable field when passed null', async () => {
    await updateProfile(userId, { avatar_url: null, primary_instrument: null })

    const profile = await getProfile(userId)
    expect(profile!.avatar_url).toBeNull()
    expect(profile!.primary_instrument).toBeNull()
  })

  it('updateProfile is a no-op when the patch carries no known field', async () => {
    await expect(updateProfile(userId, {})).resolves.toBeUndefined()
  })

  it('updateProfile reports a missing profile through the L1 prefixed message', async () => {
    await expect(
      updateProfile('00000000-0000-0000-0000-000000000000', { full_name: 'Ghost' }),
    ).rejects.toThrow('Failed to update profile: Profile not found')
  })
})
