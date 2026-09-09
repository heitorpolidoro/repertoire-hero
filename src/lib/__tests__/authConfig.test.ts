/**
 * RH-42 — the Better Auth configuration itself, read off `auth.options`.
 *
 * `auth.options` is the literal options object the instance was built from
 * (`node_modules/better-auth/dist/auth/base.mjs:36`), so the wiring that decides
 * whether the login identity can move without proof is assertable without a
 * request. `src/lib/auth.ts` is outside the coverage universe
 * (`vitest.config.ts:67`) because it is configuration rather than logic — which
 * is exactly why it needs a suite that reads the configuration.
 *
 * `@/lib/authEmail` is mocked, so nothing is ever sent from here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/authEmail', () => ({
  sendAuthEmail: vi.fn(),
  renderAuthEmail: vi.fn(() => '<html></html>'),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { auth } from '@/lib/auth'
import { sendAuthEmail, type AuthEmail } from '@/lib/authEmail'

/**
 * A complete Better Auth `user`, not a two-field literal: the callbacks are
 * typed against the full model, so a partial object would not compile.
 */
const USER = {
  id: 'user-1',
  name: 'Jane',
  email: 'reset-target@example.com',
  emailVerified: false,
  image: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

const RESET_URL = 'https://example.com/reset?token=abc'

const sentEmails = () => vi.mocked(sendAuthEmail).mock.calls.map((call) => call[0] as AuthEmail)

beforeEach(() => {
  vi.mocked(sendAuthEmail).mockReset()
  vi.mocked(sendAuthEmail).mockResolvedValue(undefined)
})

describe('the change-email flow is configured', () => {
  it('enables changeEmail', () => {
    expect(auth.options.user?.changeEmail?.enabled).toBe(true)
  })

  it('sets updateEmailWithoutVerification to false explicitly', () => {
    // Not merely absent. Every account this app creates is unverified, and
    // `update-user.mjs` L424/L439 write the row without any round trip exactly
    // when this flag is true and `emailVerified !== true` — i.e. a `true` here
    // restores the pre-RH-42 unverified rewrite through the front door.
    expect(auth.options.user?.changeEmail?.updateEmailWithoutVerification).toBe(false)
  })

  it('configures the confirmation mail to the current address', () => {
    expect(typeof auth.options.user?.changeEmail?.sendChangeEmailConfirmation).toBe('function')
  })

  it('configures the verification mail to the new address', () => {
    expect(typeof auth.options.emailVerification?.sendVerificationEmail).toBe('function')
  })

  it('pins the verification token lifetime at one hour explicitly', () => {
    // 3600 is also the package default; pinning it means a package-side change
    // of that default cannot silently lengthen the life of a link that moves
    // the login identity.
    expect(auth.options.emailVerification?.expiresIn).toBe(3600)
  })

  it('leaves sign-up mailing nothing', () => {
    // `sign-up.mjs:241` only sends when `sendOnSignUp ?? requireEmailVerification`
    // is truthy, so enabling `emailVerification` for the change flow must not
    // start mailing new accounts or lock the unverified ones out.
    expect(auth.options.emailAndPassword?.requireEmailVerification).toBe(false)
    expect(auth.options.emailVerification?.sendOnSignUp).toBeUndefined()
  })

  it('sends the change-email confirmation to the address that is losing the account', async () => {
    await auth.options.user!.changeEmail!.sendChangeEmailConfirmation!({
      user: USER,
      newEmail: 'moved@example.com',
      url: 'https://example.com/api/auth/verify-email?token=xyz',
      token: 'xyz',
    })

    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
    expect(sentEmails()[0].to).toBe(USER.email)
    expect(sentEmails()[0].url).toBe('https://example.com/api/auth/verify-email?token=xyz')
  })

  it('sends the verification mail to the address it is handed', async () => {
    await auth.options.emailVerification!.sendVerificationEmail!({
      user: { ...USER, email: 'moved@example.com' },
      url: 'https://example.com/api/auth/verify-email?token=zzz',
      token: 'zzz',
    })

    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
    expect(sentEmails()[0].to).toBe('moved@example.com')
    expect(sentEmails()[0].url).toBe('https://example.com/api/auth/verify-email?token=zzz')
  })
})

describe('password reset still sends the same mail after the extraction (ER4)', () => {
  it('hands the mail to the address it was given, with the same url and a password subject', async () => {
    await expect(
      auth.options.emailAndPassword!.sendResetPassword!({
        user: USER,
        url: RESET_URL,
        token: 'abc',
      }),
    ).resolves.toBeUndefined()

    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
    const mail = sentEmails()[0]
    expect(mail.to).toBe('reset-target@example.com')
    expect(mail.url).toBe(RESET_URL)
    expect(mail.subject).toMatch(/password/i)
  })

  it('cannot turn a mail failure into a request failure', async () => {
    vi.mocked(sendAuthEmail).mockRejectedValue(new Error('Resend is down'))

    await expect(
      auth.options.emailAndPassword!.sendResetPassword!({
        user: USER,
        url: RESET_URL,
        token: 'abc',
      }),
    ).resolves.toBeUndefined()
  })
})
