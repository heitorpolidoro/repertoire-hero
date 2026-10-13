import type { Dispatch } from 'react'
import type { PlaylistPanelAction } from '@/lib/playlistPanels'
import { usePracticeReview, type UsePracticeReviewOptions } from '@/hooks/usePracticeReview'

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
