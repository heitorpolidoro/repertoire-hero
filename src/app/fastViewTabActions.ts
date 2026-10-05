import {
  getTabsAction,
  uploadTabAction,
  deleteTabAction,
  getTabAnnotationsAction,
  saveTabAnnotationsAction,
} from '@/app/actions/tabs'
import type { TabLibraryActions } from '@/hooks/useTabLibrary'
import type { PdfStageActions } from '@/hooks/usePdfStage'

/**
 * The file Server Actions injected into `useTabLibrary` by the Fast View page.
 * Module-level, so the object identity is stable and the hook's fetch effect
 * cannot be restarted by a re-render (RH-49, following the
 * `src/app/bandAdminActions.ts` pattern from F21).
 *
 * `addSong` is gone since RH-123: `uploadTabAction` ensures the uploader's own
 * repertoire row itself and reports it in the upload envelope, so the hook no
 * longer needs a second action to create one.
 */
export const TAB_LIBRARY_ACTIONS: TabLibraryActions = {
  getTabs: getTabsAction,
  uploadTab: uploadTabAction,
  deleteTab: deleteTabAction,
}

/**
 * The annotation Server Actions injected into `usePdfStage` by the Fast View
 * page. They come from the same module as the four above, so they are wired in
 * this one Fast View tab composition root rather than in a sibling file.
 * Module-level for the same stable-identity reason (RH-50).
 */
export const PDF_STAGE_ACTIONS: PdfStageActions = {
  getAnnotations: getTabAnnotationsAction,
  saveAnnotations: saveTabAnnotationsAction,
}
