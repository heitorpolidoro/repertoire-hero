import { getPracticeCandidatesAction, getPracticePlaylistsAction } from '@/app/actions/practice'
import type { PracticeActions } from '@/hooks/usePracticeStart'

/**
 * The two read-only Server Actions behind "Start practice" (RH-168), injected
 * into `usePracticeStart` by `/bands/[id]` and the personal dashboard (F21).
 * Module-level so the object identity is stable. No write is bundled.
 */
export const PRACTICE_ACTIONS: PracticeActions = {
  getCandidates: getPracticeCandidatesAction,
  getPlaylists: getPracticePlaylistsAction,
}
