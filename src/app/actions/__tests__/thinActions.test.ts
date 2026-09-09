import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth-session', () => ({
  getRequiredUserId: vi.fn(),
}))

vi.mock('@/lib/profile', () => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
}))

// RH-42: the email action delegates to `@/lib/emailChange`, not `@/lib/profile`,
// and it forwards the request headers instead of a user id.
vi.mock('@/lib/emailChange', () => ({
  requestEmailChange: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

vi.mock('@/lib/moderation', () => ({
  submitGlobalSongEdit: vi.fn(),
  getPendingGlobalSongEdits: vi.fn(),
  reviewGlobalSongEdit: vi.fn(),
}))

import { getProfileAction, updateProfileAction, requestEmailChangeAction } from '../profile'
import {
  submitGlobalSongEditAction,
  getPendingGlobalSongEditsAction,
  reviewGlobalSongEditAction,
} from '../moderation'
import { getRequiredUserId } from '@/lib/auth-session'
import { getProfile, updateProfile } from '@/lib/profile'
import { requestEmailChange } from '@/lib/emailChange'
import {
  submitGlobalSongEdit,
  getPendingGlobalSongEdits,
  reviewGlobalSongEdit,
} from '@/lib/moderation'

const USER_ID = 'user-1'
const SONG_ID = 'song-1'
const EDIT_ID = 'edit-1'

const PROFILE_PATCH = { full_name: 'Jane Doe', instruments: ['Guitar'] }
const SONG_PATCH = { title: 'Corrected Title' }

/**
 * Convention A2: these actions resolve the session and delegate, with no
 * try/catch of their own. Every row is checked twice — once for the
 * pass-through, once for the propagation of the L1 wrapped error.
 */
const THIN_ACTIONS: Array<{
  name: string
  invoke: () => Promise<unknown>
  target: () => ReturnType<typeof vi.fn>
  expected: unknown[]
}> = [
  {
    name: 'getProfileAction',
    invoke: () => getProfileAction(),
    target: () => vi.mocked(getProfile),
    expected: [USER_ID],
  },
  {
    name: 'updateProfileAction',
    invoke: () => updateProfileAction(PROFILE_PATCH),
    target: () => vi.mocked(updateProfile),
    expected: [USER_ID, PROFILE_PATCH],
  },
  {
    // The one row that passes no user id: `requestEmailChange` resolves the
    // session from the headers itself, so the action forwards those instead.
    name: 'requestEmailChangeAction',
    invoke: () => requestEmailChangeAction('new@example.com'),
    target: () => vi.mocked(requestEmailChange),
    expected: [expect.any(Headers), 'new@example.com'],
  },
  {
    name: 'submitGlobalSongEditAction',
    invoke: () => submitGlobalSongEditAction(SONG_ID, SONG_PATCH),
    target: () => vi.mocked(submitGlobalSongEdit),
    expected: [USER_ID, SONG_ID, SONG_PATCH],
  },
  {
    name: 'getPendingGlobalSongEditsAction',
    invoke: () => getPendingGlobalSongEditsAction(),
    target: () => vi.mocked(getPendingGlobalSongEdits),
    expected: [USER_ID],
  },
  {
    name: 'reviewGlobalSongEditAction (approve)',
    invoke: () => reviewGlobalSongEditAction(EDIT_ID, 'approve'),
    target: () => vi.mocked(reviewGlobalSongEdit),
    expected: [USER_ID, EDIT_ID, 'approve', undefined],
  },
  {
    name: 'reviewGlobalSongEditAction (reject with a reason)',
    invoke: () => reviewGlobalSongEditAction(EDIT_ID, 'reject', 'Wrong album'),
    target: () => vi.mocked(reviewGlobalSongEdit),
    expected: [USER_ID, EDIT_ID, 'reject', 'Wrong album'],
  },
]

beforeEach(() => {
  vi.mocked(getRequiredUserId).mockReset()
  vi.mocked(getRequiredUserId).mockResolvedValue(USER_ID)
  for (const action of THIN_ACTIONS) action.target().mockReset()
})

describe('thin server actions (convention A2)', () => {
  it.each(THIN_ACTIONS)(
    '$name passes the resolved session user id through to src/lib',
    async ({ invoke, target, expected }) => {
      const delegate = target()
      delegate.mockResolvedValue('lib-result')

      await expect(invoke()).resolves.toBe('lib-result')

      expect(getRequiredUserId).toHaveBeenCalledTimes(1)
      expect(delegate).toHaveBeenCalledWith(...expected)
    },
  )

  it.each(THIN_ACTIONS)('$name lets the L1 error propagate instead of returning an envelope', async ({ invoke, target }) => {
    target().mockRejectedValue(new Error('Failed to fetch profile: connection lost'))

    const outcome = await invoke().then(
      (value) => ({ kind: 'resolved' as const, value }),
      (err: unknown) => ({ kind: 'rejected' as const, value: err }),
    )

    expect(outcome.kind).toBe('rejected')
    expect((outcome.value as Error).message).toBe('Failed to fetch profile: connection lost')
  })

  it.each(THIN_ACTIONS)('$name does not swallow a missing session', async ({ invoke, target }) => {
    vi.mocked(getRequiredUserId).mockRejectedValue(new Error('Not authenticated'))

    await expect(invoke()).rejects.toThrow('Not authenticated')
    expect(target()).not.toHaveBeenCalled()
  })
})
