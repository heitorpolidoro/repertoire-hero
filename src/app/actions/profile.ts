'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import { getProfile, updateProfile, updateEmail } from '@/lib/profile'
import type { Profile } from '@/types/database'

export async function getProfileAction(): Promise<Profile | null> {
  const userId = await getRequiredUserId()
  return getProfile(userId)
}

export async function updateProfileAction(data: {
  full_name?: string | null
  avatar_url?: string | null
  instruments?: string[]
  primary_instrument?: string | null
}): Promise<void> {
  const userId = await getRequiredUserId()
  return updateProfile(userId, data)
}

export async function updateEmailAction(newEmail: string): Promise<void> {
  const userId = await getRequiredUserId()
  return updateEmail(userId, newEmail)
}
