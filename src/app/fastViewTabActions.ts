import { getTabsAction, uploadTabAction, deleteTabAction } from '@/app/actions/tabs'
import { addSongAction } from '@/app/actions/repertoire'
import type { TabLibraryActions } from '@/hooks/useTabLibrary'

/**
 * The tab Server Actions injected into `useTabLibrary` by the Fast View page.
 * Module-level, so the object identity is stable and the hook's fetch effects
 * cannot be restarted by a re-render (RH-49, following the
 * `src/app/bandAdminActions.ts` pattern from F21).
 */
export const TAB_LIBRARY_ACTIONS: TabLibraryActions = {
  getTabs: getTabsAction,
  uploadTab: uploadTabAction,
  deleteTab: deleteTabAction,
  addSong: addSongAction,
}
