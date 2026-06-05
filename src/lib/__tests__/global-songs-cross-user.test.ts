/**
 * Integration test: cross-user visibility of global_songs
 *
 * Verifies that a song contributed by User A appears in search results
 * when User B performs a query — i.e., the RLS SELECT policy USING(true)
 * works as intended across different authenticated sessions.
 *
 * Requires a running local Supabase and SUPABASE_SERVICE_ROLE_KEY set in
 * the environment. Skipped automatically when those aren't available.
 *
 * The test is fully self-contained: it creates temporary users in beforeAll
 * and deletes them in afterAll — no pre-seeded data needed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createAdminTestClient, createTestUserWithGoTrue, deleteTestUserWithGoTrue } from './test-helpers'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

const skip = !SERVICE_ROLE_KEY || !ANON_KEY

describe.skipIf(skip)('global_songs cross-user visibility', () => {
  const admin = createAdminTestClient()

  // Unique suffix so parallel runs don't collide
  const suffix = Date.now()
  const USER_A = { email: `test-a-${suffix}@example.com`, password: 'password' }
  const USER_B = { email: `test-b-${suffix}@example.com`, password: 'password' }

  const TEST_SONG = {
    title: `__test_cross_user_${suffix}`,
    artist: 'Test Artist Cross User',
    links: [] as { label: string; url: string }[],
  }

  let userAId: string
  let userBId: string
  let insertedSongId: string

  beforeAll(async () => {
    // Create in GoTrue (for signInWithPassword) + Better Auth tables (for FK constraints)
    ;({ userId: userAId } = await createTestUserWithGoTrue(admin, { email: USER_A.email, password: USER_A.password }))
    ;({ userId: userBId } = await createTestUserWithGoTrue(admin, { email: USER_B.email, password: USER_B.password }))

    // Insert a test song attributed to User A (bypass RLS via service role)
    const { data, error: insertError } = await admin
      .from('global_songs')
      .insert({ ...TEST_SONG, contributor_id: userAId })
      .select('id')
      .single()

    expect(insertError).toBeNull()
    insertedSongId = data!.id
  })

  afterAll(async () => {
    if (insertedSongId) {
      await admin.from('global_songs').delete().eq('id', insertedSongId)
    }
    if (userAId) await deleteTestUserWithGoTrue(admin, userAId)
    if (userBId) await deleteTestUserWithGoTrue(admin, userBId)
  })

  it('User B can find a song contributed by User A', async () => {
    const clientB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: signInError } = await clientB.auth.signInWithPassword(USER_B)
    expect(signInError).toBeNull()

    const { data, error } = await clientB
      .from('global_songs')
      .select('*')
      .ilike('title', `%${TEST_SONG.title}%`)
      .limit(5)

    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(data!.length).toBeGreaterThanOrEqual(1)
    expect(data![0].contributor_id).toBe(userAId)

    await clientB.auth.signOut()
  })

  it('Unauthenticated client cannot read global_songs', async () => {
    const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data, error } = await anonClient
      .from('global_songs')
      .select('id')
      .eq('id', insertedSongId)

    // RLS blocks unauthenticated reads — expect empty result or error
    const blocked = error !== null || (data !== null && data.length === 0)
    expect(blocked).toBe(true)
  })
})
