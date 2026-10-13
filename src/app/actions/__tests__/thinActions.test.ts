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
  submitCatalogSuggestion: vi.fn(),
  getPendingCatalogSuggestions: vi.fn(),
  reviewCatalogSuggestionGroup: vi.fn(),
}))

vi.mock('@/lib/moderationFields', () => ({
  getPendingFieldGroups: vi.fn(),
  approveCatalogFieldOption: vi.fn(),
  rejectCatalogField: vi.fn(),
}))

import { getProfileAction, updateProfileAction, requestEmailChangeAction } from '../profile'
import {
  submitCatalogSuggestionAction,
  getPendingCatalogSuggestionsAction,
  reviewLinkChangesAction,
  getPendingFieldGroupsAction,
  approveCatalogFieldOptionAction,
  rejectCatalogFieldAction,
} from '../moderation'
import { getRequiredUserId } from '@/lib/auth-session'
import { getProfile, updateProfile } from '@/lib/profile'
import { requestEmailChange } from '@/lib/emailChange'
import {
  submitCatalogSuggestion,
  getPendingCatalogSuggestions,
  reviewCatalogSuggestionGroup,
} from '@/lib/moderation'
import {
  getPendingFieldGroups,
  approveCatalogFieldOption,
  rejectCatalogField,
} from '@/lib/moderationFields'

const USER_ID = 'user-1'
const SONG_ID = 'song-1'
const GROUP_ID = 'group-1'

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
    name: 'submitCatalogSuggestionAction',
    invoke: () => submitCatalogSuggestionAction(SONG_ID, SONG_PATCH),
    target: () => vi.mocked(submitCatalogSuggestion),
    expected: [USER_ID, SONG_ID, SONG_PATCH],
  },
  {
    name: 'getPendingCatalogSuggestionsAction',
    invoke: () => getPendingCatalogSuggestionsAction(),
    target: () => vi.mocked(getPendingCatalogSuggestions),
    expected: [USER_ID],
  },
  {
    name: 'reviewLinkChangesAction (approve)',
    invoke: () => reviewLinkChangesAction(GROUP_ID, 'approve'),
    target: () => vi.mocked(reviewCatalogSuggestionGroup),
    expected: [
      USER_ID,
      GROUP_ID,
      'approve',
      { reason: undefined, rejectLinkSuggestionIds: undefined, linksOnly: true },
    ],
  },
  {
    name: 'reviewLinkChangesAction (reject with a reason)',
    invoke: () => reviewLinkChangesAction(GROUP_ID, 'reject', 'Wrong album'),
    target: () => vi.mocked(reviewCatalogSuggestionGroup),
    expected: [
      USER_ID,
      GROUP_ID,
      'reject',
      { reason: 'Wrong album', rejectLinkSuggestionIds: undefined, linksOnly: true },
    ],
  },
  {
    name: 'reviewLinkChangesAction (approve, rejecting link rows)',
    invoke: () => reviewLinkChangesAction(GROUP_ID, 'approve', 'No', ['row-1']),
    target: () => vi.mocked(reviewCatalogSuggestionGroup),
    expected: [
      USER_ID,
      GROUP_ID,
      'approve',
      { reason: 'No', rejectLinkSuggestionIds: ['row-1'], linksOnly: true },
    ],
  },
  {
    name: 'getPendingFieldGroupsAction',
    invoke: () => getPendingFieldGroupsAction(),
    target: () => vi.mocked(getPendingFieldGroups),
    expected: [USER_ID],
  },
  {
    name: 'approveCatalogFieldOptionAction',
    invoke: () => approveCatalogFieldOptionAction(['s1', 's2']),
    target: () => vi.mocked(approveCatalogFieldOption),
    expected: [USER_ID, ['s1', 's2']],
  },
  {
    name: 'rejectCatalogFieldAction',
    invoke: () => rejectCatalogFieldAction(SONG_ID, 'standard_key', 'Wrong key'),
    target: () => vi.mocked(rejectCatalogField),
    expected: [USER_ID, SONG_ID, 'standard_key', 'Wrong key'],
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
