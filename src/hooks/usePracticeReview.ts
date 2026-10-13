import { useState } from 'react'
import type { PractiseActions } from '@/hooks/usePractiseSong'
import type { SongStatus } from '@/types/database'

/** One reviewable song: the plain shape both the playlist page and a Fast View queue can supply. */
export interface PracticeReviewRow {
  versionId: string
  title: string
  artist: string | null
}

/** What the list reads a row's current level from; absent means unassessed. */
export type PracticeReviewLevels = ReadonlyMap<string, { status: SongStatus }>

export interface UsePracticeReviewOptions {
  /** Every row of the review — all of them, never a filtered subset. */
  rows: PracticeReviewRow[]
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
 * RH-159, RH-169 — state of a practice review (a playlist or a Fast View
 * queue): which rows are ticked, which levels the user changed, and the single
 * batched write on Confirm.
 */
export function usePracticeReview({
  rows,
  recordPractice,
  bandId,
  setError,
  onRefresh,
  onClose,
}: UsePracticeReviewOptions): PracticeReviewController {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [levels, setLevels] = useState<ReadonlyMap<string, SongStatus>>(new Map())
  const [submitting, setSubmitting] = useState(false)

  const allTicked = rows.length > 0 && rows.every(r => ticked.has(r.versionId))

  const toggle = (versionId: string) =>
    setTicked(prev => {
      const next = new Set(prev)
      if (!next.delete(versionId)) next.add(versionId)
      return next
    })

  const toggleAll = () => setTicked(allTicked ? new Set() : new Set(rows.map(r => r.versionId)))

  const setLevel = (versionId: string, status: SongStatus) =>
    setLevels(prev => new Map(prev).set(versionId, status))

  const reset = () => {
    setTicked(new Set())
    setLevels(new Map())
  }

  const confirm = async () => {
    const items = rows
      .filter(r => ticked.has(r.versionId))
      .map(r => {
        const status = levels.get(r.versionId)
        return status === undefined ? { versionId: r.versionId } : { versionId: r.versionId, status }
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
