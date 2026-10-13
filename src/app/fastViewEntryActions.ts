import {
  getResolvedEntryForVersionAction,
  getPersonalEntryForSongAction,
  updateSongStatusAction,
  updateSongTuningAction,
  updateSongMapAction,
  updateSongLinksAction,
  fetchUrlTitleAction,
  getSongWindowAction,
} from '@/app/actions/repertoire'
import type { SongWindowActions } from '@/hooks/useSongWindow'
import type { SongEntryActions } from '@/hooks/useSongEntry'
import type { SongLinksActions } from '@/hooks/useSongLinks'
import type { SongStatusActions } from '@/hooks/useSongStatus'
import type { SongTuningActions } from '@/hooks/useSongTuning'
import type { SongMapActions } from '@/hooks/useSongMap'

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
  // Version-addressed since RH-132: the route carries a `song_versions.id` and
  // the owner comes from the page's `?bandId=`. The personal read beside it is
  // still song-keyed, deliberately (RH-132 §3a).
  getResolvedEntryForVersion: getResolvedEntryForVersionAction,
  getPersonalEntryForSong: getPersonalEntryForSongAction,
}

export const SONG_STATUS_ACTIONS: SongStatusActions = {
  updateStatus: updateSongStatusAction,
}

export const SONG_TUNING_ACTIONS: SongTuningActions = {
  updateTuning: updateSongTuningAction,
}

export const SONG_MAP_ACTIONS: SongMapActions = {
  updateMap: updateSongMapAction,
}

/**
 * The window read (RH-134). Offline-first wrapping leaves it unclassified on
 * purpose: offline it is refused, never served from a snapshot.
 */
export const SONG_WINDOW_ACTIONS: SongWindowActions = {
  getSongWindow: getSongWindowAction,
}

export const SONG_LINKS_ACTIONS: SongLinksActions = {
  updateLinks: updateSongLinksAction,
  fetchUrlTitle: fetchUrlTitleAction,
}
