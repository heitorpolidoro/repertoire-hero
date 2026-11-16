'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import { getSubscription, getSubscriptionStatus } from '@/lib/subscriptions'
import { getPaymentAdapter } from '@/lib/billing'
import { MOCK_PROVIDER, completeMockCheckout, parseMockSessionId } from '@/lib/billing/mockAdapter'
import type { BillingInterval } from '@/lib/billing/types'
import type { SubscriptionStatusView } from '@/types/subscription'

const INTERVALS: readonly BillingInterval[] = ['monthly', 'annual']

/** A1: `undefined` makes the fallback fire for non-Error throws and empty messages. */
function failure(err: unknown, fallback: string): { error: string } {
  const message = err instanceof Error ? err.message : undefined
  return { error: message || fallback }
}

export async function getSubscriptionStatusAction(): Promise<{
  status?: SubscriptionStatusView
  error?: string
}> {
  try {
    const userId = await getRequiredUserId()
    return { status: await getSubscriptionStatus(userId) }
  } catch (err) {
    return failure(err, 'Failed to load subscription')
  }
}

export async function startCheckoutAction(
  interval: BillingInterval = 'monthly',
): Promise<{ url?: string; error?: string }> {
  try {
    const userId = await getRequiredUserId()
    if (!INTERVALS.includes(interval)) return { error: 'Invalid billing interval' }
    const session = await getPaymentAdapter().createCheckoutSession({
      userId,
      interval,
      successUrl: '/settings?checkout=success',
      cancelUrl: '/settings?checkout=canceled',
    })
    return { url: session.url }
  } catch (err) {
    return failure(err, 'Failed to start checkout')
  }
}

export async function openCustomerPortalAction(): Promise<{ url?: string; error?: string }> {
  try {
    const userId = await getRequiredUserId()
    const portal = await getPaymentAdapter().createCustomerPortalSession({
      userId,
      returnUrl: '/settings',
    })
    return { url: portal.url }
  } catch (err) {
    return failure(err, 'Failed to open customer portal')
  }
}

/** The `/mock-checkout` "Simulate success" button: only the session's own user may complete it. */
export async function completeMockCheckoutAction(
  sessionId: string,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const userId = await getRequiredUserId()
    if (getPaymentAdapter().provider !== MOCK_PROVIDER) return { error: 'Mock checkout is not available' }
    if (parseMockSessionId(sessionId)?.userId !== userId) {
      return { error: 'This checkout session does not belong to you' }
    }
    await completeMockCheckout(sessionId)
    return { success: true }
  } catch (err) {
    return failure(err, 'Failed to complete checkout')
  }
}

/** Cancels the signed-in user's subscription at the end of its period. */
export async function cancelSubscriptionAction(): Promise<{ success?: boolean; error?: string }> {
  try {
    const userId = await getRequiredUserId()
    const subscription = await getSubscription(userId)
    if (!subscription?.provider_subscription_id) return { error: 'No subscription to cancel' }
    await getPaymentAdapter().cancelSubscription(subscription.provider_subscription_id)
    return { success: true }
  } catch (err) {
    return failure(err, 'Failed to cancel subscription')
  }
}
