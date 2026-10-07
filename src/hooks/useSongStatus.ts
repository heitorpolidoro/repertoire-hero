import { useCallback, useState } from 'react'
import { statusUpdatedMessage, type SongStatusController } from '@/lib/songStatus'
import type { ToastTone } from '@/lib/uiTones'
import type { ResolvedSongEntry, SongStatus } from '@/types/database'

/**
 * The status Server Action the controller calls. Injected rather than imported,
 * so `src/hooks` never points back into the App Router tree (F21).
 * Required and never defaulted — a default would have to import that tree.
 */
export interface SongStatusActions {
  updateStatus: (repertoireId: string, status: SongStatus, bandId: string | null) => Promise<void>
}

export interface UseSongStatusOptions {
  /** The route's entry; null until it loads. Owned by `useSongEntry`. */
  entry: ResolvedSongEntry | null
  /**
   * The page's `?bandId=`, threaded explicitly (RH-132 §3d).
   *
   * `ResolvedSongEntry` carries no `band_id`, and this must not be inferred as
   * null: `updateSongStatusAction` resolves the owner as `{ userId }` without
   * it, so `writeOwnerSongRow` would run
   * `UPDATE user_songs ... WHERE id = <the band row's id> AND user_id = ...`
   * and match nothing — a band admin tapping a mastery note would get a silent
   * no-op or "Failed to update status".
   */
  bandId: string | null
  /** Required, never defaulted — see `src/app/fastViewEntryActions.ts` (F21). */
  actions: SongStatusActions
  /** The page passes `song.applyStatus`, so the header re-renders at once. */
  onStatusSaved: (status: SongStatus) => void
  /** `showToast` from the page's `useToast`. */
  notify: (message: string, tone: ToastTone) => void
}

/**
 * Fast View's status controller: the in-flight flag and the write itself, which
 * reports through the page's one Toast (RH-52). There is no open state to keep
 * since RH-102 — the four notes are always on screen, so a status is one tap
 * rather than a tap to open and a tap to pick.
 *
 * Since RH-132 the write targets `entry.ownerRowId` and carries the page's
 * `bandId` option; `status` keeps absorbing a nullable stored status through
 * `?? 'unknown'`, which is what a version with no owner row reads as.
 */
export function useSongStatus({
  entry,
  bandId,
  actions,
  onStatusSaved,
  notify,
}: UseSongStatusOptions): SongStatusController {
  const [updating, setUpdating] = useState(false)

  const change = useCallback(
    async (next: SongStatus) => {
      // A null `ownerRowId` is "the addressed owner holds no row at this
      // version": there is nothing to update and nothing may be created from
      // Fast View, so the write is refused rather than issued against a
      // coerced id. The control itself is already disabled (RH-132 §3c).
      if (!entry?.ownerRowId) return
      const ownerRowId = entry.ownerRowId
      try {
        setUpdating(true)
        await actions.updateStatus(ownerRowId, next, bandId)
        onStatusSaved(next)
        notify(statusUpdatedMessage(next), 'success')
      } catch {
        // The reason never reaches the user beyond this Toast; the notes stay
        // on screen at the unchanged status, so a retry is one more tap.
        notify('Failed to update status', 'error')
      } finally {
        setUpdating(false)
      }
    },
    [actions, bandId, entry, notify, onStatusSaved],
  )

  return {
    status: entry?.status ?? 'unknown',
    updating,
    change,
  }
}
