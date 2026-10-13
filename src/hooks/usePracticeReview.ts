import { useState, type Dispatch } from 'react'
import type { PlaylistPanelAction } from '@/lib/playlistPanels'
import type { PractiseActions } from '@/hooks/usePractiseSong'
import type { PlaylistSong, SongStatus } from '@/types/database'

export interface UsePracticeReviewOptions {
  /** The playlist's songs — all of them, never the tag/text-filtered subset. */
  songs: PlaylistSong[]
  recordPractice: PractiseActions['recordPractice']
  bandId: string | null
  /** The page's shared error banner. */
  setError: (message: string | null) => void
  onRefresh: () => void
  /** Closes the list after a successful confirm. */
  onClose?: () => void
}

export interface PracticeReviewController {
  /** Version ids currently ticked. */
  ticked: ReadonlySet<string>
  /** Levels the user explicitly changed; absent rows keep their current status. */
  levels: ReadonlyMap<string, SongStatus>
  allTicked: boolean
  submitting: boolean
  toggle: (versionId: string) => void
  /** Ticks every row when any is unticked, otherwise unticks every row. */
  toggleAll: () => void
  setLevel: (versionId: string, status: SongStatus) => void
  /** Empties ticks and changed levels; called on every open. */
  reset: () => void
  confirm: () => Promise<void>
}

/**
 * RH-159 — state of the whole-playlist practice review: which rows are ticked,
 * which levels the user changed, and the single batched write on Confirm.
 */
export function usePracticeReview({
  songs,
  recordPractice,
  bandId,
  setError,
  onRefresh,
  onClose,
}: UsePracticeReviewOptions): PracticeReviewController {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [levels, setLevels] = useState<ReadonlyMap<string, SongStatus>>(new Map())
  const [submitting, setSubmitting] = useState(false)

  const allTicked = songs.length > 0 && songs.every(ps => ticked.has(ps.version_id))

  const toggle = (versionId: string) =>
    setTicked(prev => {
      const next = new Set(prev)
      if (!next.delete(versionId)) next.add(versionId)
      return next
    })

  const toggleAll = () => setTicked(allTicked ? new Set() : new Set(songs.map(ps => ps.version_id)))

  const setLevel = (versionId: string, status: SongStatus) =>
    setLevels(prev => new Map(prev).set(versionId, status))

  const reset = () => {
    setTicked(new Set())
    setLevels(new Map())
  }

  const confirm = async () => {
    const items = songs
      .filter(ps => ticked.has(ps.version_id))
      .map(ps => {
        const status = levels.get(ps.version_id)
        return status === undefined ? { versionId: ps.version_id } : { versionId: ps.version_id, status }
      })
    if (items.length === 0 || submitting) return
    setError(null)
    setSubmitting(true)
    try {
      await recordPractice(items, bandId)
      onRefresh()
      onClose?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record practice')
    } finally {
      setSubmitting(false)
    }
  }

  return { ticked, levels, allTicked, submitting, toggle, toggleAll, setLevel, reset, confirm }
}

export interface UsePracticeReviewPanelOptions extends Omit<UsePracticeReviewOptions, 'onClose'> {
  /** The detail view's panel dispatch: the review is one of its panels. */
  dispatch: Dispatch<PlaylistPanelAction>
}

/**
 * The review wired to the detail view's panel state: closing is the panel's
 * `close`, and every open re-empties the ticks and changed levels.
 */
export function usePracticeReviewPanel({ dispatch, ...options }: UsePracticeReviewPanelOptions) {
  const practiceReview = usePracticeReview({ ...options, onClose: () => dispatch({ type: 'close' }) })
  const openPracticeReview = () => {
    practiceReview.reset()
    dispatch({ type: 'open-practice-review' })
  }
  return { practiceReview, openPracticeReview }
}
