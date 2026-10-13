import { useEffect, useState } from 'react'
import { OFFLINE_TEXT, skippedText, tapToPlayText, counterText, type SourceKind } from '@/lib/setlistPlayer'
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
}

export interface SetlistPlayerController {
  enabled: boolean
  /** Hidden entirely until the first "Play setlist" tap, and after dismissal. */
  visible: boolean
  offline: boolean
  status: PlayerStatus
  kind: SourceKind | null
  title: string
  versionId: string | null
  bandId: string | null
  nextTitle: string | null
  counter: string
  /** The line under the title: offline, refusal, skip or end of queue. */
  message: string | null
  hasPrev: boolean
  hasNext: boolean
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
}: UseSetlistPlayerOptions) {
  const [runtime] = useState(() => new SetlistRuntime({ actions, engines, refusalMs }))
  const state = useSetlistPlayerStore()

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
  const visible = enabled && state.status !== 'idle' && !!current

  const controller: SetlistPlayerController = {
    enabled,
    visible,
    offline,
    status: state.status,
    kind: state.kind,
    title: current?.title ?? '',
    versionId: current?.versionId ?? null,
    bandId: state.bandId,
    nextTitle: state.entries[state.index + 1]?.title ?? null,
    counter: counterText(state.index, state.entries.length),
    message: messageFor(state, offline, current?.title ?? ''),
    hasPrev: state.index > 0,
    hasNext: state.index < state.entries.length - 1,
    toggle: () => void runtime.toggle(),
    next: () => runtime.next(),
    prev: () => runtime.prev(),
    dismiss: () => runtime.dismiss(),
  }
  return { controller, bindAudio: runtime.setAudioNode, bindYoutube: runtime.setYoutubeNode }
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
