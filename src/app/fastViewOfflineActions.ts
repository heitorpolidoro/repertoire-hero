import { offlineFirst } from '@/lib/offlineFirst'
import { PLAYLIST_NAV_ACTIONS } from '@/app/fastViewNavActions'
import { PDF_STAGE_ACTIONS, TAB_LIBRARY_ACTIONS } from '@/app/fastViewTabActions'
import { LYRICS_EDITOR_ACTIONS } from '@/app/fastViewLyricsActions'
import {
  SONG_ENTRY_ACTIONS,
  SONG_LINKS_ACTIONS,
  SONG_STATUS_ACTIONS,
} from '@/app/fastViewEntryActions'

/**
 * The Fast View's seven action bundles, made offline-first (RH-80).
 *
 * **The only place `offlineFirst(` is called outside its own module and tests.**
 * That is the whole point of the decorator: the offline read path is applied
 * once, here, at the composition root, and no controller under `src/hooks` and
 * no component under `src/components` learns that offline exists.
 *
 * Each constant is built at module scope, so the object identities are stable
 * across renders and none of the seven controllers' effects can be restarted by
 * a re-render — the `src/app/bandAdminActions.ts` rule (F21) the four sibling
 * `fastView*Actions.ts` files already follow. The Fast View page imports from
 * this file *instead of* those four; they are unchanged and keep their other
 * consumers.
 *
 * `src/app/offlineActions.ts` (the RH-79 download bundle) is deliberately not
 * wrapped: a download is meaningless with no network, and wrapping it would
 * make the download silently "succeed" against its own snapshot.
 *
 * No `ports` argument: production takes the defaults, `OFFLINE_STORE` and
 * `navigator.onLine`. Injection exists for the unit suite.
 */
export const OFFLINE_FIRST_PLAYLIST_NAV_ACTIONS = offlineFirst(PLAYLIST_NAV_ACTIONS)
export const OFFLINE_FIRST_TAB_LIBRARY_ACTIONS = offlineFirst(TAB_LIBRARY_ACTIONS)
export const OFFLINE_FIRST_PDF_STAGE_ACTIONS = offlineFirst(PDF_STAGE_ACTIONS)
export const OFFLINE_FIRST_LYRICS_EDITOR_ACTIONS = offlineFirst(LYRICS_EDITOR_ACTIONS)
export const OFFLINE_FIRST_SONG_ENTRY_ACTIONS = offlineFirst(SONG_ENTRY_ACTIONS)
export const OFFLINE_FIRST_SONG_STATUS_ACTIONS = offlineFirst(SONG_STATUS_ACTIONS)
export const OFFLINE_FIRST_SONG_LINKS_ACTIONS = offlineFirst(SONG_LINKS_ACTIONS)
