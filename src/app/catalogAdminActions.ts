import {
  deleteSongVersionAction,
  getCatalogBlastRadiusAction,
  mergeSongVersionsAction,
  mergeSongsAction,
  splitSongVersionsAction,
} from '@/app/actions/catalogAdmin'
import type { CatalogAdminActions } from '@/lib/catalogAdminPlan'

/**
 * Composition root for the /admin/catalog island (RH-156): the page owns the
 * Server Actions and injects them, so `src/components` and `src/hooks` never
 * import from `@/app/*` (F21).
 */
export const CATALOG_ADMIN_ACTIONS: CatalogAdminActions = {
  getBlastRadius: getCatalogBlastRadiusAction,
  mergeSongVersions: mergeSongVersionsAction,
  deleteSongVersion: deleteSongVersionAction,
  splitSongVersions: splitSongVersionsAction,
  mergeSongs: mergeSongsAction,
}
