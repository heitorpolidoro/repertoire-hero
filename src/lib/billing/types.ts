/**
 * RH-202: The provider-agnostic payment boundary.
 *
 * Every adapter (the mock today, a real provider later) takes and returns only
 * these neutral records. No provider SDK type, client, event class or webhook
 * signature helper may cross this boundary - a provider's own shapes stay
 * inside its adapter module.
 */

export type BillingInterval = 'monthly' | 'annual'

export interface CheckoutSessionParams {
  userId: string
  interval: BillingInterval
  /** Where the provider sends the user after a successful payment. */
  successUrl: string
  /** Where the provider sends the user when they abandon checkout. */
  cancelUrl: string
}

export interface CheckoutSessionResult {
  sessionId: string
  /** The page the browser opens to pay. */
  url: string
}

export interface CustomerPortalParams {
  userId: string
  returnUrl: string
}

export interface CustomerPortalResult {
  url: string
}

export type WebhookHeaders = Record<string, string | string[] | undefined>

export interface WebhookResult {
  /** Whether the event changed (or confirmed) a subscription. */
  handled: boolean
  /** The provider's event name, normalised to a plain string; `null` if absent. */
  eventType: string | null
}

export interface PaymentAdapter {
  /** The `subscriptions.provider` value this adapter owns. */
  readonly provider: string
  createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSessionResult>
  createCustomerPortalSession(params: CustomerPortalParams): Promise<CustomerPortalResult>
  handleWebhook(rawBody: string | Buffer, headers: WebhookHeaders): Promise<WebhookResult>
  /** Cancels at period end; `subscriptionId` is the provider's subscription id. */
  cancelSubscription(subscriptionId: string): Promise<void>
}
