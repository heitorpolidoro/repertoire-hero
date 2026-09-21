import { getPlaylistDetailsWithEntriesAction } from '@/app/actions/playlists'
import { getSongEntryAction } from '@/app/actions/repertoire'
import { getTabsAction } from '@/app/actions/tabs'
import type { OfflineDownloadActions } from '@/hooks/useOfflinePlaylist'

/**
 * The Server Actions the offline download reads through (RH-79).
 *
 * Module-level, so the object identity is stable and the download controller's
 * mount read cannot be restarted by a re-render (the
 * `src/app/bandAdminActions.ts` pattern from F21).
 *
 * All three already exist: an offline copy is the same three reads Fast View
 * makes online, taken once and written down. No new action and no new SQL.
 * `getPersonalEntryForSong` is deliberately not among them — the member's own
 * repertoire row is not captured (docs/tasks/RH-80-spec.md §1).
 */
export const OFFLINE_DOWNLOAD_ACTIONS: OfflineDownloadActions = {
  getPlaylistDetailsWithEntries: getPlaylistDetailsWithEntriesAction,
  getSongEntry: getSongEntryAction,
  getTabs: getTabsAction,
}
