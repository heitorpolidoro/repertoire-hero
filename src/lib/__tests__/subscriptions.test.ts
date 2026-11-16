import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const query = vi.fn()
vi.mock('@/lib/db', () => ({
  query: (text: string, params?: unknown[]) => query(text, params),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))

import {
  TRIAL_DAYS,
  getSubscription,
  upsertSubscription,
  cancelSubscriptionByProviderId,
  planFromRecord,
  resolveUserPlan,
  getSubscriptionStatus,
} from '@/lib/subscriptions'
import type { SubscriptionRecord } from '@/types/subscription'

const NOW = new Date('2026-11-16T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const past = new Date(NOW.getTime() - DAY).toISOString()
const future = new Date(NOW.getTime() + DAY).toISOString()

function row(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    id: 'sub-1',
    user_id: 'u1',
    plan: 'pro',
    status: 'active',
    trial_ends_at: null,
    current_period_ends_at: future,
    cancel_at_period_end: false,
    provider: 'mock',
    provider_customer_id: null,
    provider_subscription_id: null,
    created_at: past,
    updated_at: past,
    ...overrides,
  }
}

beforeEach(() => {
  query.mockReset()
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('planFromRecord', () => {
  it('keeps a trial Pro while it runs and drops it to Free once it ends', () => {
    expect(planFromRecord(row({ status: 'trialing', trial_ends_at: future }), NOW)).toBe('pro')
    expect(planFromRecord(row({ status: 'trialing', trial_ends_at: past }), NOW)).toBe('free')
    expect(planFromRecord(row({ status: 'trialing', trial_ends_at: null }), NOW)).toBe('free')
  })

  it('keeps an active Pro row Pro until its period ends', () => {
    expect(planFromRecord(row({ status: 'active', current_period_ends_at: future }), NOW)).toBe('pro')
    expect(planFromRecord(row({ status: 'active', current_period_ends_at: null }), NOW)).toBe('pro')
    expect(planFromRecord(row({ status: 'active', current_period_ends_at: past }), NOW)).toBe('free')
  })

  it('treats an active Free row as Free', () => {
    expect(planFromRecord(row({ plan: 'free', status: 'active' }), NOW)).toBe('free')
  })

  it('keeps a past-due Pro row Pro until its period ends', () => {
    expect(planFromRecord(row({ status: 'past_due', current_period_ends_at: future }), NOW)).toBe('pro')
    expect(planFromRecord(row({ status: 'past_due', current_period_ends_at: past }), NOW)).toBe('free')
  })

  it('keeps a canceled-at-period-end row Pro until the period ends, Free after', () => {
    const canceled = { status: 'canceled' as const, cancel_at_period_end: true }
    expect(planFromRecord(row({ ...canceled, current_period_ends_at: future }), NOW)).toBe('pro')
    expect(planFromRecord(row({ ...canceled, current_period_ends_at: past }), NOW)).toBe('free')
    expect(planFromRecord(row({ status: 'canceled', current_period_ends_at: future }), NOW)).toBe('free')
  })
})

describe('resolveUserPlan', () => {
  it('resolves to Pro without touching the database when BILLING_ENFORCED is unset', async () => {
    await expect(resolveUserPlan('u1', NOW)).resolves.toEqual({
      plan: 'pro',
      status: 'active',
      isEnforced: false,
      subscription: null,
    })
    expect(query).not.toHaveBeenCalled()
  })

  it('treats any value other than "true" as not enforced', async () => {
    vi.stubEnv('BILLING_ENFORCED', '1')
    expect((await resolveUserPlan('u1', NOW)).isEnforced).toBe(false)
  })

  describe('with BILLING_ENFORCED=true', () => {
    beforeEach(() => {
      vi.stubEnv('BILLING_ENFORCED', 'true')
    })

    it('starts a 14-day Pro trial for a user without a row', async () => {
      const trialEnd = new Date(NOW.getTime() + TRIAL_DAYS * DAY).toISOString()
      const created = row({ status: 'trialing', plan: 'pro', trial_ends_at: trialEnd, current_period_ends_at: null })
      query.mockResolvedValueOnce({ rows: [] }) // SELECT
      query.mockResolvedValueOnce({ rows: [] }) // INSERT ... ON CONFLICT DO NOTHING
      query.mockResolvedValueOnce({ rows: [created] }) // re-read
      const resolved = await resolveUserPlan('u1', NOW)
      expect(TRIAL_DAYS).toBe(14)
      expect(resolved).toEqual({ plan: 'pro', status: 'trialing', isEnforced: true, subscription: created })
      const insert = query.mock.calls[1]
      expect(insert[0]).toContain('INSERT INTO subscriptions')
      expect(insert[0]).toContain('ON CONFLICT (user_id) DO NOTHING')
      expect(insert[1]).toEqual(['u1', trialEnd])
    })

    it('resolves an expired trial to Free', async () => {
      query.mockResolvedValueOnce({ rows: [row({ status: 'trialing', trial_ends_at: past })] })
      const resolved = await resolveUserPlan('u1', NOW)
      expect(resolved.plan).toBe('free')
      expect(resolved.status).toBe('trialing')
    })

    it('resolves an active row to Pro', async () => {
      query.mockResolvedValueOnce({ rows: [row()] })
      expect((await resolveUserPlan('u1', NOW)).plan).toBe('pro')
    })

    it('resolves a canceled row to Pro until the period end and Free after', async () => {
      const canceled = { status: 'canceled' as const, cancel_at_period_end: true }
      query.mockResolvedValueOnce({ rows: [row({ ...canceled, current_period_ends_at: future })] })
      expect((await resolveUserPlan('u1', NOW)).plan).toBe('pro')
      query.mockResolvedValueOnce({ rows: [row({ ...canceled, current_period_ends_at: past })] })
      expect((await resolveUserPlan('u1', NOW)).plan).toBe('free')
    })

    it('fails closed with a prefixed message when the trial row cannot be read back', async () => {
      query.mockResolvedValueOnce({ rows: [] })
      query.mockResolvedValueOnce({ rows: [] })
      query.mockResolvedValueOnce({ rows: [] })
      await expect(resolveUserPlan('u1', NOW)).rejects.toThrow('Failed to start trial')
    })
  })
})

describe('data access', () => {
  it('getSubscription reads the user row or null', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    await expect(getSubscription('u1')).resolves.toEqual(row())
    expect(query.mock.calls[0][1]).toEqual(['u1'])
    query.mockResolvedValueOnce({ rows: [] })
    await expect(getSubscription('u1')).resolves.toBeNull()
  })

  it('getSubscription wraps a database failure', async () => {
    query.mockRejectedValueOnce(new Error('boom'))
    await expect(getSubscription('u1')).rejects.toThrow('Failed to fetch subscription: boom')
  })

  it('upsertSubscription writes every field keyed by user_id and returns the row', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    const result = await upsertSubscription('u1', {
      plan: 'pro',
      status: 'active',
      trialEndsAt: null,
      currentPeriodEndsAt: future,
      cancelAtPeriodEnd: false,
      provider: 'mock',
      providerCustomerId: 'mock_cus_u1',
      providerSubscriptionId: 'mock_sub_u1',
    })
    expect(result).toEqual(row())
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain('ON CONFLICT (user_id) DO UPDATE')
    expect(params).toEqual(['u1', 'pro', 'active', null, future, false, 'mock', 'mock_cus_u1', 'mock_sub_u1'])
  })

  it('upsertSubscription wraps a database failure', async () => {
    query.mockRejectedValueOnce('nope')
    await expect(
      upsertSubscription('u1', {
        plan: 'free',
        status: 'active',
        trialEndsAt: null,
        currentPeriodEndsAt: null,
        cancelAtPeriodEnd: false,
        provider: 'mock',
        providerCustomerId: null,
        providerSubscriptionId: null,
      }),
    ).rejects.toThrow('Failed to save subscription: nope')
  })

  it('cancelSubscriptionByProviderId marks the row canceled at period end', async () => {
    query.mockResolvedValueOnce({ rows: [row({ status: 'canceled', cancel_at_period_end: true })], rowCount: 1 })
    const result = await cancelSubscriptionByProviderId('mock', 'mock_sub_u1')
    expect(result?.status).toBe('canceled')
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain("status = 'canceled'")
    expect(sql).toContain('cancel_at_period_end = true')
    expect(params).toEqual(['mock', 'mock_sub_u1'])
    query.mockResolvedValueOnce({ rows: [] })
    await expect(cancelSubscriptionByProviderId('mock', 'nobody')).resolves.toBeNull()
  })

  it('cancelSubscriptionByProviderId wraps a database failure', async () => {
    query.mockRejectedValueOnce(new Error('down'))
    await expect(cancelSubscriptionByProviderId('mock', 'x')).rejects.toThrow('Failed to cancel subscription: down')
  })
})

describe('getSubscriptionStatus', () => {
  it('shows Pro with the stored row dates while billing is not enforced', async () => {
    query.mockResolvedValueOnce({ rows: [row({ provider_subscription_id: 'mock_sub_u1' })] })
    await expect(getSubscriptionStatus('u1', NOW)).resolves.toEqual({
      plan: 'pro',
      status: 'active',
      isEnforced: false,
      trialEndsAt: null,
      currentPeriodEndsAt: future,
      cancelAtPeriodEnd: false,
      provider: 'mock',
    })
  })

  it('shows Pro with no dates for a user without a row while not enforced', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(getSubscriptionStatus('u1', NOW)).resolves.toEqual({
      plan: 'pro',
      status: 'active',
      isEnforced: false,
      trialEndsAt: null,
      currentPeriodEndsAt: null,
      cancelAtPeriodEnd: false,
      provider: null,
    })
  })

  it('shows the resolved plan and the row status when enforced', async () => {
    vi.stubEnv('BILLING_ENFORCED', 'true')
    query.mockResolvedValueOnce({ rows: [row({ status: 'trialing', trial_ends_at: past })] })
    const status = await getSubscriptionStatus('u1', NOW)
    expect(status.plan).toBe('free')
    expect(status.status).toBe('trialing')
    expect(status.isEnforced).toBe(true)
    expect(status.trialEndsAt).toBe(past)
  })
})
