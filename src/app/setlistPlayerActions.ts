import { getQueueSourcesAction } from '@/app/actions/audio'
import { getSongWindowAction } from '@/app/actions/repertoire'
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
  getSongDetails: async (versionId, bandId) => {
    try {
      const records = await getSongWindowAction([versionId], bandId)
      const record = records[0]
      if (!record) return { tuning: null, customFields: [] }
      const tuning = record.entry?.tuning ?? null
      const customFields = (record.customFields ?? [])
        .filter(
          (f): f is { fieldId: string; name: string; value: string } =>
            typeof f.value === 'string' && f.value.trim() !== '',
        )
        .map((f) => ({ name: f.name, value: f.value }))
      return { tuning, customFields }
    } catch {
      return { tuning: null, customFields: [] }
    }
  },
}
