import { describe, it, expect } from 'vitest'
import { describeSubscription } from '@/lib/subscriptionDisplay'
import type { SubscriptionStatusView } from '@/types/subscription'

const NOW = new Date('2026-11-16T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function view(overrides: Partial<SubscriptionStatusView> = {}): SubscriptionStatusView {
  return {
    plan: 'pro',
    status: 'active',
    isEnforced: true,
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    cancelAtPeriodEnd: false,
    provider: 'mock',
    ...overrides,
  }
}

describe('describeSubscription', () => {
  it('Free offers the upgrade', () => {
    expect(describeSubscription(view({ plan: 'free' }), NOW)).toEqual({
      kind: 'free',
      title: 'Free',
      badge: 'Free plan',
      detail: 'Basic limits for individual musicians.',
      action: 'upgrade',
    })
  })

  it('a running trial counts the days remaining and offers the upgrade', () => {
    const trialEndsAt = new Date(NOW.getTime() + 11 * DAY - 1000).toISOString()
    expect(describeSubscription(view({ status: 'trialing', trialEndsAt }), NOW)).toEqual({
      kind: 'trial',
      title: 'Pro Trial',
      badge: '11 days remaining',
      detail: 'Your 14-day trial includes every Pro feature until Nov 27, 2026.',
      action: 'upgrade',
    })
  })

  it('says "1 day remaining" on the last day', () => {
    const trialEndsAt = new Date(NOW.getTime() + 2 * 60 * 60 * 1000).toISOString()
    expect(describeSubscription(view({ status: 'trialing', trialEndsAt }), NOW).badge).toBe('1 day remaining')
  })

  it('an active paid Pro shows the renewal date and offers management', () => {
    const currentPeriodEndsAt = new Date('2026-12-16T12:00:00.000Z').toISOString()
    expect(describeSubscription(view({ currentPeriodEndsAt }), NOW)).toEqual({
      kind: 'active',
      title: 'Pro',
      badge: 'Active',
      detail: 'Renews on Dec 16, 2026.',
      action: 'manage',
    })
  })

  it('a canceled-at-period-end Pro shows when access ends', () => {
    const currentPeriodEndsAt = new Date('2026-12-16T12:00:00.000Z').toISOString()
    const described = describeSubscription(
      view({ status: 'canceled', cancelAtPeriodEnd: true, currentPeriodEndsAt }),
      NOW,
    )
    expect(described.badge).toBe('Canceled')
    expect(described.detail).toBe('Pro until Dec 16, 2026, then Free.')
    expect(described.action).toBe('manage')
  })

  it('Pro without a paid subscription (billing not enforced) is included and offers the upgrade', () => {
    expect(describeSubscription(view({ isEnforced: false, provider: null }), NOW)).toEqual({
      kind: 'included',
      title: 'Pro',
      badge: 'Included',
      detail: 'Every Pro feature is included while billing is not enabled.',
      action: 'upgrade',
    })
  })
})
