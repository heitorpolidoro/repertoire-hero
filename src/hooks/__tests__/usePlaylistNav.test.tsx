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
import { useSetlistPlayerStore } from '@/store/setlistPlayerStore'
import { writeSongQueue, SONG_QUEUE_KEY, type SongQueue } from '@/lib/songQueue'
import type { QueueAvailabilityStore } from '../useQueueAvailability'
import type { OfflineSongRecord } from '@/lib/offlineRecords'

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
  const replace = vi.fn()
  const initialProps: UsePlaylistNavOptions = {
    currentVersionId: 'v-rep-2',
    bandId: 'band-7',
    navigate,
    navigateBack,
    replace,
    ...overrides,
  }
  const view = renderHook((props: UsePlaylistNavOptions) => usePlaylistNav(props), { initialProps })
  return { ...view, navigate, navigateBack, replace, initialProps }
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

  it('playSetlist hands the queue and the song on screen to the player and navigates nowhere (RH-167)', async () => {
    seed()
    useSetlistPlayerStore.getState().reset()
    const { result, navigate } = setup()
    await flush()
    expect(useSetlistPlayerStore.getState().request).toBeNull()

    act(() => result.current.playSetlist())

    expect(useSetlistPlayerStore.getState().request).toEqual({
      entries: ENTRIES,
      versionId: 'v-rep-2',
      bandId: 'band-7',
    })
    expect(navigate).not.toHaveBeenCalled()
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

  it('goNext slides left to the next entry and does nothing on the last entry', async () => {
    seed()
    const { result, navigate } = setup()
    await flush()

    act(() => result.current.goNext())
    expect(result.current.slideOut).toBe('left')
    act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
    expect(navigate).toHaveBeenCalledWith('/songs/v-rep-3/fast-view?bandId=band-7')

    const last = setup({ currentVersionId: 'v-rep-3' })
    await flush()
    act(() => last.result.current.goNext())
    act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
    expect(last.navigate).not.toHaveBeenCalled()
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
        'activeVersionId',
        'availableVersionIds',
        'closeDrawer',
        'entries',
        'goBack',
        'goNext',
        'goPrev',
        'isDrawerOpen',
        'nav',
        'nextEntry',
        'onTouchEnd',
        'onTouchStart',
        'openDrawer',
        'playSetlist',
        'prevEntry',
        'selectEntry',
        'slideOut',
      ])
    })
  })

  describe('activeVersionId (RH-199)', () => {
    beforeEach(() => {
      useSetlistPlayerStore.getState().reset()
    })

    it('derives activeVersionId from the setlist player store', async () => {
      seed()
      const { result } = setup()
      await flush()

      expect(result.current.activeVersionId).toBeNull()

      act(() => {
        useSetlistPlayerStore.getState().begin(ENTRIES, 1, null)
      })
      expect(result.current.activeVersionId).toBe('v-rep-2')

      act(() => {
        useSetlistPlayerStore.getState().patch({ status: 'stopped' })
      })
      expect(result.current.activeVersionId).toBeNull()

      act(() => {
        useSetlistPlayerStore.getState().begin(ENTRIES, 0, null)
      })
      expect(result.current.activeVersionId).toBe('v-rep-1')

      act(() => {
        useSetlistPlayerStore.getState().reset()
      })
      expect(result.current.activeVersionId).toBeNull()
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

    it('in stage mode, triggers navigation via router.replace and preserves stage query param', async () => {
      seed()
      const { replace, navigate } = setup({ activeStage: 'pdf' })
      await flush()

      press('ArrowRight')
      expect(replace).toHaveBeenCalledWith('/songs/v-rep-3/fast-view?bandId=band-7&stage=pdf')
      expect(navigate).not.toHaveBeenCalled()

      press('ArrowLeft')
      expect(replace).toHaveBeenCalledWith('/songs/v-rep-1/fast-view?bandId=band-7&stage=pdf')
    })

    it('in stage mode, ignores ArrowDown and ArrowUp to preserve reading scroll', async () => {
      seed()
      const { replace, navigate } = setup({ activeStage: 'lyrics' })
      await flush()

      press('ArrowDown')
      expect(replace).not.toHaveBeenCalled()
      expect(navigate).not.toHaveBeenCalled()

      press('ArrowUp')
      expect(replace).not.toHaveBeenCalled()
      expect(navigate).not.toHaveBeenCalled()
    })
  })

  /**
   * RH-196 — offline, moving skips the queue entries not on this device and
   * stops at the ends; online nothing changes and the store is never read.
   */
  describe('offline skip navigation', () => {
    const FIVE = ['v-1', 'v-2', 'v-3', 'v-4', 'v-5'].map((versionId) => ({
      versionId,
      title: `Song ${versionId}`,
      artist: null,
    }))
    const FIVE_QUEUE: SongQueue = { entries: FIVE, owner: { type: 'personal' }, originHref: '/offline', label: 'Gig' }

    /** v-2 and v-4 are not on this device. */
    function storeWith(versionIds: string[] = ['v-1', 'v-3', 'v-5']): QueueAvailabilityStore {
      return {
        listOfflineSongs: vi.fn(() =>
          Promise.resolve(versionIds.map((versionId) => ({ versionId, bandId: null })) as unknown as OfflineSongRecord[]),
        ),
      }
    }

    function press(key: string) {
      act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) })
      act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
    }

    function offlineAt(currentVersionId: string, store = storeWith()) {
      seed(FIVE_QUEUE)
      return setup({ currentVersionId, bandId: null, offline: true, store })
    }

    it('ArrowRight and ArrowLeft skip the unavailable neighbours', async () => {
      const { navigate } = offlineAt('v-3')
      await flush()

      press('ArrowRight')
      expect(navigate).toHaveBeenLastCalledWith('/songs/v-5/fast-view?')
      press('ArrowLeft')
      expect(navigate).toHaveBeenLastCalledWith('/songs/v-1/fast-view?')
    })

    it('goNext and goPrev skip the unavailable neighbours and keep position and total', async () => {
      const { result, navigate } = offlineAt('v-3')
      await flush()

      expect(result.current.nav).toMatchObject({ prevId: 'v-1', nextId: 'v-5', position: 3, total: 5 })
      act(() => result.current.goNext())
      act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
      expect(navigate).toHaveBeenLastCalledWith('/songs/v-5/fast-view?')
      act(() => result.current.goPrev())
      act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
      expect(navigate).toHaveBeenLastCalledWith('/songs/v-1/fast-view?')
    })

    it('swipes skip the unavailable neighbours in both directions', async () => {
      const { result, navigate } = offlineAt('v-3')
      await flush()

      act(() => result.current.onTouchStart(300))
      act(() => result.current.onTouchEnd(200))
      act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
      expect(navigate).toHaveBeenLastCalledWith('/songs/v-5/fast-view?')

      act(() => result.current.onTouchStart(200))
      act(() => result.current.onTouchEnd(300))
      act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
      expect(navigate).toHaveBeenLastCalledWith('/songs/v-1/fast-view?')
    })

    it('stops at the queue ends without wrapping when nothing is available that way', async () => {
      const first = offlineAt('v-1', storeWith(['v-1', 'v-2']))
      await flush()
      press('ArrowLeft')
      expect(first.navigate).not.toHaveBeenCalled()
      cleanup()

      const last = offlineAt('v-5', storeWith(['v-1', 'v-5']))
      await flush()
      press('ArrowRight')
      expect(last.navigate).toHaveBeenCalledTimes(0)
      press('ArrowLeft')
      expect(last.navigate).toHaveBeenLastCalledWith('/songs/v-1/fast-view?')

      // Nothing available after the current entry: no next at all, not v-1.
      const stuck = offlineAt('v-4', storeWith(['v-1']))
      await flush()
      expect(stuck.result.current.nav).toMatchObject({ prevId: 'v-1', nextId: null })
    })

    it('ignores selecting an unavailable entry and selects an available one', async () => {
      const { result, navigate } = offlineAt('v-3')
      await flush()

      act(() => result.current.selectEntry('v-4'))
      act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
      expect(result.current.slideOut).toBeNull()
      expect(navigate).not.toHaveBeenCalled()

      act(() => result.current.selectEntry('v-5'))
      act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
      expect(navigate).toHaveBeenCalledWith('/songs/v-5/fast-view?')
    })

    it('exposes the availability and the nearest available entries with their titles', async () => {
      const { result } = offlineAt('v-2')
      await flush()

      expect(result.current.availableVersionIds).toEqual(new Set(['v-1', 'v-3', 'v-5']))
      expect(result.current.prevEntry).toEqual(FIVE[0])
      expect(result.current.nextEntry).toEqual(FIVE[2])
    })

    it('uses the plain neighbours until the availability read settles', async () => {
      const { result } = offlineAt('v-3')

      expect(result.current.availableVersionIds).toBeNull()
      expect(result.current.nav).toMatchObject({ prevId: 'v-2', nextId: 'v-4' })

      await flush()
      expect(result.current.nav).toMatchObject({ prevId: 'v-1', nextId: 'v-5' })
    })

    it('online, walks sequentially and never reads the store', async () => {
      const store = storeWith()
      seed(FIVE_QUEUE)
      const { result, navigate } = setup({ currentVersionId: 'v-3', bandId: null, offline: false, store })
      await flush()

      expect(store.listOfflineSongs).not.toHaveBeenCalled()
      expect(result.current.availableVersionIds).toBeNull()
      press('ArrowRight')
      expect(navigate).toHaveBeenLastCalledWith('/songs/v-4/fast-view?')
      press('ArrowLeft')
      expect(navigate).toHaveBeenLastCalledWith('/songs/v-2/fast-view?')
      act(() => result.current.selectEntry('v-4'))
      act(() => { vi.advanceTimersByTime(SLIDE_OUT_MS) })
      expect(navigate).toHaveBeenLastCalledWith('/songs/v-4/fast-view?')
    })
  })
})
