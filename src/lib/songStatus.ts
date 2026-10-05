/**
 * The message a Fast View status write reports (RH-52), and the shape of the
 * controller behind the control that triggers it.
 *
 * The `STATUS_OPTIONS`/`SongStatusOption` pair that used to live here existed
 * only so the status dropdown could map a `SongStatus`-typed array; RH-102
 * replaced that dropdown with the four-note control, which enumerates note
 * indexes instead, so both are gone.
 */

import { STATUS_CONFIG } from '@/lib/statusConfig'
import type { SongStatus } from '@/types/database'

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
  /** A write in flight; the control binds it to `busy`. */
  updating: boolean
  change: (status: SongStatus) => Promise<void>
}
