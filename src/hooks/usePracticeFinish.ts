import { useState } from 'react'
import { usePracticeReview, type PracticeReviewController, type PracticeReviewLevels } from '@/hooks/usePracticeReview'
import { invalidateSongWindow } from '@/lib/songWindow'
import type { SongQueueEntry } from '@/lib/songQueue'
import type { ToastTone } from '@/lib/uiTones'
import type { Repertoire, SongStatus } from '@/types/database'

/** The two Server Actions the finish flow needs, injected by the Fast View page (F21). */
export interface PracticeFinishActions {
  getRepertoire(bandId?: string | null): Promise<Repertoire[]>
  recordPractice(
    items: { versionId: string; status?: SongStatus }[],
    bandId?: string | null,
    presentUserIds?: string[],
  ): Promise<void>
}

export interface UsePracticeFinishOptions {
  actions: PracticeFinishActions
  /** The page's only owner value (`?bandId=`). */
  bandId: string | null
  currentVersionId: string
  /** Every queue entry, in queue order. */
  entries: SongQueueEntry[]
  /** The next entry's version id; `null` on the last entry. `undefined` when there is no queue. */
  nextId: string | null | undefined
  offline: boolean
  /** Shows the page's Toast. */
  notify: (message: string, tone?: ToastTone) => void
  /** Applies a changed level of the current song to the page's header. */
  applyStatus: (status: SongStatus) => void
}

export interface PracticeFinishController {
  /** Whether the "Finish practice" control shows. */
  visible: boolean
  isOpen: boolean
  loading: boolean
  rows: SongQueueEntry[]
  levels: PracticeReviewLevels
  review: PracticeReviewController
  open: () => Promise<void>
  close: () => void
}

const NO_LEVELS: PracticeReviewLevels = new Map()

/**
 * RH-169 - finishing a practice session from Fast View: the control on the last
 * queue entry, the one repertoire read when the list opens, and the batched
 * write through `usePracticeReview`.
 */
export function usePracticeFinish({
  actions,
  bandId,
  currentVersionId,
  entries,
  nextId,
  offline,
  notify,
  applyStatus,
}: UsePracticeFinishOptions): PracticeFinishController {
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [levels, setLevels] = useState<PracticeReviewLevels>(NO_LEVELS)

  const visible = !offline && nextId === null && entries.length > 0
  const close = () => setIsOpen(false)

  const recordPractice: PracticeFinishActions['recordPractice'] = async (items, owner) => {
    await actions.recordPractice(items, owner)
    items.forEach(item => invalidateSongWindow(item.versionId))
    const current = items.find(item => item.versionId === currentVersionId)
    if (current?.status) applyStatus(current.status)
  }

  const review = usePracticeReview({
    rows: entries,
    recordPractice,
    bandId,
    setError: message => message && notify(message, 'error'),
    onRefresh: () => notify('Practice recorded', 'success'),
    onClose: close,
  })

  const open = async () => {
    if (loading) return
    setLoading(true)
    try {
      const repertoire = await actions.getRepertoire(bandId)
      setLevels(new Map(repertoire.map(row => [row.version_id, row])))
      review.reset()
      setIsOpen(true)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load your repertoire', 'error')
    } finally {
      setLoading(false)
    }
  }

  return { visible, isOpen, loading, rows: entries, levels, review, open, close }
}
