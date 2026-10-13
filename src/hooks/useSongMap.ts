import { useCallback, useState } from 'react'
import {
  addDraftSection,
  draftToMap,
  mapSavedMessage,
  mapToDraft,
  moveDraftSection,
  parseSongMap,
  removeDraftSection,
  renameDraftSection,
  type SongMapController,
  type SongSectionDraft,
} from '@/lib/songMap'
import type { ToastTone } from '@/lib/uiTones'
import type { ResolvedSongEntry, SongMap } from '@/types/database'

/**
 * The map Server Action the controller calls. Injected rather than imported,
 * so `src/hooks` never points back into the App Router tree (F21).
 */
export interface SongMapActions {
  updateMap: (repertoireId: string, map: SongMap | null, bandId: string | null) => Promise<void>
}

export interface UseSongMapOptions {
  /** The route's entry; null until it loads. Owned by `useSongEntry`. */
  entry: ResolvedSongEntry | null
  /** The page's `?bandId=`, threaded explicitly like `useSongStatus` (RH-132 §3d). */
  bandId: string | null
  /** Required, never defaulted - see `src/app/fastViewEntryActions.ts` (F21). */
  actions: SongMapActions
  /** The page passes `song.applyMap`, so the section re-renders at once. */
  onSaved: (map: SongMap | null) => void
  /** `showToast` from the page's `useToast`. */
  notify: (message: string, tone: ToastTone) => void
}

/**
 * Fast View's map controller (RH-118): the editor draft, the write and the
 * "Use the original" reset. Writing `null` clears the owner's override and
 * sends resolution back to the version or song map. A null `ownerRowId`
 * refuses every write: the controls are disabled and nothing is created here.
 */
export function useSongMap({ entry, bandId, actions, onSaved, notify }: UseSongMapOptions): SongMapController {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<SongSectionDraft[]>([])
  const [updating, setUpdating] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)

  const map = parseSongMap(entry?.map ?? null)
  const ownerRowId = entry?.ownerRowId ?? null

  // Resolves true when the write landed; the caller decides what closes.
  const write = useCallback(
    async (next: SongMap | null): Promise<boolean> => {
      if (!ownerRowId) return false
      try {
        setUpdating(true)
        await actions.updateMap(ownerRowId, next, bandId)
        onSaved(next)
        notify(mapSavedMessage(next), 'success')
        return true
      } catch {
        // The reason never reaches the user beyond this Toast; the shown map is unchanged.
        notify('Failed to update map', 'error')
        return false
      } finally {
        setUpdating(false)
      }
    },
    [actions, bandId, notify, onSaved, ownerRowId],
  )

  const startEdit = useCallback(() => {
    if (!ownerRowId) return
    setDraft(mapToDraft(map))
    setEditing(true)
  }, [map, ownerRowId])

  const save = useCallback(async () => {
    if (await write(draftToMap(draft))) setEditing(false)
  }, [draft, write])

  const confirmReset = useCallback(async () => {
    await write(null)
    setConfirmingReset(false)
  }, [write])

  return {
    map,
    overridden: entry?.mapOverridden ?? false,
    editing,
    draft,
    updating,
    confirmingReset,
    startEdit,
    cancelEdit: () => setEditing(false),
    addSection: () => setDraft(addDraftSection),
    removeSection: (index) => setDraft((prev) => removeDraftSection(prev, index)),
    editSection: (index, patch) => setDraft((prev) => renameDraftSection(prev, index, patch)),
    moveSection: (index, direction) => setDraft((prev) => moveDraftSection(prev, index, direction)),
    save,
    requestReset: () => setConfirmingReset(ownerRowId !== null),
    cancelReset: () => setConfirmingReset(false),
    confirmReset,
  }
}
