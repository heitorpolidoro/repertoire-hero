// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { usePdfStage, type PdfStageActions, type UsePdfStageOptions, type VisualViewportLike } from '@/hooks/usePdfStage'
import { stageHistoryState } from '@/lib/stageHistory'
import type { Stroke, TabAnnotations } from '@/types/database'

afterEach(cleanup)
afterEach(() => vi.unstubAllGlobals())
afterEach(() => vi.restoreAllMocks())
afterEach(() => {
  document.body.innerHTML = ''
})

const ANNOTATIONS: TabAnnotations = { '1': [] }
const STROKE: Stroke = { id: 's-1', color: '#ef4444', width: 0.004, points: [[0.1, 0.2]] }

type ActionSpies = { [K in keyof PdfStageActions]: Mock }

function makeActions(): ActionSpies {
  return {
    getAnnotations: vi.fn().mockResolvedValue({ data: ANNOTATIONS }),
    saveAnnotations: vi.fn().mockResolvedValue({ success: true }),
  }
}

/** jsdom defines no `window.visualViewport`, so the fake is injected instead. */
type ViewportSpy = VisualViewportLike & { addEventListener: Mock; removeEventListener: Mock }

function makeViewport(overrides: Partial<VisualViewportLike> = {}): ViewportSpy {
  return {
    height: 640,
    scale: 1,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    ...overrides,
  }
}

/** The listeners the hook registered on the fake viewport, by event type. */
function listenersOf(vv: ViewportSpy, type: string): (() => void)[] {
  return vv.addEventListener.mock.calls
    .filter((call: unknown[]) => call[0] === type)
    .map((call: unknown[]) => call[1] as () => void)
}

function setup(overrides: Partial<UsePdfStageOptions> = {}) {
  const actions = (overrides.actions as ActionSpies | undefined) ?? makeActions()
  const initialProps: UsePdfStageOptions = {
    tabId: 't-1',
    repertoireId: 'rep-1',
    ...overrides,
    actions,
  }
  const view = renderHook((props: UsePdfStageOptions) => usePdfStage(props), { initialProps })
  return { ...view, actions, initialProps }
}

/** A scrollable ancestor with the overlay ref pointing at a child of it. */
function mountScrollHost(ref: { current: HTMLDivElement | null }) {
  const host = document.createElement('div')
  host.style.overflowY = 'auto'
  const overlay = document.createElement('div')
  host.appendChild(overlay)
  document.body.appendChild(host)
  ref.current = overlay
  return host
}

describe('usePdfStage', () => {
  it('starts closed and exposes no annotations', () => {
    const { result, actions } = setup()

    expect(result.current.isOpen).toBe(false)
    expect(result.current.height).toBeNull()
    expect(result.current.annotations).toBeNull()
    expect(result.current.annotationsError).toBeNull()
    expect(result.current.overlayRef.current).toBeNull()
    expect(actions.getAnnotations).not.toHaveBeenCalled()
  })

  it('loads the annotations of the active tab when the stage opens', async () => {
    const { result, actions } = setup({ getViewport: () => makeViewport() })

    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)

    await waitFor(() => expect(result.current.annotations).toEqual(ANNOTATIONS))
    expect(actions.getAnnotations).toHaveBeenCalledWith('t-1', 'rep-1')
    expect(actions.getAnnotations).toHaveBeenCalledTimes(1)
    expect(result.current.annotationsError).toBeNull()
  })

  it('does not load annotations while the stage is closed', () => {
    const { rerender, actions, initialProps } = setup()

    rerender({ ...initialProps, tabId: 't-2' })

    expect(actions.getAnnotations).not.toHaveBeenCalled()
  })

  it('reports the load error returned by the action', async () => {
    const actions = makeActions()
    actions.getAnnotations.mockResolvedValue({ error: 'Tab not found' })
    const { result } = setup({ actions: actions as unknown as PdfStageActions })

    act(() => result.current.open())

    await waitFor(() => expect(result.current.annotationsError).toBe('Tab not found'))
    // A failed load still hands the stage an empty (not null) annotation map.
    expect(result.current.annotations).toEqual({})
  })

  it('keeps the annotations null until the newly selected tab has loaded its own', async () => {
    const { result, rerender, actions, initialProps } = setup()

    act(() => result.current.open())
    await waitFor(() => expect(result.current.annotations).toEqual(ANNOTATIONS))

    // The second tab's fetch is still in flight: the first tab's payload must
    // not be shown for it.
    actions.getAnnotations.mockReturnValue(new Promise(() => {}))
    rerender({ ...initialProps, tabId: 't-2' })

    expect(result.current.annotations).toBeNull()
    expect(result.current.annotationsError).toBeNull()
    expect(actions.getAnnotations).toHaveBeenLastCalledWith('t-2', 'rep-1')
  })

  it('passes a save through to the action with the active tab and repertoire ids', async () => {
    const { result, actions } = setup()

    const res = await result.current.saveAnnotations(2, [STROKE])

    expect(actions.saveAnnotations).toHaveBeenCalledWith('t-1', 'rep-1', 2, [STROKE])
    expect(res).toEqual({ success: true })
  })

  it('refuses to save when no tab is active and never calls the action', async () => {
    const { result, actions } = setup({ tabId: null, repertoireId: null })

    expect(await result.current.saveAnnotations(1, [STROKE])).toEqual({ error: 'Tab not found' })
    expect(actions.saveAnnotations).not.toHaveBeenCalled()
  })

  it('measures the overlay height from the visual viewport when the stage opens', () => {
    const vv = makeViewport({ height: 640 })
    const { result } = setup({ getViewport: () => vv })

    act(() => result.current.open())

    expect(result.current.height).toBe(640)
  })

  it('keeps the last stable height while the visual viewport is pinch-zoomed', () => {
    const vv = makeViewport({ height: 640 })
    const { result } = setup({ getViewport: () => vv })

    act(() => result.current.open())
    expect(result.current.height).toBe(640)

    // A pinch-zoomed visual viewport reports a fraction of the layout viewport.
    vv.scale = 2
    vv.height = 320
    act(() => listenersOf(vv, 'resize').forEach((listener) => listener()))

    expect(result.current.height).toBe(640)
  })

  it('falls back to the window inner height when there is no visual viewport', () => {
    vi.stubGlobal('innerHeight', 900)
    const { result } = setup({ getViewport: () => undefined })

    act(() => result.current.open())

    expect(result.current.height).toBe(900)
  })

  it('re-measures on visual viewport resize and scroll and drops every listener on close', () => {
    vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const removeWindowListener = vi.spyOn(window, 'removeEventListener')
    const vv = makeViewport({ height: 640 })
    const { result } = setup({ getViewport: () => vv })

    act(() => result.current.open())
    expect(listenersOf(vv, 'resize')).toHaveLength(1)
    expect(listenersOf(vv, 'scroll')).toHaveLength(1)

    // iOS Safari fires only `scroll` for some chrome transitions.
    vv.height = 500
    act(() => listenersOf(vv, 'scroll').forEach((listener) => listener()))
    expect(result.current.height).toBe(500)

    act(() => result.current.close())

    expect(result.current.height).toBeNull()
    expect(vv.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(vv.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function))
    const windowTypes = removeWindowListener.mock.calls.map((call) => call[0])
    expect(windowTypes).toContain('resize')
    expect(windowTypes).toContain('orientationchange')
  })

  it('locks the scroll host while the stage is open and restores it verbatim on close', () => {
    vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const { result } = setup({ getViewport: () => makeViewport() })
    const host = mountScrollHost(result.current.overlayRef)
    const previous = host.style.overflow

    act(() => result.current.open())
    expect(host.style.overflow).toBe('hidden')
    // RH-28 section 3: only the resolved host is frozen, never the document body.
    expect(document.body.getAttribute('style')).toBeNull()

    act(() => result.current.close())

    expect(host.style.overflow).toBe(previous)
  })

  it('pushes exactly one history entry when the stage opens', () => {
    const pushState = vi.spyOn(window.history, 'pushState')
    const { result, rerender, initialProps } = setup({ getViewport: () => makeViewport() })

    act(() => result.current.open())
    rerender({ ...initialProps })

    expect(pushState).toHaveBeenCalledTimes(1)
    expect(pushState).toHaveBeenCalledWith(stageHistoryState(), '')
  })

  it('exits the stage when the browser back button fires popstate', () => {
    const { result } = setup({ getViewport: () => makeViewport() })

    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(result.current.isOpen).toBe(false)
  })

  it('closing from the toolbar goes back only when the Stage Mode history entry is on top', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const { result } = setup({ getViewport: () => makeViewport() })

    act(() => result.current.open())
    act(() => result.current.close())

    expect(result.current.isOpen).toBe(false)
    expect(back).toHaveBeenCalledTimes(1)

    // Reopened, then something else replaced the entry on top: closing must not
    // pop a history entry that Stage Mode did not push.
    act(() => result.current.open())
    act(() => window.history.replaceState({}, ''))
    act(() => result.current.close())

    expect(result.current.isOpen).toBe(false)
    expect(back).toHaveBeenCalledTimes(1)
  })

  it('reads the browser visual viewport when no reader is injected', () => {
    vi.stubGlobal('innerHeight', 812)
    const { result } = setup()

    act(() => result.current.open())

    expect(result.current.height).toBe(812)
  })
})
