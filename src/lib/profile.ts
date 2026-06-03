import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type { Profile } from '@/types/database'

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

// Email changes go through Better Auth and require email confirmation.
export async function updateEmail(userId: string, newEmail: string): Promise<void> {
  const supabase = createAdminClient()

  const { error } = await supabase.auth.admin.updateUserById(userId, { email: newEmail })

  if (error) {
    logger.error('Failed to update email', new Error(error.message))
    throw new Error(`Failed to update email: ${error.message}`)
  }
}
