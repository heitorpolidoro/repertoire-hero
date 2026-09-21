/**
 * How the offline surfaces spell a size, a date and the quota line (RH-79).
 *
 * Both controls — the playlist's "Available offline" button and the `/settings`
 * storage section — show the same two things, so the decisions live here rather
 * than twice inside two components, and are unit-tested with no DOM. Pure: the
 * relative time takes `now` as an argument instead of reading the clock.
 */

/** A stored size as a musician reads it: `412 KB`, `48.3 MB`, `1.2 GB`. */
export function formatOfflineBytes(bytes: number): string {
  if (bytes < 1_000) return `${Math.max(0, Math.round(bytes))} B`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

/**
 * How long ago the copy was taken: `today`, `yesterday`, `N days ago`.
 *
 * Deliberately coarse. The snapshot is a photograph with a date, and a musician
 * deciding whether to refresh before a gig needs the day, not the minute. An
 * unparseable `savedAt` reads as `unknown`, never as `NaN days ago`.
 */
export function formatDownloadedAgo(savedAt: string, now: number): string {
  const saved = Date.parse(savedAt)
  if (Number.isNaN(saved)) return 'unknown'
  const days = Math.floor((now - saved) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/** How much of the browser's quota is in use, when it will say. */
export interface OfflineQuota {
  usedBytes: number
  quotaBytes: number
}

/** Just enough of `navigator.storage` to ask it for an estimate. */
export interface StorageEstimateSource {
  estimate?: () => Promise<{ usage?: number; quota?: number }>
}

/**
 * The secondary "x of y used" line, or `null`.
 *
 * `null` covers every way the browser can decline — the API is absent, the
 * estimate rejects, or it resolves without a numeric `quota` — because all
 * three lead to the same place: the line is omitted entirely. No placeholder,
 * no spinner, and the total beside it is unaffected, since that total is the
 * sum of the stored records and never this number.
 *
 * Takes the storage object rather than reading `navigator` itself, so it is
 * testable without a DOM and the module stays free of platform globals.
 */
export async function readOfflineQuota(
  storage: StorageEstimateSource | undefined,
): Promise<OfflineQuota | null> {
  if (!storage?.estimate) return null
  try {
    const estimate = await storage.estimate()
    if (typeof estimate.quota !== 'number') return null
    return { usedBytes: estimate.usage ?? 0, quotaBytes: estimate.quota }
  } catch {
    // A browser that refuses to answer is the same as one that cannot.
    return null
  }
}
