/**
 * RH-79 — the two strings both offline controls show, pinned without a DOM.
 *
 * `formatDownloadedAgo` takes `now` as an argument, so this suite needs no fake
 * timer and no mock.
 */
import { describe, it, expect } from 'vitest'
import { formatDownloadedAgo, formatOfflineBytes, readOfflineQuota } from '@/lib/offlineFormat'

const DAY = 86_400_000

describe('formatOfflineBytes', () => {
  it('scales from bytes to gigabytes', () => {
    expect(formatOfflineBytes(0)).toBe('0 B')
    expect(formatOfflineBytes(412)).toBe('412 B')
    expect(formatOfflineBytes(412_003)).toBe('412 KB')
    expect(formatOfflineBytes(48_300_000)).toBe('48.3 MB')
    expect(formatOfflineBytes(2_000_000_000)).toBe('2.0 GB')
  })

  it('never reports a negative size', () => {
    expect(formatOfflineBytes(-5)).toBe('0 B')
  })
})

describe('formatDownloadedAgo', () => {
  const now = Date.parse('2026-09-20T18:00:00Z')

  it('reads as today, yesterday, or a number of days', () => {
    expect(formatDownloadedAgo('2026-09-20T09:00:00Z', now)).toBe('today')
    expect(formatDownloadedAgo('2026-09-19T09:00:00Z', now)).toBe('yesterday')
    expect(formatDownloadedAgo('2026-09-11T09:00:00Z', now)).toBe('9 days ago')
  })

  it('treats a copy dated in the future as today rather than as a negative count', () => {
    expect(formatDownloadedAgo('2026-09-21T09:00:00Z', now)).toBe('today')
    expect(formatDownloadedAgo(new Date(now + DAY).toISOString(), now)).toBe('today')
  })

  it('reads an unparseable date as unknown', () => {
    expect(formatDownloadedAgo('not a date', now)).toBe('unknown')
  })
})

describe('readOfflineQuota', () => {
  it('reports the estimate when the browser gives a numeric quota', async () => {
    const quota = await readOfflineQuota({
      estimate: () => Promise.resolve({ usage: 142_000_000, quota: 2_000_000_000 }),
    })

    expect(quota).toEqual({ usedBytes: 142_000_000, quotaBytes: 2_000_000_000 })
  })

  it('reads a missing usage as zero', async () => {
    expect(await readOfflineQuota({ estimate: () => Promise.resolve({ quota: 10 }) })).toEqual({
      usedBytes: 0,
      quotaBytes: 10,
    })
  })

  it('declines — the line is omitted — for every way the browser can decline', async () => {
    // No Storage API at all.
    expect(await readOfflineQuota(undefined)).toBeNull()
    expect(await readOfflineQuota({})).toBeNull()
    // An estimate carrying no quota.
    expect(await readOfflineQuota({ estimate: () => Promise.resolve({ usage: 1 }) })).toBeNull()
    // An estimate that rejects.
    expect(await readOfflineQuota({ estimate: () => Promise.reject(new Error('denied')) })).toBeNull()
  })
})
