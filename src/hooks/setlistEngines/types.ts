import type { PickedSource, SourceKind } from '@/lib/setlistPlayer'

/** What an engine reports back to the controller. */
export interface EngineEvents {
  ended: () => void
  /** The loaded source cannot play (audio error, YouTube 100/101/150, Spotify error). */
  error: () => void
  playing: () => void
  paused: () => void
}

/**
 * One provider behind a common interface (RH-167). `play` resolves once the
 * provider reports playing and rejects when it refuses; the controller adds the
 * timeout, so an engine never decides to skip or retry.
 */
export interface SetlistEngine {
  load: (source: PickedSource) => Promise<void>
  play: () => Promise<void>
  pause: () => void
  dispose: () => void
}

/** The persistent nodes `AppShell` hoists; `null` where none is mounted (offline). */
export interface EngineHosts {
  audio: () => HTMLAudioElement | null
  youtube: () => HTMLElement | null
}

export type EngineFactory = (events: EngineEvents, hosts: EngineHosts) => SetlistEngine | null

export type EngineFactories = Record<SourceKind, EngineFactory>
