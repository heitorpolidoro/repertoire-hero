// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, renderHook, act } from '@testing-library/react'
import { useEdgeDoubleTap } from '../useEdgeDoubleTap'

afterEach(cleanup)
afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function firePointer(
  type: string,
  options: { clientX: number; clientY?: number; target?: EventTarget; pointerId?: number },
) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: options.clientX,
    clientY: options.clientY ?? 200,
    pointerId: options.pointerId ?? 1,
  })
  const target = options.target ?? document.body
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

function simulateTap(clientX: number, clientY = 200, target?: EventTarget) {
  firePointer('pointerdown', { clientX, clientY, target })
  firePointer('pointerup', { clientX, clientY, target })
}

/** Two fingers down together in one edge zone, then lifted — a pinch, not a tap. */
function simulatePinch(clientX: number) {
  firePointer('pointerdown', { clientX, pointerId: 1 })
  firePointer('pointerdown', { clientX: clientX + 5, clientY: 210, pointerId: 2 })
  firePointer('pointerup', { clientX, pointerId: 1 })
  firePointer('pointerup', { clientX: clientX + 5, clientY: 210, pointerId: 2 })
}

function setupHook(enabled = true) {
  const onPrev = vi.fn()
  const onNext = vi.fn()
  const view = renderHook(
    (props: { enabled: boolean; onPrev: () => void; onNext: () => void }) => useEdgeDoubleTap(props),
    { initialProps: { enabled, onPrev, onNext } },
  )
  return { ...view, onPrev, onNext }
}

describe('useEdgeDoubleTap', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1000 })
  })

  it('calls onNext on right edge double-tap and onPrev on left edge double-tap', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    renderHook(() => useEdgeDoubleTap({ enabled: true, onPrev, onNext }))

    // Right edge tap (x = 950 in 1000px viewport)
    simulateTap(950)
    expect(onNext).not.toHaveBeenCalled()

    simulateTap(955)
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onPrev).not.toHaveBeenCalled()

    // Left edge tap (x = 40 in 1000px viewport)
    simulateTap(40)
    expect(onPrev).not.toHaveBeenCalled()

    simulateTap(45)
    expect(onPrev).toHaveBeenCalledTimes(1)
  })

  it('does nothing when enabled is false', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    renderHook(() => useEdgeDoubleTap({ enabled: false, onPrev, onNext }))

    simulateTap(950)
    simulateTap(950)
    expect(onNext).not.toHaveBeenCalled()

    simulateTap(30)
    simulateTap(30)
    expect(onPrev).not.toHaveBeenCalled()
  })

  it('single tap alone does not fire onNext or onPrev', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    renderHook(() => useEdgeDoubleTap({ enabled: true, onPrev, onNext }))

    simulateTap(950)
    expect(onNext).not.toHaveBeenCalled()
    expect(onPrev).not.toHaveBeenCalled()

    simulateTap(30)
    expect(onNext).not.toHaveBeenCalled()
    expect(onPrev).not.toHaveBeenCalled()
  })

  it('vertical drag movement does not trigger double-tap', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    renderHook(() => useEdgeDoubleTap({ enabled: true, onPrev, onNext }))

    // First tap is normal
    simulateTap(950, 100)

    // Second gesture moves vertically by 60px (drag)
    firePointer('pointerdown', { clientX: 950, clientY: 100 })
    firePointer('pointermove', { clientX: 950, clientY: 160 })
    firePointer('pointerup', { clientX: 950, clientY: 160 })

    expect(onNext).not.toHaveBeenCalled()
  })

  it('taps on button/input elements are ignored', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    renderHook(() => useEdgeDoubleTap({ enabled: true, onPrev, onNext }))

    const button = document.createElement('button')
    document.body.appendChild(button)

    simulateTap(950, 200, button)
    simulateTap(950, 200, button)

    expect(onNext).not.toHaveBeenCalled()

    const input = document.createElement('input')
    document.body.appendChild(input)

    simulateTap(40, 200, input)
    simulateTap(40, 200, input)

    expect(onPrev).not.toHaveBeenCalled()
  })

  it('ignores taps on a contenteditable element', () => {
    const { onNext } = setupHook()
    const editable = document.createElement('div')
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    document.body.appendChild(editable)

    simulateTap(950, 200, editable)
    simulateTap(950, 200, editable)

    expect(onNext).not.toHaveBeenCalled()
  })

  it('counts a gesture dispatched on a non-element target as a tap', () => {
    const { onNext } = setupHook()

    simulateTap(950, 200, document)
    simulateTap(950, 200, document)

    expect(onNext).toHaveBeenCalledTimes(1)
  })

  // ER4: two overlapping pointers in an edge zone are a pinch/zoom on the PDF.
  describe('multi-touch (pinch) guard', () => {
    it('two consecutive pinches in an edge zone never navigate', () => {
      const { onPrev, onNext } = setupHook()

      simulatePinch(950)
      simulatePinch(950)
      simulatePinch(30)
      simulatePinch(30)

      expect(onNext).not.toHaveBeenCalled()
      expect(onPrev).not.toHaveBeenCalled()
    })

    it('a pinch between two edge taps breaks the pair', () => {
      const { onNext } = setupHook()

      simulateTap(950)
      simulatePinch(950)
      simulateTap(950)

      expect(onNext).not.toHaveBeenCalled()
    })

    it('a lone second finger joining a tap discards that tap', () => {
      const { onNext } = setupHook()

      simulateTap(950)
      firePointer('pointerdown', { clientX: 950, pointerId: 1 })
      firePointer('pointerdown', { clientX: 960, pointerId: 2 })
      // The first finger lifts while the second is still down: still a pinch.
      firePointer('pointerup', { clientX: 950, pointerId: 1 })
      expect(onNext).not.toHaveBeenCalled()

      firePointer('pointerup', { clientX: 960, pointerId: 2 })
      expect(onNext).not.toHaveBeenCalled()
    })

    it('an edge double-tap navigates again once every finger of the pinch is lifted', () => {
      const { onNext } = setupHook()

      simulatePinch(950)
      simulateTap(950)
      simulateTap(955)

      expect(onNext).toHaveBeenCalledTimes(1)
    })
  })

  describe('pointercancel', () => {
    it('a cancel between two edge taps breaks the pair', () => {
      const { onPrev, onNext } = setupHook()

      simulateTap(950)
      firePointer('pointercancel', { clientX: 950 })
      simulateTap(950)

      simulateTap(30)
      firePointer('pointercancel', { clientX: 30 })
      simulateTap(30)

      expect(onNext).not.toHaveBeenCalled()
      expect(onPrev).not.toHaveBeenCalled()
    })

    it('a cancelled second tap never completes the pair', () => {
      const { onNext } = setupHook()

      simulateTap(950)
      firePointer('pointerdown', { clientX: 950 })
      firePointer('pointercancel', { clientX: 950 })
      // The browser took the gesture over; the lift it never reports is not a tap.
      firePointer('pointerup', { clientX: 950 })

      expect(onNext).not.toHaveBeenCalled()
    })

    it('a pinch whose pointers are cancelled resets, so a later double-tap navigates', () => {
      const { onNext } = setupHook()

      firePointer('pointerdown', { clientX: 950, pointerId: 1 })
      firePointer('pointerdown', { clientX: 960, pointerId: 2 })
      firePointer('pointercancel', { clientX: 950, pointerId: 1 })
      firePointer('pointercancel', { clientX: 960, pointerId: 2 })

      simulateTap(950)
      simulateTap(955)

      expect(onNext).toHaveBeenCalledTimes(1)
    })
  })

  it('taps in the central reading area never navigate', () => {
    const { onPrev, onNext } = setupHook()

    simulateTap(500)
    simulateTap(500)

    expect(onNext).not.toHaveBeenCalled()
    expect(onPrev).not.toHaveBeenCalled()
  })

  it('a pointerup with no matching pointerdown is ignored', () => {
    const { onNext } = setupHook()

    simulateTap(950)
    firePointer('pointerup', { clientX: 950, pointerId: 7 })

    expect(onNext).not.toHaveBeenCalled()
  })

  it('a long press in an edge zone is not a tap and breaks the pair', () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1_000)
    const { onNext } = setupHook()

    simulateTap(950)
    firePointer('pointerdown', { clientX: 950 })
    now.mockReturnValue(1_700)
    firePointer('pointerup', { clientX: 950 })
    simulateTap(950)

    expect(onNext).not.toHaveBeenCalled()
  })

  it('keeps the largest travel of a gesture that wanders and returns to its start', () => {
    const { onNext } = setupHook()

    simulateTap(950)
    firePointer('pointerdown', { clientX: 950, clientY: 200 })
    firePointer('pointermove', { clientX: 950, clientY: 260 })
    firePointer('pointermove', { clientX: 950, clientY: 205 })
    firePointer('pointerup', { clientX: 950, clientY: 200 })

    expect(onNext).not.toHaveBeenCalled()
  })

  it('ignores a pointermove from a pointer it is not tracking', () => {
    const { onNext } = setupHook()

    firePointer('pointermove', { clientX: 950, pointerId: 9 })
    simulateTap(950)
    simulateTap(955)

    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('forgets a pending tap when disabled, so re-enabling starts a fresh pair', () => {
    const { onNext, rerender, onPrev } = setupHook()

    simulateTap(950)
    rerender({ enabled: false, onPrev, onNext })
    rerender({ enabled: true, onPrev, onNext })
    simulateTap(950)

    expect(onNext).not.toHaveBeenCalled()
  })

  it('calls the latest callbacks after a re-render', () => {
    const { onPrev, onNext, rerender } = setupHook()
    const latestNext = vi.fn()

    rerender({ enabled: true, onPrev, onNext: latestNext })
    simulateTap(950)
    simulateTap(955)

    expect(onNext).not.toHaveBeenCalled()
    expect(latestNext).toHaveBeenCalledTimes(1)
  })
})
