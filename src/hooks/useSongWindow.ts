import { useCallback, useEffect } from 'react'
import { logger } from '@/lib/logger'
import { readSongQueue } from '@/lib/songQueue'
import {
  fetchSongWindow,
  invalidateSongWindow,
  windowVersionIds,
  type SongWindowRecord,
} from '@/lib/songWindow'

/**
 * The window Server Action the controller calls. Injected rather than imported,
 * so `src/hooks` never points back into the App Router tree (F21).
 */
export interface SongWindowActions {
  getSongWindow: (versionIds: string[], bandId: string | null) => Promise<SongWindowRecord[]>
}

export interface UseSongWindowOptions {
  /** The route's `song_versions.id`. */
  versionId: string
  /** The page's `?bandId=`. */
  bandId: string | null
  /** Required, never defaulted - see `src/app/fastViewEntryActions.ts` (F21). */
  actions: SongWindowActions
}

export interface SongWindowController {
  /** Drops the current song's cached copy; call it after any successful write. */
  invalidateCurrent: () => void
  /**
   * `fn`, followed by the invalidation. The page wraps each write's success
   * callback with it, so the five write sites share one rule and none of them
   * grows cache logic of its own.
   */
  afterWrite: <A extends unknown[]>(fn?: (...args: A) => void) => (...args: A) => void
}

/**
 * Fast View's window controller (RH-134): when the current song or the queue
 * changes it asks for the previous, current and next songs in one request, for
 * the ids not cached yet. Best-effort: a failure is logged and swallowed, and
 * the per-song loads then go to the network exactly as they did before.
 *
 * The decisions live in `@/lib/songWindow`; `useSongEntry` and `useTabLibrary`
 * read the cache it fills.
 */
export function useSongWindow({ versionId, bandId, actions }: UseSongWindowOptions): SongWindowController {
  useEffect(() => {
    const ids = windowVersionIds(readSongQueue()?.entries ?? [], versionId)
    fetchSongWindow(bandId, ids, (missing) => actions.getSongWindow(missing, bandId)).catch((error) => {
      logger.error(
        'Failed to prefetch the song window',
        error instanceof Error ? error : new Error(String(error)),
      )
    })
  }, [actions, bandId, versionId])

  const invalidateCurrent = useCallback(() => invalidateSongWindow(versionId), [versionId])

  const afterWrite = useCallback(
    <A extends unknown[]>(fn?: (...args: A) => void) =>
      (...args: A) => {
        fn?.(...args)
        invalidateSongWindow(versionId)
      },
    [versionId],
  )

  return { invalidateCurrent, afterWrite }
}
