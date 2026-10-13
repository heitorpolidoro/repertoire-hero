import type { SongStatus } from '@/types/database'

/**
 * RH-158 — the two Server Actions the per-song "Practised" button needs,
 * injected by `/playlists/[id]` (F21). Both take a list so the later
 * whole-playlist review reuses them unchanged; the band id is the playlist's, and
 * the action applies the admin rule to it.
 */
export interface PractiseActions {
  recordPractice(items: { versionId: string; status?: SongStatus }[], bandId?: string | null): Promise<void>
  recordPracticeStatus(items: { versionId: string; status: SongStatus }[], bandId?: string | null): Promise<void>
}

export interface UsePractiseSongOptions {
  actions: PractiseActions
  bandId: string | null
  /** The page's shared error banner. */
  setError: (message: string | null) => void
  onRefresh: () => void
}

export interface PractiseController {
  /** Resolves `true` when the date was written, `false` once the error is shown. */
  practise: (versionId: string) => Promise<boolean>
  /** The level chosen after the tap: status only, never the date. */
  practiseStatus: (versionId: string, status: SongStatus) => Promise<void>
}

/** Commands for the per-song "Practised" button; no state of their own. */
export function usePractiseSong({ actions, bandId, setError, onRefresh }: UsePractiseSongOptions): PractiseController {
  const practise = async (versionId: string) => {
    setError(null)
    try {
      await actions.recordPractice([{ versionId }], bandId)
      onRefresh()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record practice')
      return false
    }
  }

  const practiseStatus = async (versionId: string, status: SongStatus) => {
    try {
      await actions.recordPracticeStatus([{ versionId, status }], bandId)
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status')
    }
  }

  return { practise, practiseStatus }
}
