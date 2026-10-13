import { useCallback, useState } from 'react'
import { normalizeTuning, tuningSavedMessage, type SongTuningController } from '@/lib/songTuning'
import type { ToastTone } from '@/lib/uiTones'
import type { ResolvedSongEntry } from '@/types/database'

/**
 * The tuning Server Action the controller calls. Injected rather than imported,
 * so `src/hooks` never points back into the App Router tree (F21).
 */
export interface SongTuningActions {
  updateTuning: (repertoireId: string, tuning: string | null, bandId: string | null) => Promise<void>
}

export interface UseSongTuningOptions {
  /** The route's entry; null until it loads. Owned by `useSongEntry`. */
  entry: ResolvedSongEntry | null
  /** The page's `?bandId=`, threaded explicitly like `useSongStatus` (RH-132 §3d). */
  bandId: string | null
  /** Required, never defaulted — see `src/app/fastViewEntryActions.ts` (F21). */
  actions: SongTuningActions
  /** The page passes `song.applyTuning`, so the header re-renders at once. */
  onSaved: (tuning: string | null) => void
  /** `showToast` from the page's `useToast`. */
  notify: (message: string, tone: ToastTone) => void
}

/**
 * Fast View's tuning controller (RH-146): the in-flight flag and the write.
 * The value is trimmed and an empty result is written as `null`, which hands
 * resolution back to `song_versions.tuning`. A null `ownerRowId` refuses the
 * write: the control is already disabled and nothing is created from here.
 */
export function useSongTuning({
  entry,
  bandId,
  actions,
  onSaved,
  notify,
}: UseSongTuningOptions): SongTuningController {
  const [updating, setUpdating] = useState(false)

  const save = useCallback(
    async (input: string) => {
      if (!entry?.ownerRowId) return
      const ownerRowId = entry.ownerRowId
      const next = normalizeTuning(input)
      try {
        setUpdating(true)
        await actions.updateTuning(ownerRowId, next, bandId)
        onSaved(next)
        notify(tuningSavedMessage(next), 'success')
      } catch {
        // The reason never reaches the user beyond this Toast; the shown value is unchanged.
        notify('Failed to update tuning', 'error')
      } finally {
        setUpdating(false)
      }
    },
    [actions, bandId, entry, notify, onSaved],
  )

  return { tuning: entry?.tuning ?? null, updating, save }
}
