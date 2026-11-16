/**
 * RH-202: Subscription persistence and plan resolution.
 *
 * Until billing is enforced (`BILLING_ENFORCED !== 'true'`) every user resolves
 * to Pro and nothing here touches the database on the resolution path. Once it
 * is enforced, a user without a row lazily gets a 14-day Pro trial, and the row
 * decides the plan from then on (`planFromRecord`).
 */
import { query } from '@/lib/db'
import { logger } from '@/lib/logger'
import type { SubscriptionRow } from '@/lib/dbRows'
import type {
  SubscriptionPlan,
  SubscriptionRecord,
  SubscriptionStatus,
  SubscriptionStatusView,
} from '@/types/subscription'

export const TRIAL_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

const SUBSCRIPTION_COLUMNS = `id, user_id, plan, status, trial_ends_at, current_period_ends_at,
  cancel_at_period_end, provider, provider_customer_id, provider_subscription_id, created_at, updated_at`

/** What a write sets on a user's row; every field is written. */
export interface SubscriptionUpsert {
  plan: SubscriptionPlan
  status: SubscriptionStatus
  trialEndsAt: string | null
  currentPeriodEndsAt: string | null
  cancelAtPeriodEnd: boolean
  provider: string
  providerCustomerId: string | null
  providerSubscriptionId: string | null
}

export interface ResolvedPlan {
  plan: SubscriptionPlan
  status: SubscriptionStatus
  isEnforced: boolean
  /** The row the decision was made from; `null` while billing is not enforced. */
  subscription: SubscriptionRecord | null
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null
  return new Date(value).toISOString()
}

function mapRow(row: SubscriptionRow): SubscriptionRecord {
  return {
    ...row,
    trial_ends_at: toIso(row.trial_ends_at),
    current_period_ends_at: toIso(row.current_period_ends_at),
    created_at: toIso(row.created_at) as string,
    updated_at: toIso(row.updated_at) as string,
  }
}

function wrapError(action: string, error: unknown, context: Record<string, unknown>): Error {
  const err = error instanceof Error ? error : new Error(String(error))
  logger.error(`Failed to ${action}`, err, context)
  return new Error(`Failed to ${action}: ${err.message}`)
}

export function isBillingEnforced(): boolean {
  return process.env.BILLING_ENFORCED === 'true'
}

export async function getSubscription(userId: string): Promise<SubscriptionRecord | null> {
  try {
    const res = await query<SubscriptionRow>(
      `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE user_id = $1`,
      [userId],
    )
    return res.rows[0] ? mapRow(res.rows[0]) : null
  } catch (error) {
    throw wrapError('fetch subscription', error, { userId })
  }
}

export async function upsertSubscription(
  userId: string,
  input: SubscriptionUpsert,
): Promise<SubscriptionRecord> {
  try {
    const res = await query<SubscriptionRow>(
      `INSERT INTO subscriptions (user_id, plan, status, trial_ends_at, current_period_ends_at,
         cancel_at_period_end, provider, provider_customer_id, provider_subscription_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id) DO UPDATE SET
         plan = EXCLUDED.plan,
         status = EXCLUDED.status,
         trial_ends_at = EXCLUDED.trial_ends_at,
         current_period_ends_at = EXCLUDED.current_period_ends_at,
         cancel_at_period_end = EXCLUDED.cancel_at_period_end,
         provider = EXCLUDED.provider,
         provider_customer_id = EXCLUDED.provider_customer_id,
         provider_subscription_id = EXCLUDED.provider_subscription_id,
         updated_at = now()
       RETURNING ${SUBSCRIPTION_COLUMNS}`,
      [
        userId,
        input.plan,
        input.status,
        input.trialEndsAt,
        input.currentPeriodEndsAt,
        input.cancelAtPeriodEnd,
        input.provider,
        input.providerCustomerId,
        input.providerSubscriptionId,
      ],
    )
    return mapRow(res.rows[0])
  } catch (error) {
    throw wrapError('save subscription', error, { userId })
  }
}

/**
 * Marks a provider subscription canceled at the end of its period: the user
 * keeps Pro until `current_period_ends_at`. `null` when no row matches.
 */
export async function cancelSubscriptionByProviderId(
  provider: string,
  providerSubscriptionId: string,
): Promise<SubscriptionRecord | null> {
  try {
    const res = await query<SubscriptionRow>(
      `UPDATE subscriptions
          SET status = 'canceled', cancel_at_period_end = true, updated_at = now()
        WHERE provider = $1 AND provider_subscription_id = $2
        RETURNING ${SUBSCRIPTION_COLUMNS}`,
      [provider, providerSubscriptionId],
    )
    return res.rows[0] ? mapRow(res.rows[0]) : null
  } catch (error) {
    throw wrapError('cancel subscription', error, { provider, providerSubscriptionId })
  }
}

function isBefore(now: Date, iso: string | null): boolean {
  return iso !== null && now.getTime() < new Date(iso).getTime()
}

/** The effective plan a row grants at `now`. Pure. */
export function planFromRecord(record: SubscriptionRecord, now: Date): SubscriptionPlan {
  if (record.plan === 'free') return 'free'
  switch (record.status) {
    case 'trialing':
      return isBefore(now, record.trial_ends_at) ? 'pro' : 'free'
    case 'active':
      return record.current_period_ends_at === null || isBefore(now, record.current_period_ends_at)
        ? 'pro'
        : 'free'
    case 'past_due':
      // Grace: a failed renewal keeps Pro until the paid period runs out.
      return isBefore(now, record.current_period_ends_at) ? 'pro' : 'free'
    case 'canceled':
      return record.cancel_at_period_end && isBefore(now, record.current_period_ends_at) ? 'pro' : 'free'
  }
}

/** Starts the 14-day Pro trial; a concurrent first check keeps the first row. */
async function startTrial(userId: string, now: Date): Promise<SubscriptionRecord> {
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * DAY_MS).toISOString()
  await query(
    `INSERT INTO subscriptions (user_id, plan, status, trial_ends_at)
     VALUES ($1, 'pro', 'trialing', $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, trialEndsAt],
  )
  const created = await getSubscription(userId)
  if (!created) throw wrapError('start trial', new Error('trial row not found'), { userId })
  return created
}

export async function resolveUserPlan(userId: string, now: Date = new Date()): Promise<ResolvedPlan> {
  if (!isBillingEnforced()) {
    return { plan: 'pro', status: 'active', isEnforced: false, subscription: null }
  }
  const subscription = (await getSubscription(userId)) ?? (await startTrial(userId, now))
  return {
    plan: planFromRecord(subscription, now),
    status: subscription.status,
    isEnforced: true,
    subscription,
  }
}

/** What Settings shows: the effective plan, and the stored row's dates and status. */
export async function getSubscriptionStatus(
  userId: string,
  now: Date = new Date(),
): Promise<SubscriptionStatusView> {
  const resolved = await resolveUserPlan(userId, now)
  const record = resolved.isEnforced ? resolved.subscription : await getSubscription(userId)
  return {
    plan: resolved.plan,
    status: record?.status ?? resolved.status,
    isEnforced: resolved.isEnforced,
    trialEndsAt: record?.trial_ends_at ?? null,
    currentPeriodEndsAt: record?.current_period_ends_at ?? null,
    cancelAtPeriodEnd: record?.cancel_at_period_end ?? false,
    provider: record?.provider ?? null,
  }
}
