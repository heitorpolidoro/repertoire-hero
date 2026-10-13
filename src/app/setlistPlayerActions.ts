import { getQueueSourcesAction } from '@/app/actions/audio'
import type { SetlistPlayerActions } from '@/hooks/useSetlistPlayer'
import { loadPlaybackFacts } from '@/lib/spotifyWebPlayback'

/**
 * The setlist player's reads, injected by `AppShell` (F21). Sources come from
 * one Server Action; Spotify readiness reuses the RH-164 playback-token route
 * through its client fetcher. Module-level, so the identity is stable.
 */
export const SETLIST_PLAYER_ACTIONS: SetlistPlayerActions = {
  getSources: getQueueSourcesAction,
  loadFacts: loadPlaybackFacts,
}
