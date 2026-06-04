import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type { Profile } from '@/types/database'
import { Pool } from 'pg'

export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    logger.error('Failed to fetch profile', new Error(error.message), { code: error.code })
    throw new Error(`Failed to fetch profile: ${error.message}`)
  }

  return data as Profile
}

export async function updateProfile(
  userId: string,
  data: {
    full_name?: string | null
    avatar_url?: string | null
    instruments?: string[]
    primary_instrument?: string | null
  }
): Promise<void> {
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('profiles')
    .update(data)
    .eq('id', userId)

  if (error) {
    logger.error('Failed to update profile', new Error(error.message), { code: error.code })
    throw new Error(`Failed to update profile: ${error.message}`)
  }
}

// Email changes are applied directly to both the Better Auth "user" table
// and the app profiles table. Better Auth's own changeEmail route requires
// email verification; this server-side function bypasses that for admin use.
export async function updateEmail(userId: string, newEmail: string): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! })
  try {
    await pool.query('UPDATE "user" SET email = $1, "updatedAt" = now() WHERE id = $2::uuid', [newEmail, userId])
    await pool.query('UPDATE profiles SET email = $1 WHERE id = $2::uuid', [newEmail, userId])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Failed to update email', new Error(message))
    throw new Error(`Failed to update email: ${message}`)
  } finally {
    await pool.end()
  }
}
