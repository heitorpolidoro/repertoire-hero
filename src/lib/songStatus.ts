/**
 * The typed status list Fast View's status dropdown renders, plus the message
 * its write reports (RH-52).
 *
 * `STATUS_OPTIONS` exists so the dropdown maps over a `SongStatus`-typed array
 * instead of `Object.entries(STATUS_CONFIG)`, whose keys widen to `string` and
 * forced the `as any` cast the page carried. `statusConfig.ts` stays the single
 * source of the labels and the colours; this module only re-shapes it.
 */

import { STATUS_CONFIG, STATUS_ORDER } from '@/lib/statusConfig'
import type { SongStatus } from '@/types/database'

/** One row of the status dropdown: the status itself, its label and its colour dot. */
export interface SongStatusOption {
  status: SongStatus
  label: string
  bgColor: string
}

/**
 * The five statuses in mastery order — the same order `STATUS_CONFIG`'s
 * insertion produced, so the dropdown renders exactly as it did before.
 */
export const STATUS_OPTIONS: SongStatusOption[] = STATUS_ORDER.map((status) => ({
  status,
  label: STATUS_CONFIG[status].label,
  bgColor: STATUS_CONFIG[status].bgColor,
}))

/** The success Toast of a status write, unchanged from the page's inline template. */
export function statusUpdatedMessage(status: SongStatus): string {
  return `Status updated to ${STATUS_CONFIG[status]?.label ?? status}`
}

/**
 * Everything `useSongStatus` exposes. Declared here, not in the hook, so the
 * presentational components can type it without importing `src/hooks`.
 */
export interface SongStatusController {
  /** `entry?.status ?? 'unknown'`. */
  status: SongStatus
  updating: boolean
  isDropdownOpen: boolean
  toggleDropdown: () => void
  closeDropdown: () => void
  change: (status: SongStatus) => Promise<void>
}
