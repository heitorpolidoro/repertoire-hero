import { DEFAULT_BAND_COLOR } from '@/lib/bandColors'
import type { BandContext } from '@/store/bandContextStore'
import type { BandOption } from '@/types/database'

/**
 * What a persisted band context should become once the authoritative band list
 * has arrived (RH-98).
 *
 * - `keep` — personal context, or a band whose name and colour already match.
 * - `refresh` — the band is still there under a different name or colour.
 * - `reset` — the band is gone from the list: the user left it, was removed
 *   from it, or it was deleted. Staying on it makes every band-scoped read and
 *   write fail server-side with `Access denied: not a member of this band`.
 */
export type BandContextDecision =
  | { action: 'keep' }
  | { action: 'refresh'; id: string; name: string; color: string }
  | { action: 'reset' }

/**
 * Decides the reconciliation from the persisted context plus the fetched list.
 *
 * Pure on purpose: the caller (`AppShell`) only applies the outcome, and the
 * `BandContext`/`BandOption` imports are types only so no zustand store and no
 * `pg`-backed module is pulled in.
 *
 * The list must be an authoritative, *resolved* one — an empty list means the
 * user is in no band at all and resets a band context. A failed fetch is not a
 * decision this function can make and must not reach it.
 */
export function reconcileBandContext(
  context: BandContext,
  bands: BandOption[]
): BandContextDecision {
  if (context.type !== 'band') return { action: 'keep' }

  const fetched = bands.find((band) => band.id === context.id)
  if (!fetched) return { action: 'reset' }

  // A row with no colour renders as DEFAULT_BAND_COLOR, which is what the
  // store already holds — comparing the raw `null` would refresh on every load.
  const color = fetched.color ?? DEFAULT_BAND_COLOR
  if (fetched.name === context.name && color === context.color) return { action: 'keep' }

  return { action: 'refresh', id: fetched.id, name: fetched.name, color }
}
