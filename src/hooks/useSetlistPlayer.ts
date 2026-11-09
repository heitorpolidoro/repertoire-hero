import { useEffect, useState } from 'react'
import { OFFLINE_TEXT, skippedText, tapToPlayText, counterText, type SourceKind } from '@/lib/setlistPlayer'
import { cachedSong } from '@/lib/songWindow'
import type { CustomFieldEntry } from '@/types/customField'
import { useSetlistPlayerStore, type PlayerStatus } from '@/store/setlistPlayerStore'
import { createAudioEngine } from './setlistEngines/audioEngine'
import { createSpotifyEngine } from './setlistEngines/spotifyEngine'
import type { EngineFactories } from './setlistEngines/types'
import { createYoutubeEngine } from './setlistEngines/youtubeEngine'
import { SetlistRuntime, type SetlistPlayerActions } from './setlistEngines/runtime'

export type { SetlistPlayerActions } from './setlistEngines/runtime'

const DEFAULT_ENGINES: EngineFactories = {
  file: createAudioEngine,
  spotify: createSpotifyEngine,
  youtube: createYoutubeEngine,
}

/** How long an engine gets to report playing before the entry is left paused. */
export const REFUSAL_MS = 4000

export interface UseSetlistPlayerOptions {
  actions: SetlistPlayerActions
  offline: boolean
  /** Signed in: otherwise nothing renders and nothing is requested. */
  enabled: boolean
  /** Test seams; the defaults are the real engines. Read once, at mount. */
  engines?: EngineFactories
  refusalMs?: number
  countdownMs?: number
  onSongChange?: (versionId: string, bandId: string | null) => void
}

export interface SetlistPlayerController {
  enabled: boolean
  /** Hidden entirely until the first "Play setlist" tap, and after dismissal. */
  visible: boolean
  offline: boolean
  status: PlayerStatus
  kind: SourceKind | null
  title: string
  artist: string | null
  versionId: string | null
  bandId: string | null
  nextTitle: string | null
  counter: string
  /** The line under the title: offline, refusal, skip or end of queue. */
  message: string | null
  hasPrev: boolean
  hasNext: boolean
  countdown: number | null
  tuning: string | null
  customFields: Array<{ name: string; value: string }>
  skipCountdown: () => void
  cancelCountdown: () => void
  toggle: () => void
  next: () => void
  prev: () => void
  dismiss: () => void
}

/**
 * The setlist player's controller (RH-167). Mounted once by `AppShell`, above
 * the routes: it starts only from a store start request produced by a tap, and
 * a route change, a re-render or a queue change never touches a running player.
 */
export function useSetlistPlayer({
  actions,
  offline,
  enabled,
  engines = DEFAULT_ENGINES,
  refusalMs = REFUSAL_MS,
  countdownMs,
  onSongChange,
}: UseSetlistPlayerOptions) {
  const [runtime] = useState(() => new SetlistRuntime({ actions, engines, refusalMs, countdownMs, onSongChange }))
  const state = useSetlistPlayerStore()

  useEffect(() => {
    runtime.setOnSongChange(onSongChange)
  }, [onSongChange, runtime])

  useEffect(() => {
    runtime.setOffline(offline)
  }, [offline, runtime])

  const hasRequest = state.request !== null
  useEffect(() => {
    if (!hasRequest) return
    const request = useSetlistPlayerStore.getState().consumeRequest()
    if (request && enabled) void runtime.start(request)
  }, [hasRequest, enabled, runtime])

  useEffect(() => () => runtime.dispose(), [runtime])

  const current = state.entries[state.index]
  const currentVersionId = current ? current.versionId : null
  const meta = useCountdownMetadata(
    state.countdown,
    currentVersionId,
    state.bandId,
    actions.getSongDetails,
  )

  const controller = buildController({ enabled, offline }, state, meta, runtime)
  return { controller, bindAudio: runtime.setAudioNode, bindYoutube: runtime.setYoutubeNode }
}

function buildController(
  options: { enabled: boolean; offline: boolean },
  state: ReturnType<typeof useSetlistPlayerStore.getState>,
  meta: CountdownMeta,
  runtime: SetlistRuntime,
): SetlistPlayerController {
  const current = state.entries[state.index]
  const visible = options.enabled && state.status !== 'idle' && Boolean(current)

  return {
    enabled: options.enabled,
    visible,
    offline: options.offline,
    status: state.status,
    kind: state.kind,
    title: current?.title ?? '',
    artist: current?.artist ?? null,
    versionId: current?.versionId ?? null,
    bandId: state.bandId,
    nextTitle: state.entries[state.index + 1]?.title ?? null,
    counter: counterText(state.index, state.entries.length),
    message: messageFor(state, options.offline, current?.title ?? ''),
    hasPrev: state.index > 0,
    hasNext: state.index < state.entries.length - 1,
    countdown: state.countdown,
    tuning: meta.tuning,
    customFields: meta.customFields,
    skipCountdown: () => void runtime.skipCountdown(),
    cancelCountdown: () => runtime.cancelCountdown(),
    toggle: () => void runtime.toggle(),
    next: () => runtime.next(),
    prev: () => runtime.prev(),
    dismiss: () => runtime.dismiss(),
  }
}

interface CountdownMeta {
  tuning: string | null
  customFields: Array<{ name: string; value: string }>
}

interface SongMetaState {
  versionId: string | null
  bandId: string | null
  tuning: string | null
  customFields: Array<{ name: string; value: string }>
}

function filterCustomFields(
  fields?: Array<CustomFieldEntry | { name: string; value: string }>,
): Array<{ name: string; value: string }> {
  if (!fields) return []
  return fields
    .filter(
      (f): f is { name: string; value: string } =>
        typeof f.value === 'string' && f.value.trim() !== '',
    )
    .map((f) => ({ name: f.name, value: f.value }))
}

function extractCachedDetails(bandId: string | null, versionId: string | null): CountdownMeta | null {
  if (!versionId) return null
  const cached = cachedSong(bandId, versionId)
  if (!cached) return null
  return {
    tuning: cached.entry?.tuning ?? null,
    customFields: filterCustomFields(cached.customFields),
  }
}

function resolveUpcomingDetails(
  versionId: string | null,
  bandId: string | null,
  cached: CountdownMeta | null,
  asyncMeta: SongMetaState,
): CountdownMeta {
  if (!versionId) return { tuning: null, customFields: [] }
  if (cached) return cached
  if (asyncMeta.versionId === versionId && asyncMeta.bandId === bandId) {
    return { tuning: asyncMeta.tuning, customFields: asyncMeta.customFields }
  }
  return { tuning: null, customFields: [] }
}

function useCountdownMetadata(
  countdown: number | null,
  versionId: string | null,
  bandId: string | null,
  getSongDetails?: SetlistPlayerActions['getSongDetails'],
): CountdownMeta {
  const [asyncMeta, setAsyncMeta] = useState<SongMetaState>({
    versionId: null,
    bandId: null,
    tuning: null,
    customFields: [],
  })

  const isCountingDown = countdown !== null

  useEffect(() => {
    if (!isCountingDown || !versionId || !getSongDetails) return
    if (cachedSong(bandId, versionId)) return

    let active = true

    getSongDetails(versionId, bandId).then(
      (details) => {
        const latestState = useSetlistPlayerStore.getState()
        const latestCurrent = latestState.entries[latestState.index]
        const stillActive =
          active &&
          latestState.countdown !== null &&
          latestCurrent?.versionId === versionId &&
          latestState.bandId === bandId

        if (stillActive) {
          setAsyncMeta({
            versionId,
            bandId,
            tuning: details.tuning,
            customFields: filterCustomFields(details.customFields),
          })
        }
      },
      () => {
        // error leaves defaults
      },
    )

    return () => {
      active = false
    }
  }, [bandId, getSongDetails, isCountingDown, versionId])

  if (!isCountingDown) {
    return { tuning: null, customFields: [] }
  }

  const cached = extractCachedDetails(bandId, versionId)
  return resolveUpcomingDetails(versionId, bandId, cached, asyncMeta)
}

function messageFor(
  state: { refused: boolean; skipped: string | null; status: PlayerStatus },
  offline: boolean,
  title: string,
): string | null {
  if (offline) return OFFLINE_TEXT
  if (state.refused) return tapToPlayText(title)
  if (state.skipped) return skippedText(state.skipped)
  return state.status === 'stopped' ? 'End of setlist' : null
}
