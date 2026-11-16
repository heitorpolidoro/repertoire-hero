/**
 * RH-202: The mock payment provider, so the subscription flow runs end to end
 * without a real gateway.
 *
 * A checkout session id is deterministic - `mock_cs_<interval>_<userId>` - so
 * nothing has to be stored between "start checkout" and "simulate success".
 * The `/mock-checkout` page completes it (after checking the signed-in user
 * owns it), which is what a real provider's success webhook would do.
 */
import { cancelSubscriptionByProviderId, upsertSubscription } from '@/lib/subscriptions'
import type { SubscriptionRecord } from '@/types/subscription'
import type {
  BillingInterval,
  CheckoutSessionParams,
  CheckoutSessionResult,
  CustomerPortalResult,
  PaymentAdapter,
  WebhookResult,
} from '@/lib/billing/types'

export const MOCK_PROVIDER = 'mock'

const SESSION_PATTERN = /^mock_cs_(monthly|annual)_(.+)$/

export function parseMockSessionId(
  sessionId: string,
): { userId: string; interval: BillingInterval } | null {
  const match = SESSION_PATTERN.exec(sessionId)
  if (!match) return null
  return { interval: match[1] as BillingInterval, userId: match[2] }
}

function periodEnd(interval: BillingInterval, now: Date): string {
  const end = new Date(now.getTime())
  if (interval === 'annual') end.setUTCFullYear(end.getUTCFullYear() + 1)
  else end.setUTCMonth(end.getUTCMonth() + 1)
  return end.toISOString()
}

/** Turns a minted session into an active Pro subscription for its user. */
export async function completeMockCheckout(
  sessionId: string,
  now: Date = new Date(),
): Promise<SubscriptionRecord> {
  const session = parseMockSessionId(sessionId)
  if (!session) throw new Error('Unknown mock checkout session')
  return upsertSubscription(session.userId, {
    plan: 'pro',
    status: 'active',
    trialEndsAt: null,
    currentPeriodEndsAt: periodEnd(session.interval, now),
    cancelAtPeriodEnd: false,
    provider: MOCK_PROVIDER,
    providerCustomerId: `mock_cus_${session.userId}`,
    providerSubscriptionId: `mock_sub_${session.userId}`,
  })
}

function parseEvent(rawBody: string | Buffer): Record<string, unknown> {
  const text = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // Reported below with the same message as a non-object body.
    parsed = null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid mock webhook payload')
  }
  return parsed as Record<string, unknown>
}

export class MockPaymentAdapter implements PaymentAdapter {
  readonly provider = MOCK_PROVIDER

  async createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSessionResult> {
    const sessionId = `mock_cs_${params.interval}_${params.userId}`
    return { sessionId, url: `/mock-checkout?session_id=${encodeURIComponent(sessionId)}` }
  }

  /** The mock portal needs neither the user nor a return URL: the page reads its own session. */
  async createCustomerPortalSession(): Promise<CustomerPortalResult> {
    return { url: '/mock-checkout?portal=1' }
  }

  /**
   * Mock events are plain JSON: `{ type: 'checkout.completed', sessionId }`
   * or `{ type: 'subscription.canceled', subscriptionId }`. It takes no headers
   * (`WebhookHeaders`): a real adapter verifies its signature from them.
   */
  async handleWebhook(rawBody: string | Buffer): Promise<WebhookResult> {
    const event = parseEvent(rawBody)
    const eventType = typeof event.type === 'string' ? event.type : null
    if (eventType === 'checkout.completed' && typeof event.sessionId === 'string') {
      await completeMockCheckout(event.sessionId)
      return { handled: true, eventType }
    }
    if (eventType === 'subscription.canceled' && typeof event.subscriptionId === 'string') {
      await this.cancelSubscription(event.subscriptionId)
      return { handled: true, eventType }
    }
    return { handled: false, eventType }
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    const record = await cancelSubscriptionByProviderId(MOCK_PROVIDER, subscriptionId)
    if (!record) throw new Error('Subscription not found')
  }
}
