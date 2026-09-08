import {
  getSongEntryAction,
  getPersonalEntryForSongAction,
  updateSongStatusAction,
  updateSongLinksAction,
  fetchUrlTitleAction,
} from '@/app/actions/repertoire'
import type { SongEntryActions } from '@/hooks/useSongEntry'
import type { SongLinksActions } from '@/hooks/useSongLinks'
import type { SongStatusActions } from '@/hooks/useSongStatus'

/**
 * The entry, status and link Server Actions injected into the three RH-52
 * controllers by the Fast View page. Module-level, so the object identities are
 * stable and the entry load effect cannot be restarted by a re-render (F21,
 * following `src/app/bandAdminActions.ts` and the three sibling Fast View
 * composition roots).
 *
 * All five come from `@/app/actions/repertoire`, so they are wired in this one
 * file rather than three.
 */
export const SONG_ENTRY_ACTIONS: SongEntryActions = {
  getSongEntry: getSongEntryAction,
  getPersonalEntryForSong: getPersonalEntryForSongAction,
}

export const SONG_STATUS_ACTIONS: SongStatusActions = {
  updateStatus: updateSongStatusAction,
}

export const SONG_LINKS_ACTIONS: SongLinksActions = {
  updateLinks: updateSongLinksAction,
  fetchUrlTitle: fetchUrlTitleAction,
}
