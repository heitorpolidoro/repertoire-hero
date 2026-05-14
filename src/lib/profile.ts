import { createClient } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'
import type { Profile } from '@/types/database'

export async function getProfile(): Promise<Profile | null> {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    logger.error('Failed to fetch profile', new Error(error.message), { code: error.code })
    throw new Error(`Failed to fetch profile: ${error.message}`)
  }

  return data as Profile
}

export async function updateProfile(data: {
  full_name?: string | null
  avatar_url?: string | null
  instruments?: string[]
  primary_instrument?: string | null
}): Promise<void> {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('profiles')
    .update(data)
    .eq('id', user.id)

  if (error) {
    logger.error('Failed to update profile', new Error(error.message), { code: error.code })
    throw new Error(`Failed to update profile: ${error.message}`)
  }
}

// Email changes go through Supabase Auth and require email confirmation.
export async function updateEmail(newEmail: string): Promise<void> {
  const supabase = createClient()

  const { error } = await supabase.auth.updateUser({ email: newEmail })

  if (error) {
    logger.error('Failed to update email', new Error(error.message))
    throw new Error(`Failed to update email: ${error.message}`)
  }
}
