import { offlineFirst } from '@/lib/offlineFirst'
import { AUDIO_LIBRARY_ACTIONS, PDF_STAGE_ACTIONS, TAB_LIBRARY_ACTIONS } from '@/app/fastViewTabActions'
import { LYRICS_EDITOR_ACTIONS } from '@/app/fastViewLyricsActions'
import {
  SONG_ENTRY_ACTIONS,
  SONG_LINKS_ACTIONS,
  SONG_STATUS_ACTIONS,
  SONG_TUNING_ACTIONS,
  SONG_MAP_ACTIONS,
  SONG_WINDOW_ACTIONS,
} from '@/app/fastViewEntryActions'
import { SONG_CUSTOM_FIELDS_ACTIONS } from '@/app/customFieldActions'

/**
 * The Fast View's six action bundles, made offline-first (RH-80).
 *
 * **The only place `offlineFirst(` is called outside its own module and tests.**
 * That is the whole point of the decorator: the offline read path is applied
 * once, here, at the composition root, and no controller under `src/hooks` and
 * no component under `src/components` learns that offline exists.
 *
 * Each constant is built at module scope, so the object identities are stable
 * across renders and none of the six controllers' effects can be restarted by
 * a re-render — the `src/app/bandAdminActions.ts` rule (F21) the three sibling
 * `fastView*Actions.ts` files already follow. The Fast View page imports from
 * this file *instead of* those three; they are unchanged and keep their other
 * consumers.
 *
 * `src/app/offlineActions.ts` (the RH-79 download bundle) is deliberately not
 * wrapped: a download is meaningless with no network, and wrapping it would
 * make the download silently "succeed" against its own snapshot.
 *
 * No `ports` argument: production takes the defaults, `OFFLINE_STORE` and
 * `navigator.onLine`. Injection exists for the unit suite.
 */
/** Audio is not in the snapshot, so its bundle is passed through unwrapped (RH-162). */
export { AUDIO_LIBRARY_ACTIONS }
export const OFFLINE_FIRST_TAB_LIBRARY_ACTIONS = offlineFirst(TAB_LIBRARY_ACTIONS)
export const OFFLINE_FIRST_PDF_STAGE_ACTIONS = offlineFirst(PDF_STAGE_ACTIONS)
export const OFFLINE_FIRST_LYRICS_EDITOR_ACTIONS = offlineFirst(LYRICS_EDITOR_ACTIONS)
export const OFFLINE_FIRST_SONG_ENTRY_ACTIONS = offlineFirst(SONG_ENTRY_ACTIONS)
export const OFFLINE_FIRST_SONG_STATUS_ACTIONS = offlineFirst(SONG_STATUS_ACTIONS)
export const OFFLINE_FIRST_SONG_TUNING_ACTIONS = offlineFirst(SONG_TUNING_ACTIONS)
export const OFFLINE_FIRST_SONG_MAP_ACTIONS = offlineFirst(SONG_MAP_ACTIONS)
export const OFFLINE_FIRST_SONG_LINKS_ACTIONS = offlineFirst(SONG_LINKS_ACTIONS)
// RH-134. Unclassified in `offlineFirst` on purpose: offline the window is
// refused and never answered from a snapshot.
export const OFFLINE_FIRST_SONG_WINDOW_ACTIONS = offlineFirst(SONG_WINDOW_ACTIONS)
// RH-186. Offline the read is answered from the snapshot; the set is refused.
export const OFFLINE_FIRST_SONG_CUSTOM_FIELDS_ACTIONS = offlineFirst(SONG_CUSTOM_FIELDS_ACTIONS)
