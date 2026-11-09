/**
 * The shared harness of the setlist player suites (RH-167, RH-200): the queue,
 * the sources, the fake YouTube and Spotify engines (no SDK, no network), the
 * media element stubs under the real audio engine, and an `AppShell`-like host.
 *
 * Not a test file: it exports helpers and holds no `describe`. A suite calls
 * `setupSetlistPlayerHarness()` once at its top level.
 */
import { afterEach, beforeEach, vi } from 'vitest'
import { act, cleanup, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SetlistPlayer } from '../SetlistPlayer'
import { useSetlistPlayer, type SetlistPlayerActions } from '@/hooks/useSetlistPlayer'
import { createAudioEngine } from '@/hooks/setlistEngines/audioEngine'
import type { EngineEvents, EngineFactories, SetlistEngine } from '@/hooks/setlistEngines/types'
import type { QueueSources } from '@/lib/setlistPlayer'
import type { SongQueueEntry } from '@/lib/songQueue'
import { useSetlistPlayerStore } from '@/store/setlistPlayerStore'

export const entries: SongQueueEntry[] = ['one', 'two', 'three', 'four'].map((id) => ({
  versionId: id,
  title: id.toUpperCase(),
  artist: null,
}))
export const FILE = (n: string): QueueSources => ({ audio: { fileUrl: `https://blob.example/${n}.mp3`, title: n } })
export const YT: QueueSources = { youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }
export const SPOTIFY: QueueSources = { spotifyUrl: 'https://open.spotify.com/track/abc123' }

interface Fake extends SetlistEngine {
  load: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  seek: ReturnType<typeof vi.fn>
  events: EngineEvents
}

/** The fake engines the runtime created, by kind; emptied before each test. */
export const fakes: Partial<Record<'youtube' | 'spotify', Fake>> = {}
/** The stub behind `HTMLMediaElement.prototype.play`; reset before each test. */
export const mediaPlay = vi.fn()
let youtubePlay: () => Promise<void> = async () => undefined

/** What the fake YouTube engine's `play` does from now on in this test. */
export function setYoutubePlay(play: () => Promise<void>) {
  youtubePlay = play
}

function fakeFactory(kind: 'youtube' | 'spotify', play: () => Promise<void>) {
  return (events: EngineEvents) => {
    const engine: Fake = {
      load: vi.fn().mockResolvedValue(undefined),
      play: vi.fn(play),
      pause: vi.fn(),
      seek: vi.fn(),
      dispose: vi.fn(),
      events,
    }
    fakes[kind] = engine
    return engine
  }
}

export function factories(): EngineFactories {
  return {
    file: createAudioEngine,
    youtube: fakeFactory('youtube', () => youtubePlay()),
    spotify: fakeFactory('spotify', async () => undefined),
  }
}

export function setupSetlistPlayerHarness() {
  beforeEach(() => {
    delete fakes.youtube
    delete fakes.spotify
    youtubePlay = async () => undefined
    useSetlistPlayerStore.getState().reset()
    mediaPlay.mockReset()
    mediaPlay.mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(mediaPlay as never)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
  })

  // Registered before `cleanup`: afterEach hooks run last-registered first, so the
  // tree unmounts (and pauses its <audio>) before the media stubs are restored.
  afterEach(() => vi.restoreAllMocks())
  afterEach(cleanup)
}

interface HostProps {
  sources: Record<string, QueueSources>
  offline?: boolean
  refusalMs?: number
  countdownMs?: number
  onSongChange?: (versionId: string, bandId: string | null) => void
  facts?: { connected: boolean; scope: string | null; premium: boolean }
  children?: ReactNode
  actions?: SetlistPlayerActions
}

/** An `AppShell` equivalent: the hook and the bar above whatever route is rendered. */
export function Host({
  sources,
  offline = false,
  refusalMs = 30,
  countdownMs = 0,
  onSongChange,
  facts,
  children,
  actions,
}: HostProps) {
  const player = useSetlistPlayer({
    actions: actions ?? {
      getSources: async (id) => sources[id] ?? {},
      loadFacts: async () =>
        facts ?? {
          connected: true,
          scope: 'streaming user-read-playback-state user-modify-playback-state',
          premium: true,
        },
    },
    offline,
    enabled: true,
    engines: factories(),
    refusalMs,
    countdownMs,
    onSongChange,
  })
  return (
    <>
      <main>{children}</main>
      <SetlistPlayer {...player} />
    </>
  )
}

export const tap = (versionId: string) =>
  act(() => {
    useSetlistPlayerStore.getState().requestStart({ entries, versionId, bandId: null })
  })
export const audioEl = (c: HTMLElement) => c.ownerDocument.querySelector('audio') as HTMLAudioElement
export const status = () => screen.queryByRole('status')?.textContent ?? ''
