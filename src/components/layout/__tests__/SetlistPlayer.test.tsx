// @vitest-environment jsdom
/**
 * RH-167 - the setlist player over the RH-133 queue: no autoplay, start
 * position, advancing across engines, refusal, skipping, no-remount, offline.
 * The audio engine is the real one over jsdom's <audio>; YouTube and Spotify
 * are fake engines (no SDK, no network), from `setlistPlayerHarness`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SetlistPlayer } from '../SetlistPlayer'
import { useSetlistPlayer } from '@/hooks/useSetlistPlayer'
import type { SongQueueEntry } from '@/lib/songQueue'
import { useSetlistPlayerStore } from '@/store/setlistPlayerStore'
import {
  FILE,
  Host,
  SPOTIFY,
  YT,
  audioEl,
  entries,
  factories,
  fakes,
  mediaPlay,
  setYoutubePlay,
  setupSetlistPlayerHarness,
  status,
  tap,
} from './setlistPlayerHarness'

setupSetlistPlayerHarness()

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
    setYoutubePlay(async () => {
      throw new Error('NotAllowedError')
    })
    await act(async () => {
      fireEvent(audioEl(container), new Event('ended'))
    })
    await waitFor(() => expect(status()).toBe('Tap to play TWO'))
    expect(screen.getByText('2 / 4')).toBeTruthy()
    expect(fakes.youtube?.play).toHaveBeenCalledTimes(1)
    expect(useSetlistPlayerStore.getState().status).toBe('paused')

    // A tap on play retries the same entry only.
    setYoutubePlay(async () => undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(status()).toBe(''))
    expect(fakes.youtube?.play).toHaveBeenCalledTimes(2)
    expect(screen.getByText('2 / 4')).toBeTruthy()
  })

  it('treats a start that never reports playing as a refusal (timeout)', async () => {
    setYoutubePlay(() => new Promise<void>(() => undefined))
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

describe('countdown overlay (RH-189)', () => {
  const cdEntries: SongQueueEntry[] = [
    { versionId: 'one', title: 'Comfortably Numb', artist: 'Pink Floyd' },
    { versionId: 'two', title: 'Hotel California', artist: 'Eagles' },
  ]
  const tapCd = (versionId: string) =>
    act(() => {
      useSetlistPlayerStore.getState().requestStart({ entries: cdEntries, versionId, bandId: null })
    })

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders countdown overlay showing 5, title, artist, and does not call play yet', async () => {
    render(<Host sources={{ one: FILE('one') }} countdownMs={5000} />)
    tapCd('one')
    await act(async () => {
      await Promise.resolve()
    })

    const overlay = screen.getByRole('dialog', { name: 'Setlist countdown' })
    expect(screen.getByTestId('countdown-display').textContent).toBe('5')
    expect(screen.getByRole('heading', { level: 3, name: 'Comfortably Numb' })).toBeTruthy()
    expect(screen.getByText('Pink Floyd')).toBeTruthy()
    expect(overlay).toBeTruthy()
    expect(mediaPlay).not.toHaveBeenCalled()
  })

  it('ticks 5 -> 4 -> 3 -> 2 -> 1 at 1000ms intervals, then starts playback at 0 and dismisses overlay', async () => {
    render(<Host sources={{ one: FILE('one') }} countdownMs={5000} />)
    tapCd('one')
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByTestId('countdown-display').textContent).toBe('5')
    expect(mediaPlay).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByTestId('countdown-display').textContent).toBe('4')

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByTestId('countdown-display').textContent).toBe('3')

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByTestId('countdown-display').textContent).toBe('2')

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByTestId('countdown-display').textContent).toBe('1')

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.queryByTestId('countdown-display')).toBeNull()
    expect(mediaPlay).toHaveBeenCalledTimes(1)
  })

  it('transitions to paused with refused: true showing "Tap to play <title>" if play rejects after countdown', async () => {
    mediaPlay.mockRejectedValueOnce(new Error('NotAllowedError'))
    render(<Host sources={{ one: FILE('one') }} countdownMs={5000} />)
    tapCd('one')
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.queryByTestId('countdown-display')).toBeNull()
    expect(status()).toBe('Tap to play Comfortably Numb')
    expect(useSetlistPlayerStore.getState().refused).toBe(true)
    expect(useSetlistPlayerStore.getState().status).toBe('paused')
  })

  it('clicking "Skip countdown" dismisses the overlay immediately and calls engine play()', async () => {
    render(<Host sources={{ one: FILE('one') }} countdownMs={5000} />)
    tapCd('one')
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByTestId('countdown-display')).toBeTruthy()
    const skipBtn = screen.getByRole('button', { name: 'Skip countdown' })
    fireEvent.click(skipBtn)
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.queryByTestId('countdown-display')).toBeNull()
    expect(mediaPlay).toHaveBeenCalledTimes(1)
  })

  it('clicking "Cancel countdown" clears the timer, leaves countdown null, and does not play', async () => {
    render(<Host sources={{ one: FILE('one') }} countdownMs={5000} />)
    tapCd('one')
    await act(async () => {
      await Promise.resolve()
    })

    const cancelBtn = screen.getByRole('button', { name: 'Cancel countdown' })
    fireEvent.click(cancelBtn)
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.queryByTestId('countdown-display')).toBeNull()
    expect(useSetlistPlayerStore.getState().countdown).toBeNull()
    expect(useSetlistPlayerStore.getState().status).toBe('idle')
    expect(mediaPlay).not.toHaveBeenCalled()
  })

  it('calling toggle() during countdown cancels the timer and sets status to paused', async () => {
    render(<Host sources={{ one: FILE('one') }} countdownMs={5000} />)
    tapCd('one')
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByTestId('countdown-display')).toBeTruthy()
    // Trigger toggle via controller:
    const barPlayBtn = screen.getByRole('button', { name: 'Play' })
    fireEvent.click(barPlayBtn)
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.queryByTestId('countdown-display')).toBeNull()
    expect(useSetlistPlayerStore.getState().countdown).toBeNull()
    expect(useSetlistPlayerStore.getState().status).toBe('paused')
    expect(mediaPlay).not.toHaveBeenCalled()

    // Advancing timers further does not call play:
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(mediaPlay).not.toHaveBeenCalled()
  })

  it('stepping with next() during countdown clears timer and starts a fresh countdown for the next song', async () => {
    render(<Host sources={{ one: FILE('one'), two: FILE('two') }} countdownMs={5000} />)
    tapCd('one')
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByTestId('countdown-display').textContent).toBe('3')

    // Step next
    const nextBtn = screen.getByRole('button', { name: 'Next' })
    fireEvent.click(nextBtn)
    await act(async () => {
      await Promise.resolve()
    })

    // Destination song starts fresh countdown at 5
    expect(screen.getByTestId('countdown-display').textContent).toBe('5')
    expect(screen.getByRole('heading', { level: 3, name: 'Hotel California' })).toBeTruthy()
    expect(mediaPlay).not.toHaveBeenCalled()

    // Complete the 5 seconds for song two:
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.queryByTestId('countdown-display')).toBeNull()
    expect(mediaPlay).toHaveBeenCalledTimes(1)
  })

  it('notifies onSongChange when advancing or stepping', async () => {
    const onSongChange = vi.fn()
    render(
      <Host
        sources={{ one: FILE('one'), two: FILE('two') }}
        countdownMs={0}
        onSongChange={onSongChange}
      />,
    )
    tapCd('one')
    await act(async () => {
      await Promise.resolve()
    })
    expect(onSongChange).toHaveBeenCalledWith('one', null)

    const nextBtn = screen.getByRole('button', { name: 'Next' })
    fireEvent.click(nextBtn)
    await act(async () => {
      await Promise.resolve()
    })
    expect(onSongChange).toHaveBeenCalledWith('two', null)
  })

  describe('tuning and custom fields in countdown overlay (RH-198)', () => {
    const cdHost = (
      details: { tuning: string | null; customFields: Array<{ name: string; value: string }> },
      gd?: ReturnType<typeof vi.fn>,
    ) => (
      <Host
        sources={{ one: FILE('one'), two: FILE('two') }}
        countdownMs={5000}
        actions={{
          getSources: async (id) => (id === 'one' ? FILE('one') : FILE('two')),
          loadFacts: async () => ({ connected: false, scope: null, premium: false }),
          getSongDetails: gd ?? vi.fn().mockResolvedValue(details),
        }}
      />
    )

    it('displays resolved tuning formatted through formatTuningDisplay and wraps with mobile constraints', async () => {
      render(cdHost({ tuning: 'Eb', customFields: [] }))
      tapCd('one')
      await act(async () => {
        await Promise.resolve()
      })

      const tuningSpan = screen.getByText('Eb (-0.5)')
      expect(screen.getByText('Tuning:')).toBeTruthy()
      expect(tuningSpan.className).toContain('truncate')
      expect(tuningSpan.parentElement?.className).toContain('max-w-full min-w-0')
      expect(screen.getByTestId('countdown-metadata').className).toContain('flex-wrap')
      expect(screen.getByTestId('countdown-metadata').className).toContain('max-w-full')
    })

    it('displays custom fields, omitting empty/whitespace values, and truncates long labels', async () => {
      const longName = 'ExtraordinarilyLongCustomFieldNameThatExceedsNormalLength'
      const longVal = 'SuperLongCustomFieldValuePresetDescriptionThatNeedsTruncation'
      render(
        cdHost({
          tuning: null,
          customFields: [
            { name: 'Capo', value: '2' },
            { name: longName, value: longVal },
            { name: 'EmptyField', value: '' },
            { name: 'BlankField', value: '   ' },
          ],
        }),
      )
      tapCd('one')
      await act(async () => {
        await Promise.resolve()
      })

      expect(screen.getByText('Capo:')).toBeTruthy()
      expect(screen.getByText('2')).toBeTruthy()
      expect(screen.queryByText(/EmptyField/)).toBeNull()
      expect(screen.queryByText(/BlankField/)).toBeNull()
      expect(screen.getByText(`${longName}:`).className).toContain('max-w-[120px] truncate')
      expect(screen.getByText(longVal).className).toContain('max-w-[160px] truncate')
    })

    it('renders cleanly without metadata container or blank badges when upcoming song has neither', async () => {
      render(cdHost({ tuning: null, customFields: [] }))
      tapCd('one')
      await act(async () => {
        await Promise.resolve()
      })

      expect(screen.queryByTestId('countdown-metadata')).toBeNull()
      expect(screen.queryByText(/Tuning:/)).toBeNull()
    })

    it('stale responses: discards in-flight getSongDetails response when navigation moves to another song', async () => {
      let resolveSongOne!: (val: { tuning: string | null; customFields: Array<{ name: string; value: string }> }) => void
      const songOnePromise = new Promise<{ tuning: string | null; customFields: Array<{ name: string; value: string }> }>((res) => {
        resolveSongOne = res
      })
      const getSongDetails = vi.fn().mockImplementation((id: string) => {
        if (id === 'one') return songOnePromise
        return Promise.resolve({ tuning: 'Drop D', customFields: [{ name: 'Patch', value: 'Lead' }] })
      })

      render(cdHost({ tuning: null, customFields: [] }, getSongDetails))
      tapCd('one')
      await act(async () => {
        await Promise.resolve()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
      await act(async () => {
        await Promise.resolve()
      })

      expect(screen.getByRole('heading', { level: 3, name: 'Hotel California' })).toBeTruthy()
      expect(screen.getByText('Drop D')).toBeTruthy()
      expect(screen.getByText('Patch:')).toBeTruthy()

      await act(async () => {
        resolveSongOne({ tuning: 'Eb', customFields: [{ name: 'Capo', value: '2' }] })
        await Promise.resolve()
      })

      expect(screen.getByRole('heading', { level: 3, name: 'Hotel California' })).toBeTruthy()
      expect(screen.getByText('Drop D')).toBeTruthy()
      expect(screen.queryByText('Eb (-0.5)')).toBeNull()
      expect(screen.queryByText(/Capo/)).toBeNull()
    })

    it('populates tuning and custom fields synchronously from cachedSong when pre-fetched', async () => {
      const { fetchSongWindow, resetSongWindow } = await import('@/lib/songWindow')
      resetSongWindow()
      await fetchSongWindow(null, ['one'], async () => [
        {
          versionId: 'one',
          entry: { tuning: 'Eb' } as never,
          files: [],
          customFields: [{ fieldId: 'f1', name: 'Preset', value: 'Acoustic' }],
        },
      ])

      const getSongDetails = vi.fn()
      render(cdHost({ tuning: null, customFields: [] }, getSongDetails))
      tapCd('one')
      await act(async () => {
        await Promise.resolve()
      })

      expect(screen.getByText('Eb (-0.5)')).toBeTruthy()
      expect(screen.getByText('Preset:')).toBeTruthy()
      expect(screen.getByText('Acoustic')).toBeTruthy()
      expect(getSongDetails).not.toHaveBeenCalled()
      resetSongWindow()
    })
  })
})

describe('previous control restart and step (RH-200)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
  async function startSong(id: string) {
    render(<Host sources={{ one: YT, two: YT }} countdownMs={5000} />)
    tap(id)
    await act(async () => {})
    advance(5000)
    await act(async () => {})
  }

  it('restarts while playing after 3500 ms without countdown or re-calling play', async () => {
    await startSong('two')
    expect(screen.getByText('2 / 4')).toBeTruthy()
    expect(fakes.youtube?.play).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()

    advance(3500)
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await act(async () => {})

    expect(fakes.youtube?.seek).toHaveBeenCalledWith(0)
    expect(screen.getByText('2 / 4')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Setlist countdown' })).toBeNull()
    expect(fakes.youtube?.play).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
  })

  it('restarts while paused after 3500 ms playback, calling seek(0) and play', async () => {
    await startSong('two')
    advance(3500)

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await act(async () => {})

    expect(fakes.youtube?.seek).toHaveBeenCalledWith(0)
    expect(fakes.youtube?.play).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
    expect(screen.getByText('2 / 4')).toBeTruthy()
  })

  it('steps to previous song within threshold (1500 ms)', async () => {
    await startSong('two')
    advance(1500)

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await act(async () => {})

    expect(fakes.youtube?.seek).not.toHaveBeenCalled()
    expect(screen.getByText('1 / 4')).toBeTruthy()
  })

  it('does not count paused time towards the 3000 ms threshold', async () => {
    await startSong('two')
    advance(2000)

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    advance(5000)
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    advance(500)

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await act(async () => {})

    expect(fakes.youtube?.seek).not.toHaveBeenCalled()
    expect(screen.getByText('1 / 4')).toBeTruthy()
  })

  it('enables Previous at index 0 when playing or paused, and always restarts at index 0', async () => {
    await startSong('one')
    expect(screen.getByText('1 / 4')).toBeTruthy()
    const prevBtn = screen.getByRole('button', { name: 'Previous' })
    expect(prevBtn.hasAttribute('disabled')).toBe(false)

    advance(1000)
    fireEvent.click(prevBtn)
    await act(async () => {})

    expect(fakes.youtube?.seek).toHaveBeenCalledWith(0)
    expect(screen.getByText('1 / 4')).toBeTruthy()
  })
})

