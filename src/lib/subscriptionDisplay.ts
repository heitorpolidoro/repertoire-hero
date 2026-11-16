/**
 * RH-202: What the Settings subscription card says, decided once and pure, so
 * the component only renders it. Client-safe: no database import.
 */
import type { SubscriptionStatusView } from '@/types/subscription'

const DAY_MS = 24 * 60 * 60 * 1000

export interface SubscriptionDisplay {
  kind: 'free' | 'trial' | 'active' | 'included'
  title: string
  badge: string
  detail: string
  /** `upgrade` starts checkout; `manage` opens the provider's customer portal. */
  action: 'upgrade' | 'manage'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function describeTrial(trialEndsAt: string, now: Date): SubscriptionDisplay {
  const days = Math.max(1, Math.ceil((new Date(trialEndsAt).getTime() - now.getTime()) / DAY_MS))
  return {
    kind: 'trial',
    title: 'Pro Trial',
    badge: `${days} ${days === 1 ? 'day' : 'days'} remaining`,
    detail: `Your 14-day trial includes every Pro feature until ${formatDate(trialEndsAt)}.`,
    action: 'upgrade',
  }
}

export function describeSubscription(view: SubscriptionStatusView, now: Date): SubscriptionDisplay {
  if (view.plan === 'free') {
    return {
      kind: 'free',
      title: 'Free',
      badge: 'Free plan',
      detail: 'Basic limits for individual musicians.',
      action: 'upgrade',
    }
  }
  if (view.status === 'trialing' && view.trialEndsAt) return describeTrial(view.trialEndsAt, now)
  if (view.currentPeriodEndsAt) {
    const date = formatDate(view.currentPeriodEndsAt)
    return {
      kind: 'active',
      title: 'Pro',
      badge: view.cancelAtPeriodEnd ? 'Canceled' : 'Active',
      detail: view.cancelAtPeriodEnd ? `Pro until ${date}, then Free.` : `Renews on ${date}.`,
      action: 'manage',
    }
  }
  return {
    kind: 'included',
    title: 'Pro',
    badge: 'Included',
    detail: 'Every Pro feature is included while billing is not enabled.',
    action: 'upgrade',
  }
}
