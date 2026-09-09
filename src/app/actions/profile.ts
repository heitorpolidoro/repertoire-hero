'use server'

import { headers } from 'next/headers'
import { getRequiredUserId } from '@/lib/auth-session'
import { getProfile, updateProfile } from '@/lib/profile'
import { requestEmailChange } from '@/lib/emailChange'
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

/**
 * Starts a verified email change (RH-42). Nothing is written here: Better Auth
 * mails a link and the login identity moves only when it is opened.
 *
 * The session is resolved here, as in every action in this file, so the call
 * fails closed. The request headers are forwarded on top of that because
 * `requestEmailChange` resolves the session itself and validates the submitted
 * address against the one it finds there rather than against a parameter.
 */
export async function requestEmailChangeAction(newEmail: string): Promise<void> {
  await getRequiredUserId()
  return requestEmailChange(await headers(), newEmail)
}
