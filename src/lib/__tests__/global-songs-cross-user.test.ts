/**
 * Integration test: cross-user visibility of global_songs
 *
 * Verifies that a song contributed by User A appears in search results
 * when User B performs a query — i.e., the RLS SELECT policy USING(true)
 * works as intended across different authenticated sessions.
 *
 * Requires a running local Supabase (supabase start) and
 * SUPABASE_SERVICE_ROLE_KEY set in the environment.
 * Skipped automatically when those aren't available.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

// Seed users created by supabase/seed.sql
const USER_A = { email: 'com.spotify@exemple.com', password: 'password' }
const USER_B = { email: 'sem_spotify@exemple.com', password: 'password' }

const TEST_SONG = {
  title: `__test_cross_user_${Date.now()}`,
  artist: 'Test Artist Cross User',
  links: [] as { label: string; url: string }[],
}

const skip = !SERVICE_ROLE_KEY || !ANON_KEY

describe.skipIf(skip)('global_songs cross-user visibility', () => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let userAId: string
  let insertedSongId: string

  beforeAll(async () => {
    // Resolve User A's UUID via admin API
    const { data: { users }, error } = await admin.auth.admin.listUsers()
    expect(error).toBeNull()
    const userA = users.find((u) => u.email === USER_A.email)
    expect(userA).toBeDefined()
    userAId = userA!.id

    // Insert a test song as if User A contributed it (bypass RLS via service role)
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
  })

  it('User B can find a song contributed by User A', async () => {
    // Sign in as User B
    const clientB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: signInError } = await clientB.auth.signInWithPassword(USER_B)
    expect(signInError).toBeNull()

    // Search global_songs as User B
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
