import { getPlaylistDetailsWithEntriesAction } from '@/app/actions/playlists'
import {
  getPersonalEntryForSongAction,
  getResolvedEntryForVersionAction,
} from '@/app/actions/repertoire'
import { getTabsAction } from '@/app/actions/tabs'
import { getCustomFieldValuesAction } from '@/app/actions/customFields'
import type { OfflineDownloadActions } from '@/hooks/useOfflinePlaylist'

/**
 * The Server Actions the offline download reads through (RH-79).
 *
 * Module-level, so the object identity is stable and the download controller's
 * mount read cannot be restarted by a re-render (the
 * `src/app/bandAdminActions.ts` pattern from F21).
 *
 * All four already exist: an offline copy is the same reads Fast View makes
 * online, taken once and written down. No new action and no new SQL. RH-132
 * swapped the entry read for the version-addressed one, so the capture covers
 * **every** entry of the playlist — including the versions the owner holds no
 * row for, which used to be skipped and then unreadable offline.
 * `getPersonalEntryForSong` joined them in RH-83, so the snapshot can answer
 * which lyrics version is being read (docs/tasks/RH-83-spec.md §5).
 * `getCustomFieldValues` joined them in RH-186, so Fast View offline shows the
 * reader's own custom field values read-only.
 */
export const OFFLINE_DOWNLOAD_ACTIONS: OfflineDownloadActions = {
  getPlaylistDetailsWithEntries: getPlaylistDetailsWithEntriesAction,
  getResolvedEntryForVersion: getResolvedEntryForVersionAction,
  getTabs: getTabsAction,
  getPersonalEntryForSong: getPersonalEntryForSongAction,
  getCustomFieldValues: getCustomFieldValuesAction,
}
