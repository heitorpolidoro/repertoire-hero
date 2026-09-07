import { updateLyricsAction, fetchLyricsAction, addSongAction } from '@/app/actions/repertoire'
import type { LyricsEditorActions } from '@/hooks/useLyricsEditor'

/**
 * The lyrics Server Actions injected into `useLyricsEditor` by the Fast View
 * page. Module-level, so the object identity is stable and no effect of the
 * controller can be restarted by a re-render (RH-51, following the
 * `src/app/bandAdminActions.ts` pattern from F21).
 *
 * A sibling of the tab and playlist composition roots rather than part of them:
 * these three actions come from `@/app/actions/repertoire`, so this file keeps
 * the "one Fast View controller family, one actions module" rule intact.
 */
export const LYRICS_EDITOR_ACTIONS: LyricsEditorActions = {
  updateLyrics: updateLyricsAction,
  fetchLyrics: fetchLyricsAction,
  addSong: addSongAction,
}
