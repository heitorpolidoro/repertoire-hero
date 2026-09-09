import { betterAuth } from 'better-auth'
import { pool } from '@/lib/db'
import { logger } from '@/lib/logger'
import { sendAuthEmail, type AuthEmail } from '@/lib/authEmail'
import bcrypt from 'bcryptjs'
import { hashPassword, verifyPassword } from '@better-auth/utils/password'
import { randomUUID } from 'crypto'

const IGNORE_FOOTNOTE = "If you didn't request this, you can safely ignore this email."

/**
 * Sends an auth mail and never rejects.
 *
 * Better Auth awaits these three callbacks (`runInBackgroundOrAwait` awaits
 * whenever `advanced.backgroundTasks.handler` is unset,
 * `context/create-context.mjs:211-224`), so a rejection here would surface as a
 * 500 on `/forget-password` and, on `/change-email`, as an observable difference
 * between a taken and a free address - the enumeration oracle RH-42 is careful
 * not to build. Swallowing through `logger` is what `sendResetPassword` already
 * did at 890a27b.
 */
async function mailOrLog(email: AuthEmail): Promise<void> {
  try {
    await sendAuthEmail(email)
  } catch (error) {
    logger.error(
      'Failed to send auth email',
      error instanceof Error ? error : new Error(String(error)),
    )
  }
}

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  advanced: {
    // Generate proper UUIDs — the DB schema uses uuid columns.
    // Must be a function, so Better Auth generates the ID in JS and inserts it,
    // rather than delegating to the DB (which fails for text-based ids on session/account).
    database: {
      generateId: () => randomUUID(),
    },
  },
  trustedOrigins: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    ...(process.env.NEXT_PUBLIC_APP_URL ? [process.env.NEXT_PUBLIC_APP_URL] : []),
  ],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    sendResetPassword: ({ user, url }) =>
      mailOrLog({
        to: user.email,
        subject: 'Reset your Repertoire Hero password',
        greeting: `Hello, ${user.name || 'User'}!`,
        body: 'We received a request to reset your password. Click the button below to choose a new one:',
        ctaLabel: 'Reset Password',
        url,
        footnote: IGNORE_FOOTNOTE,
      }),
    password: {
      // New accounts use scrypt (Better Auth default).
      hash: hashPassword,
      // Verify supports both scrypt (new) and bcrypt (migrated GoTrue users).
      verify: async ({ hash, password }) => {
        if (hash.startsWith('$2a$') || hash.startsWith('$2b$')) {
          return bcrypt.compare(password, hash)
        }
        return verifyPassword(hash, password)
      },
    },
  },
  // RH-42 — the login identity moves only after the new address proves it is
  // reachable. Both callbacks are configured because 1.6.22 picks the branch
  // from `session.user.emailVerified`: an unverified current address (every
  // account today) goes straight to the new-address verification
  // (`update-user.mjs` L482), while a verified one first gets a confirmation at
  // the CURRENT address (L468) whose link then triggers the new-address
  // verification (`email-verification.mjs` L191-205). That second branch is the
  // hijack alarm, and it becomes reachable for everyone the first time a change
  // completes, since `/verify-email` sets `emailVerified: true`.
  user: {
    changeEmail: {
      enabled: true,
      // Explicitly false. `update-user.mjs` L424/L439-460 write the row with no
      // round trip when this is true and the current address is unverified -
      // which is every account here (`requireEmailVerification: false` and
      // nothing mails at sign-up), so leaving the default in place by omission
      // would let the unverified rewrite RH-42 removes back in.
      updateEmailWithoutVerification: false,
      sendChangeEmailConfirmation: ({ user, newEmail, url }) =>
        mailOrLog({
          // The CURRENT address: this mail tells the address that is about to
          // lose the account that a change was requested.
          to: user.email,
          subject: 'Confirm the email change on your Repertoire Hero account',
          greeting: `Hello, ${user.name || 'User'}!`,
          body: `We received a request to move your sign-in address to ${newEmail}. Confirm it below; we will then email that address to finish the change.`,
          ctaLabel: 'Confirm email change',
          url,
          footnote: IGNORE_FOOTNOTE,
        }),
    },
  },
  emailVerification: {
    // On the change-email path Better Auth calls this with the NEW address
    // (`update-user.mjs` L482), which is the only thing that proves control of
    // it. `sendOnSignUp` stays unset, so sign-up mails nothing
    // (`sign-up.mjs:241`).
    sendVerificationEmail: ({ user, url }) =>
      mailOrLog({
        to: user.email,
        subject: 'Verify your Repertoire Hero email address',
        greeting: `Hello, ${user.name || 'User'}!`,
        body: 'Click the button below to verify this address. Your sign-in address changes only once you do.',
        ctaLabel: 'Verify email',
        url,
        footnote: IGNORE_FOOTNOTE,
      }),
    // One hour. This is also the package default; pinning it keeps the life of
    // a link that moves the login identity out of the package's hands.
    expiresIn: 3600,
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Auto-create a profiles row whenever a Better Auth user is created.
          // profiles.id must equal user.id so foreign-key joins work throughout the app.
          await pool.query(
            `INSERT INTO profiles (id, email, full_name)
             VALUES ($1::uuid, $2, $3)
             ON CONFLICT (id) DO NOTHING`,
            [user.id, user.email, user.name ?? null]
          )
        },
      },
    },
  },
})
