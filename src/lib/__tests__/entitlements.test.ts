import { describe, it, expect, vi, beforeEach } from 'vitest'

const resolveUserPlan = vi.fn()
vi.mock('@/lib/subscriptions', () => ({
  resolveUserPlan: (userId: string) => resolveUserPlan(userId),
}))

import {
  FREE_ENTITLEMENTS,
  PRO_ENTITLEMENTS,
  entitlementsForPlan,
  getEntitlements,
  canUploadChart,
  canCreateCustomField,
  canUploadAudio,
  canCreateApiToken,
  canUseSetlistPlayer,
  canDownloadSongOffline,
  canDownloadAllOffline,
} from '@/lib/entitlements'

const GB = 1024 * 1024 * 1024

beforeEach(() => {
  resolveUserPlan.mockReset()
})

describe('plan limits (RH-202 Scope §2)', () => {
  it('Free carries the decided limits exactly', () => {
    expect(FREE_ENTITLEMENTS).toEqual({
      plan: 'free',
      maxChartFiles: 50,
      chartAbuseLimitBytes: null,
      maxCustomFields: 2,
      maxAudioBytes: 0,
      allowOwnAudio: false,
      allowApiTokens: false,
      allowSetlistPlayer: false,
      maxOfflineSongsPerDevice: 5,
      allowOfflineDownloadAll: false,
    })
  })

  it('Pro carries the decided limits exactly', () => {
    expect(PRO_ENTITLEMENTS).toEqual({
      plan: 'pro',
      maxChartFiles: null,
      chartAbuseLimitBytes: 2147483648,
      maxCustomFields: null,
      maxAudioBytes: 1073741824,
      allowOwnAudio: true,
      allowApiTokens: true,
      allowSetlistPlayer: true,
      maxOfflineSongsPerDevice: null,
      allowOfflineDownloadAll: true,
    })
    expect(PRO_ENTITLEMENTS.chartAbuseLimitBytes).toBe(2 * GB)
    expect(PRO_ENTITLEMENTS.maxAudioBytes).toBe(GB)
  })

  it('maps a plan to its limits', () => {
    expect(entitlementsForPlan('free')).toBe(FREE_ENTITLEMENTS)
    expect(entitlementsForPlan('pro')).toBe(PRO_ENTITLEMENTS)
  })
})

describe('getEntitlements', () => {
  it('returns Pro limits when the user resolves to Pro (billing not enforced)', async () => {
    resolveUserPlan.mockResolvedValue({ plan: 'pro', status: 'active', isEnforced: false })
    await expect(getEntitlements('u1')).resolves.toBe(PRO_ENTITLEMENTS)
    expect(resolveUserPlan).toHaveBeenCalledWith('u1')
  })

  it('returns Free limits when the resolved plan is Free', async () => {
    resolveUserPlan.mockResolvedValue({ plan: 'free', status: 'canceled', isEnforced: true })
    await expect(getEntitlements('u1')).resolves.toBe(FREE_ENTITLEMENTS)
  })
})

describe('predicates at the Free thresholds', () => {
  const free = FREE_ENTITLEMENTS
  const pro = PRO_ENTITLEMENTS

  it('canUploadChart: true at 49 charts, false at 50', () => {
    expect(canUploadChart(free, { chartCount: 49 })).toBe(true)
    expect(canUploadChart(free, { chartCount: 50 })).toBe(false)
  })

  it('canUploadChart: Pro has no count limit but stops at the 2 GB abuse guard', () => {
    expect(canUploadChart(pro, { chartCount: 10_000 })).toBe(true)
    expect(canUploadChart(pro, { chartCount: 1, chartBytes: 2 * GB - 10, incomingBytes: 10 })).toBe(true)
    expect(canUploadChart(pro, { chartCount: 1, chartBytes: 2 * GB - 10, incomingBytes: 11 })).toBe(false)
  })

  it('canCreateCustomField: true at 1 field, false at 2; Pro unlimited', () => {
    expect(canCreateCustomField(free, 1)).toBe(true)
    expect(canCreateCustomField(free, 2)).toBe(false)
    expect(canCreateCustomField(pro, 500)).toBe(true)
  })

  it('canUploadAudio: Free never; Pro up to 1 GB', () => {
    expect(canUploadAudio(free, 0, 1)).toBe(false)
    expect(canUploadAudio(pro, GB - 10, 10)).toBe(true)
    expect(canUploadAudio(pro, GB - 10, 11)).toBe(false)
  })

  it('canCreateApiToken and canUseSetlistPlayer follow the plan flags', () => {
    expect(canCreateApiToken(free)).toBe(false)
    expect(canCreateApiToken(pro)).toBe(true)
    expect(canUseSetlistPlayer(free)).toBe(false)
    expect(canUseSetlistPlayer(pro)).toBe(true)
  })

  it('canDownloadSongOffline: true at 4 stored songs, false at 5; Pro unlimited', () => {
    expect(canDownloadSongOffline(free, 4)).toBe(true)
    expect(canDownloadSongOffline(free, 5)).toBe(false)
    expect(canDownloadSongOffline(pro, 5000)).toBe(true)
  })

  it('canDownloadAllOffline follows the plan flag', () => {
    expect(canDownloadAllOffline(free)).toBe(false)
    expect(canDownloadAllOffline(pro)).toBe(true)
  })
})
