import {
  addSongToPlaylistAction,
  getPlaylistWithSongsAction,
} from '@/app/actions/playlists'
import {
  addSongAction,
  createAndAddSongAction,
  searchGlobalSongsAction,
} from '@/app/actions/repertoire'
import type { SongPickerActions } from '@/hooks/useSongPicker'

/**
 * The five Server Actions the add-song picker calls, injected into
 * `useSongPicker` by `/playlists/[id]` (F21, following
 * `src/app/fastViewEntryActions.ts`). Module-level, so the object identity is
 * stable and the debounce effect cannot be restarted by a re-render.
 *
 * The Spotify half of the search is missing on purpose: `searchSpotify` is a
 * client `fetch` in `src/lib/spotify.ts`, not a Server Action, so the hook
 * imports it and nothing has to be carried across the import-direction line.
 */
export const SONG_PICKER_ACTIONS: SongPickerActions = {
  searchCatalog: searchGlobalSongsAction,
  addToRepertoire: addSongAction,
  createAndAddSong: createAndAddSongAction,
  addSongToPlaylist: addSongToPlaylistAction,
  getPlaylistWithSongs: getPlaylistWithSongsAction,
}
