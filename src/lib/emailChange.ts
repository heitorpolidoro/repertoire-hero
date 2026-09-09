import { auth } from '@/lib/auth'
import { logger } from '@/lib/logger'

/**
 * RH-42 — requesting a verified change of the login identity.
 *
 * `"user".email` is what the account signs in with, so it may only move once
 * the new address has proven it is reachable. This module validates the
 * submitted string and hands it to Better Auth's `/change-email` endpoint,
 * which mails a link and leaves both identity rows untouched until that link is
 * opened at `/api/auth/verify-email`.
 *
 * There is deliberately no uniqueness pre-check. A distinct "that address is
 * already registered" answer is an account-enumeration oracle on an endpoint any
 * signed-in user can call; Better Auth answers the taken case with a silent
 * success and sends nothing (`update-user.mjs` L431-435), and uniqueness itself
 * is enforced by the `UNIQUE` constraint on `"user".email`.
 */

/** Where `/api/auth/verify-email` sends the browser once the link is opened. */
export const EMAIL_CHANGE_CALLBACK = '/profile'

/**
 * Addresses are compared and stored lowercased: Better Auth lowercases
 * `newEmail` itself before its own same-address check, so normalizing here is
 * what makes our message and its behaviour agree.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/** No dots-and-quotes RFC parsing — just enough to reject what a user mistypes. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Returns the normalized address, or throws the message the banner should show.
 *
 * These throws are deliberately outside any wrapping `try` (AGENTS.md L1a) so
 * their text survives verbatim to the UI instead of arriving prefixed.
 */
export function validateEmailChange(currentEmail: string, raw: string): string {
  const newEmail = normalizeEmail(raw)
  if (!newEmail) throw new Error('Enter an email address')
  if (!EMAIL_SHAPE.test(newEmail)) throw new Error('Enter a valid email address')
  if (newEmail === normalizeEmail(currentEmail)) {
    throw new Error('That is already your email address')
  }
  return newEmail
}

/**
 * Asks Better Auth to start a verified email change for the session carried by
 * `requestHeaders`.
 *
 * The headers are a parameter rather than a `next/headers` call inside this
 * module for two reasons: `src/lib` must not reach into the App Router runtime,
 * and taking them explicitly is what lets the database test drive the real flow
 * with a real session cookie and no module mocking.
 */
export async function requestEmailChange(requestHeaders: Headers, raw: string): Promise<void> {
  // Defence in depth behind the action's own `getRequiredUserId()`: this module
  // resolves the identity it validates against rather than trusting a caller.
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (!session) throw new Error('Not authenticated')

  const newEmail = validateEmailChange(session.user.email, raw)

  try {
    await auth.api.changeEmail({
      body: { newEmail, callbackURL: EMAIL_CHANGE_CALLBACK },
      headers: requestHeaders,
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to request email change', err)
    throw new Error(`Failed to request email change: ${err.message}`)
  }
}
