import type { EngineEvents, EngineFactory } from './types'

interface YtPlayer {
  cueVideoById(videoId: string): void
  loadVideoById(videoId: string): void
  playVideo(): void
  pauseVideo(): void
  destroy(): void
}
interface YtApi {
  Player: new (
    el: HTMLElement,
    opts: {
      host: string
      playerVars: Record<string, number>
      events: {
        onReady: () => void
        onStateChange: (e: { data: number }) => void
        onError: (e: { data: number }) => void
      },
    },
  ) => YtPlayer
}
interface YtWindow {
  YT?: YtApi
  onYouTubeIframeAPIReady?: () => void
}

const API_URL = 'https://www.youtube.com/iframe_api'
const STATE_ENDED = 0
const STATE_PLAYING = 1
const STATE_PAUSED = 2

let apiPromise: Promise<YtApi> | null = null

/** Loads the IFrame API script the first time a YouTube entry needs it. */
function loadApi(): Promise<YtApi> {
  const w = window as unknown as YtWindow
  if (w.YT?.Player) return Promise.resolve(w.YT)
  apiPromise ??= new Promise<YtApi>((resolve, reject) => {
    w.onYouTubeIframeAPIReady = () => resolve(w.YT as YtApi)
    const script = document.createElement('script')
    script.src = API_URL
    script.onerror = () => {
      apiPromise = null
      reject(new Error('Could not load the YouTube player'))
    }
    document.body.appendChild(script)
  })
  return apiPromise
}

interface Pending {
  resolve: () => void
  reject: (error: Error) => void
}

/** Drives a YouTube IFrame API player inside the hoisted host node. */
export const createYoutubeEngine: EngineFactory = (events: EngineEvents, hosts) => {
  const host = hosts.youtube()
  if (!host) return null
  let player: YtPlayer | null = null
  let pending: Pending | null = null

  const onState = ({ data }: { data: number }) => {
    if (data === STATE_ENDED) events.ended()
    else if (data === STATE_PAUSED) events.paused()
    else if (data === STATE_PLAYING) {
      pending?.resolve()
      pending = null
      events.playing()
    }
  }
  const onError = () => {
    pending?.reject(new Error('YouTube could not play this video'))
    pending = null
    events.error()
  }

  async function create(videoId: string): Promise<void> {
    const api = await loadApi()
    // The API swaps its target for an iframe, so it gets a child React never owns.
    const target = document.createElement('div')
    host!.appendChild(target)
    await new Promise<void>((resolve) => {
      player = new api.Player(target, {
        host: 'https://www.youtube-nocookie.com',
        // No `autoplay`, ever: only the tap starts playback.
        playerVars: { playsinline: 1, rel: 0 },
        events: { onReady: resolve, onStateChange: onState, onError },
      })
      player.cueVideoById(videoId)
    })
  }

  return {
    async load(source) {
      if (source.kind !== 'youtube') throw new Error('Not a YouTube source')
      if (player) player.cueVideoById(source.videoId)
      else await create(source.videoId)
    },
    play() {
      return new Promise<void>((resolve, reject) => {
        if (!player) return reject(new Error('Nothing loaded'))
        pending = { resolve, reject }
        player.playVideo()
      })
    },
    pause: () => player?.pauseVideo(),
    dispose() {
      pending = null
      player?.destroy()
      player = null
    },
  }
}
