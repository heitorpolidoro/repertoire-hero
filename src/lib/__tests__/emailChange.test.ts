/**
 * RH-42 — validation and delegation for the verified email-change request.
 *
 * `@/lib/auth` is mocked: this suite is about the decisions this module makes
 * before and around Better Auth's `/change-email` endpoint, not about the
 * endpoint itself (which `emailChangeVerification.db.test.ts` drives for real).
 *
 * Note what is deliberately NOT asserted here: a "that address is taken"
 * message. Better Auth answers the taken case with a silent `{ status: true }`
 * and no mail (`update-user.mjs` L431-435) precisely so the endpoint is not an
 * account-enumeration oracle, and this module does not add a pre-check that
 * would re-introduce one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn(), changeEmail: vi.fn() } },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import {
  EMAIL_CHANGE_CALLBACK,
  normalizeEmail,
  validateEmailChange,
  requestEmailChange,
} from '../emailChange'
import { auth } from '@/lib/auth'
import { logger } from '@/lib/logger'

const CURRENT = 'jane@example.com'

const session = (email: string) => ({ user: { id: 'user-1', email }, session: { id: 'sess-1' } })

beforeEach(() => {
  vi.mocked(auth.api.getSession).mockReset()
  vi.mocked(auth.api.changeEmail).mockReset()
  vi.mocked(logger.error).mockClear()
  vi.mocked(auth.api.changeEmail).mockResolvedValue({ status: true } as never)
})

describe('normalizeEmail', () => {
  it('trims surrounding whitespace and lowercases the address', () => {
    expect(normalizeEmail('  Jane@Example.COM  ')).toBe(CURRENT)
  })
})

describe('validateEmailChange', () => {
  it('returns the trimmed, lowercased address', () => {
    expect(validateEmailChange(CURRENT, '  New@Example.COM  ')).toBe('new@example.com')
  })

  it('rejects an empty input with the user-facing message', () => {
    expect(() => validateEmailChange(CURRENT, '')).toThrow('Enter an email address')
  })

  it('rejects a whitespace-only input with the user-facing message', () => {
    expect(() => validateEmailChange(CURRENT, '   ')).toThrow('Enter an email address')
  })

  it.each(['jane', 'jane@', '@example.com', 'jane example@x.com'])(
    'rejects %s as malformed',
    (raw) => {
      expect(() => validateEmailChange(CURRENT, raw)).toThrow('Enter a valid email address')
    },
  )

  it('rejects the address the account already uses', () => {
    expect(() => validateEmailChange(CURRENT, CURRENT)).toThrow(
      'That is already your email address',
    )
  })

  it('rejects a differing-case variant of the current address', () => {
    expect(() => validateEmailChange(CURRENT, '  JANE@Example.com ')).toThrow(
      'That is already your email address',
    )
  })
})

describe('requestEmailChange', () => {
  it('refuses without a session and never reaches the endpoint', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never)

    await expect(requestEmailChange(new Headers(), 'new@example.com')).rejects.toThrow(
      'Not authenticated',
    )
    expect(auth.api.changeEmail).not.toHaveBeenCalled()
  })

  it('validates against the session address, not a caller-supplied one', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(session(CURRENT) as never)

    await expect(requestEmailChange(new Headers(), ' Jane@EXAMPLE.com ')).rejects.toThrow(
      'That is already your email address',
    )
    expect(auth.api.changeEmail).not.toHaveBeenCalled()
  })

  it('calls changeEmail once with the normalized address, the /profile callback and the same headers', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(session(CURRENT) as never)
    const headers = new Headers({ cookie: 'better-auth.session_token=abc' })

    await expect(requestEmailChange(headers, '  Moved@Example.COM ')).resolves.toBeUndefined()

    expect(auth.api.changeEmail).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(auth.api.changeEmail).mock.calls[0][0] as {
      body: { newEmail: string; callbackURL: string }
      headers: Headers
    }
    expect(arg.body.newEmail).toBe('moved@example.com')
    expect(arg.body.callbackURL).toBe(EMAIL_CHANGE_CALLBACK)
    expect(EMAIL_CHANGE_CALLBACK).toBe('/profile')
    expect(arg.headers).toBe(headers)
  })

  it('logs and wraps an endpoint failure in the L1 prefixed message', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(session(CURRENT) as never)
    vi.mocked(auth.api.changeEmail).mockRejectedValue(new Error('Email is the same'))

    await expect(requestEmailChange(new Headers(), 'new@example.com')).rejects.toThrow(
      /^Failed to request email change: /,
    )
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logger.error).mock.calls[0][0]).toBe('Failed to request email change')
  })

  it('narrows a non-Error rejection before wrapping it', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(session(CURRENT) as never)
    vi.mocked(auth.api.changeEmail).mockRejectedValue('boom')

    await expect(requestEmailChange(new Headers(), 'new@example.com')).rejects.toThrow(
      'Failed to request email change: boom',
    )
  })
})
