/**
 * RH-202: The subscription vocabulary. Kept out of `src/types/database.ts`,
 * which sits at its 400-line budget (the same reason as `customField.ts`).
 */

export type SubscriptionPlan = 'free' | 'pro'

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled'

/** One `subscriptions` row, column for column. */
export interface SubscriptionRecord {
  id: string
  user_id: string
  plan: SubscriptionPlan
  status: SubscriptionStatus
  trial_ends_at: string | null
  current_period_ends_at: string | null
  cancel_at_period_end: boolean
  provider: string
  provider_customer_id: string | null
  provider_subscription_id: string | null
  created_at: string
  updated_at: string
}

/** What the Settings card renders: the effective plan plus the row's dates. */
export interface SubscriptionStatusView {
  plan: SubscriptionPlan
  status: SubscriptionStatus
  isEnforced: boolean
  trialEndsAt: string | null
  currentPeriodEndsAt: string | null
  cancelAtPeriodEnd: boolean
  provider: string | null
}
