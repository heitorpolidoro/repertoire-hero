/**
 * RH-202: The one entitlements check. Every feature asks here what a user may
 * do; nothing else decides plan limits. The limits are the ones decided in the
 * monetization thread. A `null` limit means "no visible limit".
 *
 * Wiring these predicates into each feature is follow-up work: nothing calls
 * them to block a user yet.
 */
import { resolveUserPlan } from '@/lib/subscriptions'
import type { SubscriptionPlan } from '@/types/subscription'

const MB = 1024 * 1024
const GB = 1024 * MB

export interface UserEntitlements {
  plan: SubscriptionPlan
  /** Chart (PDF) files a musician may hold; `null` = unlimited. */
  maxChartFiles: number | null
  /** Total chart bytes before the abuse guard stops an upload; `null` = no guard. */
  chartAbuseLimitBytes: number | null
  /** Custom field definitions; `null` = unlimited. */
  maxCustomFields: number | null
  /** Total own-audio bytes. */
  maxAudioBytes: number
  allowOwnAudio: boolean
  allowApiTokens: boolean
  allowSetlistPlayer: boolean
  /** Songs stored offline per device; `null` = unlimited. */
  maxOfflineSongsPerDevice: number | null
  allowOfflineDownloadAll: boolean
}

export const FREE_ENTITLEMENTS: UserEntitlements = {
  plan: 'free',
  maxChartFiles: 50,
  // The 50-file cap is Free's guard; at 10 MB a file it cannot exceed 500 MB.
  chartAbuseLimitBytes: null,
  maxCustomFields: 2,
  maxAudioBytes: 0,
  allowOwnAudio: false,
  allowApiTokens: false,
  allowSetlistPlayer: false,
  maxOfflineSongsPerDevice: 5,
  allowOfflineDownloadAll: false,
}

export const PRO_ENTITLEMENTS: UserEntitlements = {
  plan: 'pro',
  maxChartFiles: null,
  chartAbuseLimitBytes: 2 * GB,
  maxCustomFields: null,
  maxAudioBytes: GB,
  allowOwnAudio: true,
  allowApiTokens: true,
  allowSetlistPlayer: true,
  maxOfflineSongsPerDevice: null,
  allowOfflineDownloadAll: true,
}

export function entitlementsForPlan(plan: SubscriptionPlan): UserEntitlements {
  return plan === 'pro' ? PRO_ENTITLEMENTS : FREE_ENTITLEMENTS
}

/** The effective limits for a user, from their resolved plan. */
export async function getEntitlements(userId: string): Promise<UserEntitlements> {
  const resolved = await resolveUserPlan(userId)
  return entitlementsForPlan(resolved.plan)
}

function underLimit(limit: number | null, current: number): boolean {
  return limit === null || current < limit
}

/** May one more chart be uploaded, given what the musician already holds? */
export function canUploadChart(
  entitlements: UserEntitlements,
  usage: { chartCount: number; chartBytes?: number; incomingBytes?: number },
): boolean {
  if (!underLimit(entitlements.maxChartFiles, usage.chartCount)) return false
  const guard = entitlements.chartAbuseLimitBytes
  if (guard === null) return true
  return (usage.chartBytes ?? 0) + (usage.incomingBytes ?? 0) <= guard
}

export function canCreateCustomField(entitlements: UserEntitlements, fieldCount: number): boolean {
  return underLimit(entitlements.maxCustomFields, fieldCount)
}

export function canUploadAudio(
  entitlements: UserEntitlements,
  audioBytes: number,
  incomingBytes: number,
): boolean {
  return entitlements.allowOwnAudio && audioBytes + incomingBytes <= entitlements.maxAudioBytes
}

export function canCreateApiToken(entitlements: UserEntitlements): boolean {
  return entitlements.allowApiTokens
}

export function canUseSetlistPlayer(entitlements: UserEntitlements): boolean {
  return entitlements.allowSetlistPlayer
}

export function canDownloadSongOffline(entitlements: UserEntitlements, storedSongCount: number): boolean {
  return underLimit(entitlements.maxOfflineSongsPerDevice, storedSongCount)
}

export function canDownloadAllOffline(entitlements: UserEntitlements): boolean {
  return entitlements.allowOfflineDownloadAll
}
