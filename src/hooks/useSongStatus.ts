import { useCallback, useState } from 'react'
import { statusUpdatedMessage, type SongStatusController } from '@/lib/songStatus'
import type { ToastTone } from '@/lib/uiTones'
import type { Repertoire, SongStatus } from '@/types/database'

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
  entry: Repertoire | null
  /** Required, never defaulted — see `src/app/fastViewEntryActions.ts` (F21). */
  actions: SongStatusActions
  /** The page passes `song.applyStatus`, so the header re-renders at once. */
  onStatusSaved: (status: SongStatus) => void
  /** `showToast` from the page's `useToast`. */
  notify: (message: string, tone: ToastTone) => void
}

/**
 * Fast View's status controller: the dropdown's open state, the in-flight flag
 * and the write itself, which reports through the page's one Toast (RH-52).
 */
export function useSongStatus({
  entry,
  actions,
  onStatusSaved,
  notify,
}: UseSongStatusOptions): SongStatusController {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [updating, setUpdating] = useState(false)

  const toggleDropdown = useCallback(() => setIsDropdownOpen((prev) => !prev), [])
  const closeDropdown = useCallback(() => setIsDropdownOpen(false), [])

  const change = useCallback(
    async (next: SongStatus) => {
      if (!entry) return
      try {
        setUpdating(true)
        await actions.updateStatus(entry.id, next, entry.band_id)
        onStatusSaved(next)
        setIsDropdownOpen(false)
        notify(statusUpdatedMessage(next), 'success')
      } catch {
        // The reason never reaches the user beyond this Toast; the dropdown
        // stays open, so a retry is one more tap.
        notify('Failed to update status', 'error')
      } finally {
        setUpdating(false)
      }
    },
    [actions, entry, notify, onStatusSaved],
  )

  return {
    status: entry?.status ?? 'unknown',
    updating,
    isDropdownOpen,
    toggleDropdown,
    closeDropdown,
    change,
  }
}
