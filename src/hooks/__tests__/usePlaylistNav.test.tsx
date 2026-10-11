// @vitest-environment jsdom
/**
 * RH-48, fed by the song queue since RH-133.
 *
 * The controller fetches nothing now: it reads one `sessionStorage` entry on
 * mount, derives the position from the route's version id, and pushes hrefs.
 * So every case here seeds the queue and asserts what the chrome does with it —
 * there is no action spy left to assert against, which is the point.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, cleanup } from '@testing-library/react'
import { usePlaylistNav, type UsePlaylistNavOptions } from '../usePlaylistNav'
import { SLIDE_OUT_MS } from '@/lib/playlistNav'
import { writeSongQueue, SONG_QUEUE_KEY, type SongQueue } from '@/lib/songQueue'

afterEach(cleanup)

const ENTRIES = [
  { versionId: 'v-rep-1', title: 'Black Dog', artist: 'Led Zeppelin' },
  { versionId: 'v-rep-2', title: 'Rosanna', artist: 'Toto' },
  { versionId: 'v-rep-3', title: 'Untitled', artist: null },
]

/** The queue a band playlist writes: three songs, a band owner, an origin. */
const PLAYLIST_QUEUE: SongQueue = {
  entries: ENTRIES,
  owner: { type: 'band', bandId: 'band-7' },
  originHref: '/playlists/pl-1',
  label: 'Gig',
}

function seed(queue: SongQueue = PLAYLIST_QUEUE) {
  writeSongQueue(queue)
}

function setup(overrides: Partial<UsePlaylistNavOptions> = {}) {
  const navigate = vi.fn()
  const navigateBack = vi.fn()
  const initialProps: UsePlaylistNavOptions = {
    currentVersionId: 'v-rep-2',
    bandId: 'band-7',
    navigate,
    navigateBack,
    ...overrides,
  }
  const view = renderHook((props: UsePlaylistNavOptions) => usePlaylistNav(props), { initialProps })
  return { ...view, navigate, navigateBack, initialProps }
}

/** Let the mount effect's state update settle, without running any timer. */
async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  sessionStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePlaylistNav', () => {
  it('exposes no navigation at all when the tab holds no queue', async () => {
    const { result } = setup()
    await flush()

    expect(result.current.nav).toBeNull()
    expect(result.current.entries).toEqual([])
  })

  it('reads the queue and exposes the computed navigation', async () => {
    seed()
    const { result } = setup()
    await flush()

    expect(result.current.entries).toEqual(ENTRIES)
    expect(result.current.nav).toEqual({
      prevId: 'v-rep-1',
      nextId: 'v-rep-3',
      position: 2,
      total: 3,
      queueLabel: 'Gig',
    })
  })

  it('exposes no navigation when the stored queue is malformed, and does not throw', async () => {
    sessionStorage.setItem(SONG_QUEUE_KEY, '{')
    const { result } = setup()
    await flush()

    expect(result.current.nav).toBeNull()
    expect(result.current.entries).toEqual([])
  })

  /**
   * RH-133 round 2 — a stale queue is not this route's queue. `sessionStorage`
   * is tab-wide and dies only with the tab, so a song reached from a screen
   * that built no queue must not inherit the previous navigation's entries:
   * the whole queue is scoped to the route, not just the position in it.
   */
  it('exposes no navigation and no entries when the current version is absent from the queue', async () => {
    seed()
    const { result } = setup({ currentVersionId: 'v-rep-99' })
    await flush()

    expect(result.current.nav).toBeNull()
    expect(result.current.entries).toEqual([])
  })

  it('opens and closes the drawer', async () => {
    seed()
    const { result } = setup()
    await flush()

    expect(result.current.isDrawerOpen).toBe(false)
    act(() => result.current.openDrawer())
    expect(result.current.isDrawerOpen).toBe(true)
    act(() => result.current.closeDrawer())
    expect(result.current.isDrawerOpen).toBe(false)
  })

  it('navigates to the selected entry after the slide-out delay, carrying the band id', async () => {
    seed()
    const { result, navigate } = setup()
    await flush()

    act(() => result.current.selectEntry('v-rep-3'))
    expect(result.current.slideOut).toBe('left')
    expect(navigate).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
    expect(navigate).toHaveBeenCalledWith('/songs/v-rep-3/fast-view?bandId=band-7')
  })

  it('does not navigate when the selected entry is the current one', async () => {
    seed()
    const { result, navigate } = setup()
    await flush()

    act(() => result.current.selectEntry('v-rep-2'))
    act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })

    expect(result.current.slideOut).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('goPrev slides right to the previous entry and does nothing on the first entry', async () => {
    seed()
    const { result, navigate } = setup()
    await flush()

    act(() => result.current.goPrev())
    expect(result.current.slideOut).toBe('right')
    act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
    expect(navigate).toHaveBeenCalledWith('/songs/v-rep-1/fast-view?bandId=band-7')

    const first = setup({ currentVersionId: 'v-rep-1' })
    await flush()
    act(() => first.result.current.goPrev())
    act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
    expect(first.navigate).not.toHaveBeenCalled()
  })

  it('advances to the next entry on a leftward swipe past the threshold', async () => {
    seed()
    const { result, navigate } = setup()
    await flush()

    act(() => result.current.onTouchStart(300))
    act(() => result.current.onTouchEnd(200))
    expect(result.current.slideOut).toBe('left')

    act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
    expect(navigate).toHaveBeenCalledWith('/songs/v-rep-3/fast-view?bandId=band-7')
  })

  it('ignores a swipe shorter than the threshold', async () => {
    seed()
    const { result, navigate } = setup()
    await flush()

    act(() => result.current.onTouchStart(300))
    act(() => result.current.onTouchEnd(280))
    act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
    expect(result.current.slideOut).toBeNull()
    expect(navigate).not.toHaveBeenCalled()

    // A touch end without a preceding touch start is ignored too.
    act(() => result.current.onTouchEnd(0))
    act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('does not navigate when the slide-out timer fires after unmount', async () => {
    seed()
    const { result, navigate, unmount } = setup()
    await flush()

    act(() => result.current.selectEntry('v-rep-3'))
    unmount()
    act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })

    expect(navigate).not.toHaveBeenCalled()
  })

  /**
   * RH-133 ER4 — Back goes to the href the queue recorded, whatever it names.
   *
   * The non-playlist case is the one that matters: an implementation that
   * rebuilt a playlist route from an id would satisfy the first case and strand
   * every other origin a queue can have.
   */
  describe('goBack', () => {
    it('pushes a playlist origin exactly as recorded', async () => {
      seed()
      const { result, navigate, navigateBack } = setup()
      await flush()

      act(() => result.current.goBack())

      expect(navigate).toHaveBeenCalledWith('/playlists/pl-1')
      expect(navigateBack).not.toHaveBeenCalled()
    })

    it('pushes a non-playlist origin exactly as recorded', async () => {
      seed({ ...PLAYLIST_QUEUE, originHref: '/bands/band-7' })
      const { result, navigate, navigateBack } = setup()
      await flush()

      act(() => result.current.goBack())

      expect(navigate).toHaveBeenCalledWith('/bands/band-7')
      expect(navigateBack).not.toHaveBeenCalled()
    })

    it('walks browser history back when there is no queue', async () => {
      const { result, navigate, navigateBack } = setup()
      await flush()

      act(() => result.current.goBack())

      expect(navigateBack).toHaveBeenCalledTimes(1)
      expect(navigate).not.toHaveBeenCalled()
    })

    it('walks history back for a stale queue that does not hold this route', async () => {
      // The dashboard scenario: a playlist queue is still in the tab, and the
      // musician opens a song that playlist knows nothing about. Back must not
      // push `/playlists/pl-1`.
      seed()
      const { result, navigate, navigateBack } = setup({ currentVersionId: 'v-rep-99' })
      await flush()

      act(() => result.current.goBack())

      expect(navigateBack).toHaveBeenCalledTimes(1)
      expect(navigate).not.toHaveBeenCalled()
    })

    it('walks history back for a queue that recorded no origin', async () => {
      seed({ ...PLAYLIST_QUEUE, originHref: '' })
      const { result, navigate, navigateBack } = setup()
      await flush()

      act(() => result.current.goBack())

      expect(navigateBack).toHaveBeenCalledTimes(1)
      expect(navigate).not.toHaveBeenCalled()
    })
  })

  /**
   * RH-133 ER6/ER9 — the resolved context reaches the pushed href and nothing
   * else. The controller exposes no band id of its own; what it decides is one
   * query parameter on the next navigation, which is why a client-writable
   * queue is safe here (see `resolveQueueOwner`).
   */
  describe('owner-context precedence in the pushed href', () => {
    async function pushFrom(options: Partial<UsePlaylistNavOptions>) {
      const { result, navigate } = setup(options)
      await flush()
      act(() => result.current.selectEntry('v-rep-3'))
      act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
      return navigate
    }

    it('lets the URL band id win over a disagreeing queue owner', async () => {
      seed({ ...PLAYLIST_QUEUE, owner: { type: 'band', bandId: 'band-queue' } })

      const navigate = await pushFrom({ bandId: 'band-url' })

      expect(navigate).toHaveBeenCalledWith('/songs/v-rep-3/fast-view?bandId=band-url')
    })

    it('applies the queue owner only when the URL carries no band id', async () => {
      seed({ ...PLAYLIST_QUEUE, owner: { type: 'band', bandId: 'band-queue' } })

      const navigate = await pushFrom({ bandId: null })

      expect(navigate).toHaveBeenCalledWith('/songs/v-rep-3/fast-view?bandId=band-queue')
    })

    it('pushes no band id for a personal queue opened with no URL band id', async () => {
      seed({ ...PLAYLIST_QUEUE, owner: { type: 'personal' } })

      const navigate = await pushFrom({ bandId: null })

      expect(navigate).toHaveBeenCalledWith('/songs/v-rep-3/fast-view?')
    })

    /**
     * RH-133 ER4(e), band variant. Route-scoping has to cover the *owner* too,
     * not just the chrome and the Back target: a stale band queue left in the
     * tab must not decide the `?bandId=` of a push made from a personal song
     * the queue knows nothing about, or Fast View silently flips to another
     * band's rows. The route carries no band id, so there is nothing legitimate
     * for the href to inherit.
     */
    it('pushes no band id for a stale band queue when the route carries none', async () => {
      seed({ ...PLAYLIST_QUEUE, owner: { type: 'band', bandId: 'band-queue' } })

      const navigate = await pushFrom({ bandId: null, currentVersionId: 'v-rep-99' })

      expect(navigate).toHaveBeenCalledWith('/songs/v-rep-3/fast-view?')
      expect(navigate).not.toHaveBeenCalledWith(expect.stringContaining('band-queue'))
    })

    it('exposes no owner context to its consumers', async () => {
      seed()
      const { result } = setup()
      await flush()

      // The chrome gets entries, a position and commands — never a band id it
      // could pass to a write.
      expect(Object.keys(result.current).sort()).toEqual([
        'closeDrawer',
        'entries',
        'goBack',
        'goPrev',
        'isDrawerOpen',
        'nav',
        'onTouchEnd',
        'onTouchStart',
        'openDrawer',
        'selectEntry',
        'slideOut',
      ])
    })
  })

  describe('arrow keys', () => {
    function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
      act(() => { target.dispatchEvent(event) })
      act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
      return event
    }

    it('ArrowRight slides left to the next entry and ArrowLeft slides right to the previous one', async () => {
      seed()
      const { navigate } = setup()
      await flush()

      const event = press('ArrowRight')
      expect(event.defaultPrevented).toBe(true)
      expect(navigate).toHaveBeenLastCalledWith('/songs/v-rep-3/fast-view?bandId=band-7')

      press('ArrowLeft')
      expect(navigate).toHaveBeenLastCalledWith('/songs/v-rep-1/fast-view?bandId=band-7')
    })

    it('queues a single push for a key pressed again during the slide-out', async () => {
      seed()
      const { result, navigate } = setup()
      await flush()

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
      })
      expect(result.current.slideOut).toBe('left')
      act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })

      expect(navigate).toHaveBeenCalledTimes(1)
    })

    it('ignores the keys while typing in a text field', async () => {
      seed()
      const { navigate } = setup()
      await flush()
      const textarea = document.createElement('textarea')
      document.body.appendChild(textarea)

      const event = press('ArrowRight', {}, textarea)

      expect(event.defaultPrevented).toBe(false)
      expect(navigate).not.toHaveBeenCalled()
      textarea.remove()
    })

    it('ignores the keys when keyboardEnabled is false', async () => {
      seed()
      const { navigate } = setup({ keyboardEnabled: false })
      await flush()

      press('ArrowRight')

      expect(navigate).not.toHaveBeenCalled()
    })

    it('ignores the keys for a song opened with no queue', async () => {
      const { navigate } = setup()
      await flush()

      press('ArrowRight')

      expect(navigate).not.toHaveBeenCalled()
    })

    it('ignores the keys at the ends of the queue, with no wraparound', async () => {
      seed()
      const last = setup({ currentVersionId: 'v-rep-3' })
      await flush()

      press('ArrowRight')

      expect(last.navigate).not.toHaveBeenCalled()
    })
  })
})
