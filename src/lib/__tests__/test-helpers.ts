/**
 * Shared test helpers for integration tests.
 *
 * Problem solved: tests previously created users via GoTrue (admin.auth.admin.createUser),
 * but the app now uses Better Auth whose tables ("user", profiles) are independent of
 * auth.users. Any FK that references profiles.id → "user".id would fail for GoTrue-only users.
 *
 * Solution: insert directly into Better Auth tables using the service role client.
 * All lib functions (songs, playlists, bands, profile) use createAdminClient() internally,
 * which bypasses RLS — so no GoTrue auth session is needed in tests.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

/** Service-role client that bypasses RLS — use as the mock for createAdminClient(). */
export function createAdminTestClient(): SupabaseClient {
  // Fallback to a placeholder so createClient() doesn't throw during module
  // loading when SERVICE_ROLE_KEY is absent. Tests are skipped anyway via
  // describe.skipIf(!SERVICE_ROLE_KEY).
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY || 'placeholder-key', {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * Creates a test user by inserting directly into Better Auth tables ("user" + profiles).
 * Returns the new user's UUID, which is valid for FK references anywhere in the schema.
 */
export async function createTestUser(
  admin: SupabaseClient,
  { email, name = 'Test User' }: { email: string; name?: string },
): Promise<string> {
  const userId = randomUUID()

  const { error: userError } = await admin
    .from('user')
    .insert({ id: userId, name, email, emailVerified: true })

  if (userError) throw new Error(`createTestUser "user" insert: ${userError.message}`)

  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id: userId, email, full_name: name })

  if (profileError) throw new Error(`createTestUser profiles insert: ${profileError.message}`)

  return userId
}

/**
 * Deletes a test user. CASCADE on profiles/repertoire/etc. handles all child rows.
 */
export async function deleteTestUser(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.from('user').delete().eq('id', userId)
  if (error) throw new Error(`deleteTestUser failed: ${error.message}`)
}

/**
 * Creates a test user in BOTH GoTrue (auth.users) and Better Auth tables ("user" + profiles).
 * Use this when the test needs a real GoTrue auth session (e.g. RLS or signInWithPassword tests).
 */
export async function createTestUserWithGoTrue(
  admin: SupabaseClient,
  { email, name = 'Test User', password = 'password123' }: { email: string; name?: string; password?: string },
): Promise<{ userId: string; password: string }> {
  const { data: { user }, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw new Error(`createTestUserWithGoTrue GoTrue: ${error.message}`)
  const userId = user!.id

  const { error: userError } = await admin
    .from('user')
    .insert({ id: userId, name, email, emailVerified: true })
  if (userError) throw new Error(`createTestUserWithGoTrue "user": ${userError.message}`)

  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id: userId, email, full_name: name })
  if (profileError) throw new Error(`createTestUserWithGoTrue profiles: ${profileError.message}`)

  return { userId, password }
}

/**
 * Deletes a test user from both GoTrue and Better Auth tables.
 * Both deletions are attempted even if one fails.
 */
export async function deleteTestUserWithGoTrue(admin: SupabaseClient, userId: string): Promise<void> {
  const { error: dbError } = await admin.from('user').delete().eq('id', userId)
  const { error: authError } = await admin.auth.admin.deleteUser(userId)
  if (dbError || authError) {
    throw new Error(
      `deleteTestUserWithGoTrue failed. DB: ${dbError?.message ?? 'ok'}, Auth: ${authError?.message ?? 'ok'}`
    )
  }
}
