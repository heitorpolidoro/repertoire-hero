/**
 * RH-202 - the billing actions take the user from the session, never from the
 * client, and reach the payment layer only through `getPaymentAdapter`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))
vi.mock('@/lib/subscriptions', () => ({
  getSubscription: vi.fn(),
  getSubscriptionStatus: vi.fn(),
}))
vi.mock('@/lib/billing', () => ({ getPaymentAdapter: vi.fn() }))
vi.mock('@/lib/billing/mockAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/mockAdapter')>()
  return { ...actual, completeMockCheckout: vi.fn() }
})

import {
  startCheckoutAction,
  openCustomerPortalAction,
  getSubscriptionStatusAction,
  completeMockCheckoutAction,
  cancelSubscriptionAction,
} from '../billing'
import { getRequiredUserId } from '@/lib/auth-session'
import { getSubscription, getSubscriptionStatus } from '@/lib/subscriptions'
import { getPaymentAdapter } from '@/lib/billing'
import { MockPaymentAdapter, completeMockCheckout } from '@/lib/billing/mockAdapter'
import type { PaymentAdapter } from '@/lib/billing/types'

const STATUS = {
  plan: 'pro' as const,
  status: 'active' as const,
  isEnforced: false,
  trialEndsAt: null,
  currentPeriodEndsAt: null,
  cancelAtPeriodEnd: false,
  provider: null,
}

let adapter: MockPaymentAdapter

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getRequiredUserId).mockResolvedValue('session-user')
  adapter = new MockPaymentAdapter()
  vi.mocked(getPaymentAdapter).mockReturnValue(adapter)
})

describe('startCheckoutAction', () => {
  it('returns the mock checkout URL for the signed-in user', async () => {
    const result = await startCheckoutAction('monthly')
    expect(result).toEqual({ url: '/mock-checkout?session_id=mock_cs_monthly_session-user' })
  })

  it('defaults to monthly and passes the session user to the adapter', async () => {
    const spy = vi.spyOn(adapter, 'createCheckoutSession')
    await startCheckoutAction()
    expect(spy).toHaveBeenCalledWith({
      userId: 'session-user',
      interval: 'monthly',
      successUrl: '/settings?checkout=success',
      cancelUrl: '/settings?checkout=canceled',
    })
  })

  it('refuses an interval it does not sell', async () => {
    expect(await startCheckoutAction('weekly' as never)).toEqual({ error: 'Invalid billing interval' })
  })

  it('returns the adapter failure as an envelope', async () => {
    vi.mocked(getPaymentAdapter).mockImplementation(() => {
      throw new Error('Unsupported billing provider: x')
    })
    expect(await startCheckoutAction('annual')).toEqual({ error: 'Unsupported billing provider: x' })
  })
})

describe('openCustomerPortalAction', () => {
  it('returns the portal URL', async () => {
    expect(await openCustomerPortalAction()).toEqual({ url: '/mock-checkout?portal=1' })
  })

  it('falls back to a fixed message for a non-Error throw', async () => {
    vi.mocked(getPaymentAdapter).mockReturnValue({
      createCustomerPortalSession: () => Promise.reject('x'),
    } as unknown as PaymentAdapter)
    expect(await openCustomerPortalAction()).toEqual({ error: 'Failed to open customer portal' })
  })
})

describe('getSubscriptionStatusAction', () => {
  it('reads the session user status', async () => {
    vi.mocked(getSubscriptionStatus).mockResolvedValue(STATUS)
    expect(await getSubscriptionStatusAction()).toEqual({ status: STATUS })
    expect(getSubscriptionStatus).toHaveBeenCalledWith('session-user')
  })

  it('returns a failure as an envelope', async () => {
    vi.mocked(getSubscriptionStatus).mockRejectedValue(new Error('Failed to fetch subscription: x'))
    expect(await getSubscriptionStatusAction()).toEqual({ error: 'Failed to fetch subscription: x' })
  })
})

describe('completeMockCheckoutAction', () => {
  it('completes a session the signed-in user owns', async () => {
    vi.mocked(completeMockCheckout).mockResolvedValue({} as never)
    expect(await completeMockCheckoutAction('mock_cs_monthly_session-user')).toEqual({ success: true })
    expect(completeMockCheckout).toHaveBeenCalledWith('mock_cs_monthly_session-user')
  })

  it("refuses another user's session", async () => {
    expect(await completeMockCheckoutAction('mock_cs_monthly_someone-else')).toEqual({
      error: 'This checkout session does not belong to you',
    })
    expect(await completeMockCheckoutAction('garbage')).toEqual({
      error: 'This checkout session does not belong to you',
    })
    expect(completeMockCheckout).not.toHaveBeenCalled()
  })

  it('refuses when the active provider is not the mock', async () => {
    vi.mocked(getPaymentAdapter).mockReturnValue({ provider: 'stripe' } as unknown as PaymentAdapter)
    expect(await completeMockCheckoutAction('mock_cs_monthly_session-user')).toEqual({
      error: 'Mock checkout is not available',
    })
  })
})

describe('cancelSubscriptionAction', () => {
  it("cancels the session user's provider subscription", async () => {
    vi.mocked(getSubscription).mockResolvedValue({ provider_subscription_id: 'mock_sub_session-user' } as never)
    const spy = vi.spyOn(adapter, 'cancelSubscription').mockResolvedValue()
    expect(await cancelSubscriptionAction()).toEqual({ success: true })
    expect(getSubscription).toHaveBeenCalledWith('session-user')
    expect(spy).toHaveBeenCalledWith('mock_sub_session-user')
  })

  it('refuses when there is no paid subscription', async () => {
    vi.mocked(getSubscription).mockResolvedValue(null)
    expect(await cancelSubscriptionAction()).toEqual({ error: 'No subscription to cancel' })
    vi.mocked(getSubscription).mockResolvedValue({ provider_subscription_id: null } as never)
    expect(await cancelSubscriptionAction()).toEqual({ error: 'No subscription to cancel' })
  })
})
