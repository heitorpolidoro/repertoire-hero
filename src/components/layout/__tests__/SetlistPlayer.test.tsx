// @vitest-environment jsdom
/**
 * RH-167 - the setlist player over the RH-133 queue: no autoplay, start
 * position, advancing across engines, refusal, skipping, no-remount, offline.
 * The audio engine is the real one over jsdom's <audio>; YouTube and Spotify
 * are fake engines (no SDK, no network).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SetlistPlayer } from '../SetlistPlayer'
import { useSetlistPlayer, type SetlistPlayerActions } from '@/hooks/useSetlistPlayer'
import { createAudioEngine } from '@/hooks/setlistEngines/audioEngine'
import type { EngineEvents, EngineFactories, SetlistEngine } from '@/hooks/setlistEngines/types'
import type { QueueSources } from '@/lib/setlistPlayer'
import type { SongQueueEntry } from '@/lib/songQueue'
import { useSetlistPlayerStore } from '@/store/setlistPlayerStore'

const entries: SongQueueEntry[] = ['one', 'two', 'three', 'four'].map((id) => ({
  versionId: id,
  title: id.toUpperCase(),
  artist: null,
}))
const FILE = (n: string): QueueSources => ({ audio: { fileUrl: `https://blob.example/${n}.mp3`, title: n } })
const YT: QueueSources = { youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }
const SPOTIFY: QueueSources = { spotifyUrl: 'https://open.spotify.com/track/abc123' }

interface Fake extends SetlistEngine {
  load: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  events: EngineEvents
}

let fakes: Partial<Record<'youtube' | 'spotify', Fake>>
let youtubePlay: () => Promise<void>
let mediaPlay: ReturnType<typeof vi.fn>

function fakeFactory(kind: 'youtube' | 'spotify', play: () => Promise<void>) {
  return (events: EngineEvents) => {
    const engine: Fake = {
      load: vi.fn().mockResolvedValue(undefined),
      play: vi.fn(play),
      pause: vi.fn(),
      dispose: vi.fn(),
      events,
    }
    fakes[kind] = engine
    return engine
  }
}

function factories(): EngineFactories {
  return {
    file: createAudioEngine,
    youtube: fakeFactory('youtube', () => youtubePlay()),
    spotify: fakeFactory('spotify', async () => undefined),
  }
}

beforeEach(() => {
  fakes = {}
  youtubePlay = async () => undefined
  useSetlistPlayerStore.getState().reset()
  mediaPlay = vi.fn().mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(mediaPlay as never)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
})

// Registered before `cleanup`: afterEach hooks run last-registered first, so the
// tree unmounts (and pauses its <audio>) before the media stubs are restored.
afterEach(() => vi.restoreAllMocks())
afterEach(cleanup)

interface HostProps {
  sources: Record<string, QueueSources>
  offline?: boolean
  refusalMs?: number
  facts?: { connected: boolean; scope: string | null; premium: boolean }
  children?: ReactNode
  actions?: SetlistPlayerActions
}

/** An `AppShell` equivalent: the hook and the bar above whatever route is rendered. */
function Host({ sources, offline = false, refusalMs = 30, facts, children, actions }: HostProps) {
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
  })
  return (
    <>
      <main>{children}</main>
      <SetlistPlayer {...player} />
    </>
  )
}

const tap = (versionId: string) =>
  act(() => {
    useSetlistPlayerStore.getState().requestStart({ entries, versionId, bandId: null })
  })
const audioEl = (c: HTMLElement) => c.ownerDocument.querySelector('audio') as HTMLAudioElement
const status = () => screen.queryByRole('status')?.textContent ?? ''

describe('no autoplay (ER1)', () => {
  it('plays and loads nothing on mount, with a store holding entries, or after a route change', async () => {
    const scripts = document.querySelectorAll('script').length
    useSetlistPlayerStore.getState().begin(entries, 1, null)
    const { container, rerender } = render(<Host sources={{ two: FILE('two') }}>route A</Host>)
    rerender(<Host sources={{ two: FILE('two') }}>route B</Host>)
    await act(async () => {})
    expect(mediaPlay).not.toHaveBeenCalled()
    expect(fakes.youtube).toBeUndefined()
    expect(audioEl(container).hasAttribute('autoplay')).toBe(false)
    expect(audioEl(container).getAttribute('src')).toBeNull()
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    expect(document.querySelectorAll('script')).toHaveLength(scripts)
  })

  it('is hidden until the tap', () => {
    render(<Host sources={{}} />)
    expect(screen.getByRole('region', { hidden: true }).hasAttribute('hidden')).toBe(true)
  })

  it('starts at the song on screen when it has a source', async () => {
    const { container } = render(<Host sources={{ one: FILE('one'), two: FILE('two') }} />)
    tap('two')
    await waitFor(() => expect(mediaPlay).toHaveBeenCalledTimes(1))
    expect(audioEl(container).getAttribute('src')).toBe('https://blob.example/two.mp3')
    expect(screen.getByText('TWO')).toBeTruthy()
    expect(screen.getByText('2 / 4')).toBeTruthy()
    expect(screen.getByText('Next: THREE')).toBeTruthy()
  })

  it('starts at the next entry that has a source when the one on screen has none', async () => {
    const { container } = render(<Host sources={{ three: FILE('three') }} />)
    tap('two')
    await waitFor(() => expect(mediaPlay).toHaveBeenCalledTimes(1))
    expect(audioEl(container).getAttribute('src')).toBe('https://blob.example/three.mp3')
    expect(status()).toBe('Skipped: TWO (no audio or video)')
  })

  it('requests nothing and renders nothing when signed out', async () => {
    const getSources = vi.fn()
    function SignedOut() {
      const player = useSetlistPlayer({
        actions: { getSources, loadFacts: vi.fn() },
        offline: false,
        enabled: false,
        engines: factories(),
      })
      return <SetlistPlayer {...player} />
    }
    const { container } = render(<SignedOut />)
    tap('one')
    await act(async () => {})
    expect(container.innerHTML).toBe('')
    expect(getSources).not.toHaveBeenCalled()
  })
})

describe('advancing (ER3)', () => {
  it('file to file reuses the audio element and calls play again', async () => {
    const { container } = render(<Host sources={{ one: FILE('one'), two: FILE('two') }} />)
    tap('one')
    await waitFor(() => expect(mediaPlay).toHaveBeenCalledTimes(1))
    await act(async () => {
      fireEvent(audioEl(container), new Event('ended'))
    })
    await waitFor(() => expect(mediaPlay).toHaveBeenCalledTimes(2))
    expect(audioEl(container).getAttribute('src')).toBe('https://blob.example/two.mp3')
    expect(screen.getByText('2 / 4')).toBeTruthy()
  })

  it('file to YouTube loads the video in its own engine and plays it', async () => {
    const { container } = render(<Host sources={{ one: FILE('one'), two: YT }} />)
    tap('one')
    await waitFor(() => expect(mediaPlay).toHaveBeenCalledTimes(1))
    await act(async () => {
      fireEvent(audioEl(container), new Event('ended'))
    })
    await waitFor(() => expect(fakes.youtube?.play).toHaveBeenCalledTimes(1))
    expect(fakes.youtube?.load).toHaveBeenCalledWith({ kind: 'youtube', videoId: 'dQw4w9WgXcQ' })
    expect(screen.getByText('YouTube')).toBeTruthy()
    expect(screen.getByText('2 / 4')).toBeTruthy()
  })

  it('plays a ready Spotify track through the Spotify engine', async () => {
    render(<Host sources={{ one: SPOTIFY }} />)
    tap('one')
    await waitFor(() => expect(fakes.spotify?.play).toHaveBeenCalledTimes(1))
    expect(fakes.spotify?.load).toHaveBeenCalledWith({ kind: 'spotify', trackUri: 'spotify:track:abc123' })
  })

  it('falls to YouTube when Spotify is not ready', async () => {
    render(
      <Host
        sources={{ one: { ...SPOTIFY, ...YT } }}
        facts={{ connected: false, scope: null, premium: false }}
      />,
    )
    tap('one')
    await waitFor(() => expect(fakes.youtube?.play).toHaveBeenCalledTimes(1))
    expect(fakes.spotify).toBeUndefined()
  })

  it('falls to YouTube when the facts fetch fails', async () => {
    render(
      <Host
        sources={{}}
        actions={{
          getSources: async () => ({ ...SPOTIFY, ...YT }),
          loadFacts: async () => {
            throw new Error('down')
          },
        }}
      />,
    )
    tap('one')
    await waitFor(() => expect(fakes.youtube?.play).toHaveBeenCalledTimes(1))
  })

  it('the next control and the previous control move through the queue', async () => {
    render(<Host sources={{ one: YT, two: YT }} />)
    tap('one')
    await waitFor(() => expect(fakes.youtube?.play).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(screen.getByText('2 / 4')).toBeTruthy())
    await waitFor(() => expect(fakes.youtube?.play).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await waitFor(() => expect(screen.getByText('1 / 4')).toBeTruthy())
  })
})

describe('refusal (ER4)', () => {
  it('stays on the entry paused with "Tap to play" when play rejects, skipping nothing', async () => {
    const { container } = render(<Host sources={{ one: FILE('one'), two: YT, three: YT }} />)
    tap('one')
    await waitFor(() => expect(mediaPlay).toHaveBeenCalledTimes(1))
    youtubePlay = async () => {
      throw new Error('NotAllowedError')
    }
    await act(async () => {
      fireEvent(audioEl(container), new Event('ended'))
    })
    await waitFor(() => expect(status()).toBe('Tap to play TWO'))
    expect(screen.getByText('2 / 4')).toBeTruthy()
    expect(fakes.youtube?.play).toHaveBeenCalledTimes(1)
    expect(useSetlistPlayerStore.getState().status).toBe('paused')

    // A tap on play retries the same entry only.
    youtubePlay = async () => undefined
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(status()).toBe(''))
    expect(fakes.youtube?.play).toHaveBeenCalledTimes(2)
    expect(screen.getByText('2 / 4')).toBeTruthy()
  })

  it('treats a start that never reports playing as a refusal (timeout)', async () => {
    youtubePlay = () => new Promise<void>(() => undefined)
    render(<Host sources={{ one: YT, two: YT }} refusalMs={20} />)
    tap('one')
    await waitFor(() => expect(status()).toBe('Tap to play ONE'))
    expect(fakes.youtube?.pause).toHaveBeenCalled()
    expect(screen.getByText('1 / 4')).toBeTruthy()
  })
})

describe('skipping and the end of the queue (ER5)', () => {
  it('passes over an entry with no source and says so', async () => {
    const { container } = render(<Host sources={{ one: FILE('one'), three: FILE('three') }} />)
    tap('one')
    await waitFor(() => expect(mediaPlay).toHaveBeenCalledTimes(1))
    await act(async () => {
      fireEvent(audioEl(container), new Event('ended'))
    })
    await waitFor(() => expect(mediaPlay).toHaveBeenCalledTimes(2))
    expect(audioEl(container).getAttribute('src')).toBe('https://blob.example/three.mp3')
    expect(status()).toBe('Skipped: TWO (no audio or video)')
    expect(screen.getByText('3 / 4')).toBeTruthy()
  })

  it('stops at the end without wrapping', async () => {
    const { container } = render(<Host sources={{ one: FILE('one'), two: FILE('two') }} />)
    tap('two')
    await waitFor(() => expect(mediaPlay).toHaveBeenCalledTimes(1))
    await act(async () => {
      fireEvent(audioEl(container), new Event('ended'))
    })
    await waitFor(() => expect(useSetlistPlayerStore.getState().status).toBe('stopped'))
    expect(mediaPlay).toHaveBeenCalledTimes(1)
    expect(screen.getByText('2 / 4')).toBeTruthy()
    expect(status()).toContain('Skipped: FOUR')
  })

  it('treats a source that fails to play like one with no source', async () => {
    const { container } = render(<Host sources={{ one: FILE('one'), two: FILE('two'), three: FILE('three') }} />)
    tap('one')
    await waitFor(() => expect(mediaPlay).toHaveBeenCalledTimes(1))
    await act(async () => {
      fireEvent(audioEl(container), new Event('ended'))
    })
    await waitFor(() => expect(mediaPlay).toHaveBeenCalledTimes(2))
    await act(async () => {
      fireEvent(audioEl(container), new Event('error'))
    })
    await waitFor(() => expect(mediaPlay).toHaveBeenCalledTimes(3))
    expect(audioEl(container).getAttribute('src')).toBe('https://blob.example/three.mp3')
    expect(status()).toBe('Skipped: TWO (no audio or video)')
  })
})

describe('controls and sync', () => {
  it('pause from the bar pauses the engine; native pause and play events keep the store in sync', async () => {
    const { container } = render(<Host sources={{ one: FILE('one') }} />)
    tap('one')
    await waitFor(() => expect(useSetlistPlayerStore.getState().status).toBe('playing'))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(useSetlistPlayerStore.getState().status).toBe('paused')
    await act(async () => {
      fireEvent(audioEl(container), new Event('playing'))
    })
    expect(useSetlistPlayerStore.getState().status).toBe('playing')
    await act(async () => {
      fireEvent(audioEl(container), new Event('pause'))
    })
    expect(useSetlistPlayerStore.getState().status).toBe('paused')
  })

  it('dismiss stops the engine and hides the bar', async () => {
    render(<Host sources={{ one: YT }} />)
    tap('one')
    await waitFor(() => expect(fakes.youtube?.play).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Close player' }))
    expect(fakes.youtube?.dispose).toHaveBeenCalled()
    expect(useSetlistPlayerStore.getState().status).toBe('idle')
    expect(screen.getByRole('region', { hidden: true }).hasAttribute('hidden')).toBe(true)
  })

  it('restarts the current entry from the play button after the queue ended', async () => {
    const { container } = render(<Host sources={{ one: FILE('one') }} />)
    tap('one')
    await waitFor(() => expect(mediaPlay).toHaveBeenCalledTimes(1))
    await act(async () => {
      fireEvent(audioEl(container), new Event('ended'))
    })
    await waitFor(() => expect(useSetlistPlayerStore.getState().status).toBe('stopped'))
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(mediaPlay).toHaveBeenCalledTimes(2))
  })

  it('the title opens that song in Fast View', async () => {
    render(<Host sources={{ one: FILE('one') }} />)
    tap('one')
    const link = await screen.findByRole('link', { name: 'ONE' })
    expect(link.getAttribute('href')).toBe('/songs/one/fast-view?')
  })
})

describe('no remount (ER6)', () => {
  it('keeps the same audio and YouTube host nodes, src and play count across a route change', async () => {
    const { container, rerender } = render(<Host sources={{ one: FILE('one'), two: FILE('two') }}>song one</Host>)
    tap('one')
    await waitFor(() => expect(mediaPlay).toHaveBeenCalledTimes(1))
    const audio = audioEl(container)
    const youtubeHost = container.querySelector('[aria-label="Setlist player"] > div') as HTMLElement
    expect(youtubeHost).toBeTruthy()
    const src = audio.getAttribute('src')

    rerender(<Host sources={{ one: FILE('one'), two: FILE('two') }}>song two, another route</Host>)
    await act(async () => {})

    expect(audioEl(container)).toBe(audio)
    expect(container.querySelector('[aria-label="Setlist player"] > div')).toBe(youtubeHost)
    expect(audio.getAttribute('src')).toBe(src)
    expect(mediaPlay).toHaveBeenCalledTimes(1)
  })

  it('does not let a cleared queue or a new queue touch the running player', async () => {
    render(<Host sources={{ one: YT }} />)
    tap('one')
    await waitFor(() => expect(fakes.youtube?.play).toHaveBeenCalledTimes(1))
    window.sessionStorage.clear()
    await act(async () => {})
    expect(useSetlistPlayerStore.getState().entries).toEqual(entries)
    expect(fakes.youtube?.dispose).not.toHaveBeenCalled()
  })
})

describe('offline (ER7)', () => {
  it('shows the message and mounts no audio, iframe or script', async () => {
    const scripts = document.querySelectorAll('script').length
    const getSources = vi.fn()
    const { container } = render(
      <Host sources={{}} offline actions={{ getSources, loadFacts: vi.fn() }} />,
    )
    tap('one')
    await waitFor(() => expect(status()).toBe('Playback is not available offline'))
    expect(container.ownerDocument.querySelector('audio')).toBeNull()
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    expect(document.querySelectorAll('script')).toHaveLength(scripts)
    expect(getSources).not.toHaveBeenCalled()
    expect(fakes.youtube).toBeUndefined()
    expect(useSetlistPlayerStore.getState().index).toBe(0)
  })

  it('stops the active engine when the connection drops mid-song and skips nothing', async () => {
    const sources = { one: YT, two: YT }
    const { rerender } = render(<Host sources={sources} />)
    tap('one')
    await waitFor(() => expect(useSetlistPlayerStore.getState().status).toBe('playing'))
    rerender(<Host sources={sources} offline />)
    await waitFor(() => expect(status()).toBe('Playback is not available offline'))
    expect(fakes.youtube?.dispose).toHaveBeenCalled()
    expect(useSetlistPlayerStore.getState().status).toBe('paused')
    expect(useSetlistPlayerStore.getState().index).toBe(0)
  })
})
