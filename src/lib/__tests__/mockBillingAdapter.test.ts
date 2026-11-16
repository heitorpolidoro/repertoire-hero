import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const upsertSubscription = vi.fn()
const cancelSubscriptionByProviderId = vi.fn()
vi.mock('@/lib/subscriptions', () => ({
  upsertSubscription: (...args: unknown[]) => upsertSubscription(...args),
  cancelSubscriptionByProviderId: (...args: unknown[]) => cancelSubscriptionByProviderId(...args),
  isBillingEnforced: () => process.env.BILLING_ENFORCED === 'true',
}))

import {
  MockPaymentAdapter,
  parseMockSessionId,
  completeMockCheckout,
  MOCK_PROVIDER,
} from '@/lib/billing/mockAdapter'
import { getPaymentAdapter } from '@/lib/billing'
import { PRO_PRICES } from '@/lib/billing/prices'
import type { PaymentAdapter } from '@/lib/billing/types'

/** Every call goes through the boundary type, as the app's callers do. */
function mock(): PaymentAdapter {
  return new MockPaymentAdapter()
}

const NOW = new Date('2026-11-16T12:00:00.000Z')
const PARAMS = { userId: 'user-1', interval: 'monthly' as const, successUrl: '/settings', cancelUrl: '/settings' }

beforeEach(() => {
  upsertSubscription.mockReset()
  cancelSubscriptionByProviderId.mockReset()
  upsertSubscription.mockImplementation(async (userId: string, input: Record<string, unknown>) => ({
    user_id: userId,
    plan: input.plan,
    status: input.status,
    current_period_ends_at: input.currentPeriodEndsAt,
  }))
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('MockPaymentAdapter implements PaymentAdapter', () => {
  it('exposes all four methods', () => {
    const adapter: PaymentAdapter = new MockPaymentAdapter()
    expect(adapter.provider).toBe('mock')
    for (const method of [
      'createCheckoutSession',
      'createCustomerPortalSession',
      'handleWebhook',
      'cancelSubscription',
    ] as const) {
      expect(typeof adapter[method]).toBe('function')
    }
  })

  it('keeps every provider package out of the boundary types', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/billing/types.ts'), 'utf8')
    expect(source).not.toMatch(/^import\s/m)
    expect(source).not.toMatch(/from\s+['"](stripe|mercadopago|@better-auth\/stripe)['"]/)
  })
})

describe('checkout', () => {
  it('returns a /mock-checkout URL carrying a deterministic session id', async () => {
    const adapter = new MockPaymentAdapter()
    const result = await adapter.createCheckoutSession(PARAMS)
    expect(result.url.startsWith('/mock-checkout?session_id=')).toBe(true)
    expect(result.url).toBe(`/mock-checkout?session_id=${encodeURIComponent(result.sessionId)}`)
    expect(await adapter.createCheckoutSession(PARAMS)).toEqual(result)
    expect(parseMockSessionId(result.sessionId)).toEqual({ userId: 'user-1', interval: 'monthly' })
  })

  it('refuses a session id it did not mint', () => {
    expect(parseMockSessionId('cs_live_123')).toBeNull()
    expect(parseMockSessionId('mock_cs_weekly_user-1')).toBeNull()
    expect(parseMockSessionId('mock_cs_monthly_')).toBeNull()
  })

  it('completing a monthly session activates Pro with a period end one month out', async () => {
    const { sessionId } = await mock().createCheckoutSession(PARAMS)
    const record = await completeMockCheckout(sessionId, NOW)
    expect(record).toMatchObject({ plan: 'pro', status: 'active' })
    expect(new Date(record.current_period_ends_at as string).getTime()).toBeGreaterThan(NOW.getTime())
    expect(upsertSubscription).toHaveBeenCalledWith('user-1', {
      plan: 'pro',
      status: 'active',
      trialEndsAt: null,
      currentPeriodEndsAt: '2026-12-16T12:00:00.000Z',
      cancelAtPeriodEnd: false,
      provider: MOCK_PROVIDER,
      providerCustomerId: 'mock_cus_user-1',
      providerSubscriptionId: 'mock_sub_user-1',
    })
  })

  it('completing an annual session runs one year', async () => {
    const { sessionId } = await mock().createCheckoutSession({ ...PARAMS, interval: 'annual' })
    await completeMockCheckout(sessionId, NOW)
    expect(upsertSubscription.mock.calls[0][1].currentPeriodEndsAt).toBe('2027-11-16T12:00:00.000Z')
  })

  it('completing with the clock defaulted still lands in the future', async () => {
    const { sessionId } = await mock().createCheckoutSession(PARAMS)
    const record = await completeMockCheckout(sessionId)
    expect(new Date(record.current_period_ends_at as string).getTime()).toBeGreaterThan(Date.now())
  })

  it('refuses to complete an unknown session', async () => {
    await expect(completeMockCheckout('bogus', NOW)).rejects.toThrow('Unknown mock checkout session')
    expect(upsertSubscription).not.toHaveBeenCalled()
  })
})

describe('portal and cancellation', () => {
  it('opens the mock portal page', async () => {
    const result = await mock().createCustomerPortalSession({ userId: 'user-1', returnUrl: '/settings' })
    expect(result).toEqual({ url: '/mock-checkout?portal=1' })
  })

  it('cancels at period end through the provider id', async () => {
    cancelSubscriptionByProviderId.mockResolvedValue({ status: 'canceled' })
    await mock().cancelSubscription('mock_sub_user-1')
    expect(cancelSubscriptionByProviderId).toHaveBeenCalledWith('mock', 'mock_sub_user-1')
  })

  it('throws when there is nothing to cancel', async () => {
    cancelSubscriptionByProviderId.mockResolvedValue(null)
    await expect(mock().cancelSubscription('mock_sub_x')).rejects.toThrow('Subscription not found')
  })
})

describe('handleWebhook', () => {
  it('applies checkout.completed', async () => {
    const adapter = mock()
    const { sessionId } = await adapter.createCheckoutSession(PARAMS)
    const body = JSON.stringify({ type: 'checkout.completed', sessionId })
    await expect(adapter.handleWebhook(Buffer.from(body), {})).resolves.toEqual({
      handled: true,
      eventType: 'checkout.completed',
    })
    expect(upsertSubscription).toHaveBeenCalledTimes(1)
  })

  it('applies subscription.canceled', async () => {
    cancelSubscriptionByProviderId.mockResolvedValue({ status: 'canceled' })
    const body = JSON.stringify({ type: 'subscription.canceled', subscriptionId: 'mock_sub_user-1' })
    await expect(mock().handleWebhook(body, {})).resolves.toEqual({
      handled: true,
      eventType: 'subscription.canceled',
    })
  })

  it('acknowledges an unknown event without acting', async () => {
    const body = JSON.stringify({ type: 'invoice.created' })
    await expect(mock().handleWebhook(body, {})).resolves.toEqual({
      handled: false,
      eventType: 'invoice.created',
    })
    await expect(mock().handleWebhook('{}', {})).resolves.toEqual({
      handled: false,
      eventType: null,
    })
    expect(upsertSubscription).not.toHaveBeenCalled()
  })

  it('rejects a body that is not a JSON object', async () => {
    await expect(mock().handleWebhook('not json', {})).rejects.toThrow('Invalid mock webhook payload')
    await expect(mock().handleWebhook('[1]', {})).rejects.toThrow('Invalid mock webhook payload')
  })
})

describe('getPaymentAdapter', () => {
  it('returns the mock adapter when BILLING_PROVIDER is unset or "mock"', () => {
    expect(getPaymentAdapter()).toBeInstanceOf(MockPaymentAdapter)
    vi.stubEnv('BILLING_PROVIDER', 'mock')
    expect(getPaymentAdapter()).toBeInstanceOf(MockPaymentAdapter)
  })

  it('refuses a provider that has no adapter yet', () => {
    vi.stubEnv('BILLING_PROVIDER', 'stripe')
    expect(() => getPaymentAdapter()).toThrow('Unsupported billing provider: stripe')
  })

  it('refuses the mock adapter when billing is enforced in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BILLING_ENFORCED', 'true')
    expect(() => getPaymentAdapter()).toThrow('mock billing provider cannot run')
    vi.stubEnv('BILLING_ENFORCED', 'false')
    expect(getPaymentAdapter()).toBeInstanceOf(MockPaymentAdapter)
  })
})

describe('PRO_PRICES', () => {
  it('carries the decided monthly price and the proposed annual one', () => {
    expect(PRO_PRICES.monthly).toEqual({ amountCents: 1490, currency: 'BRL', label: 'R$ 14,90/month' })
    expect(PRO_PRICES.annual).toEqual({ amountCents: 11900, currency: 'BRL', label: 'R$ 119/year' })
  })
})
