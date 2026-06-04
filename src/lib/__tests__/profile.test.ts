import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient as createOriginalClient } from '@supabase/supabase-js'
import { vi } from 'vitest'
import { getProfile, updateProfile } from '../profile'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

const skip = !SERVICE_ROLE_KEY || !ANON_KEY

const testClient = createOriginalClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => testClient
}))

describe.skipIf(skip)('profile integration tests', () => {
  const admin = createOriginalClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const suffix = Date.now()
  const USER = { email: `test-profile-${suffix}@example.com`, password: 'password123' }
  let userId: string

  beforeAll(async () => {
    // Create temporary test user
    const { data: { user }, error } = await admin.auth.admin.createUser({
      email: USER.email,
      password: USER.password,
      email_confirm: true,
      user_metadata: { full_name: 'Original Test Name' }
    })
    expect(error).toBeNull()
    userId = user!.id

    // Sign in as the test user on our mocked shared client
    const { error: signInError } = await testClient.auth.signInWithPassword(USER)
    expect(signInError).toBeNull()
  })

  afterAll(async () => {
    await testClient.auth.signOut()
    if (userId) {
      await admin.auth.admin.deleteUser(userId)
    }
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
      instruments: ['Guitar', 'Bass']
    })

    const profile = await getProfile(userId)
    expect(profile).not.toBeNull()
    expect(profile!.full_name).toBe('Updated Test Name')
    expect(profile!.primary_instrument).toBe('Guitar')
    expect(profile!.instruments).toEqual(['Guitar', 'Bass'])
  })


})
