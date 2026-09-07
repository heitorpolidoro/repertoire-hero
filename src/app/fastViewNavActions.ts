import { getPlaylistDetailsWithEntriesAction } from '@/app/actions/playlists'
import type { PlaylistNavActions } from '@/hooks/usePlaylistNav'

/**
 * The playlist Server Action injected into `usePlaylistNav` by the Fast View
 * page. Module-level, so the object identity is stable and the hook's setlist
 * effect cannot be restarted by a re-render (RH-48, following the
 * `src/app/bandAdminActions.ts` pattern from F21).
 */
export const PLAYLIST_NAV_ACTIONS: PlaylistNavActions = {
  getPlaylistDetailsWithEntries: getPlaylistDetailsWithEntriesAction,
}
