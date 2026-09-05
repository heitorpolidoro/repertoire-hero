// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, cleanup } from '@testing-library/react'
import { useToast } from '../useToast'

afterEach(cleanup)

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** Advance the auto-dismiss timer inside `act` so the state update is flushed. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('useToast', () => {
  it('starts with no toast', () => {
    const { result } = renderHook(() => useToast())

    expect(result.current.toast).toBeNull()
  })

  it.each([
    ['defaults to the neutral info tone', undefined, 'info'],
    ['keeps an explicit success tone', 'success' as const, 'success'],
    ['keeps an explicit error tone', 'error' as const, 'error'],
    ['keeps an explicit warning tone', 'warning' as const, 'warning'],
  ])('showToast %s', (_label, tone, expected) => {
    const { result } = renderHook(() => useToast())

    act(() => {
      if (tone) result.current.showToast('Heads up', tone)
      else result.current.showToast('Heads up')
    })

    expect(result.current.toast).toEqual({ message: 'Heads up', tone: expected })
  })

  it('auto-dismisses at exactly 4000ms and not a millisecond earlier', () => {
    const { result } = renderHook(() => useToast())

    act(() => result.current.showToast('Saved'))

    advance(3999)
    expect(result.current.toast).not.toBeNull()

    advance(1)
    expect(result.current.toast).toBeNull()
  })

  it('dismissToast clears the toast immediately', () => {
    const { result } = renderHook(() => useToast())

    act(() => result.current.showToast('Saved'))
    act(() => result.current.dismissToast())

    expect(result.current.toast).toBeNull()
  })

  it('restarts the timer when a toast is replaced, so the replacement gets its full 4s', () => {
    const { result } = renderHook(() => useToast())

    act(() => result.current.showToast('First'))
    advance(3000)

    act(() => result.current.showToast('Second', 'error'))
    advance(3000)

    // The first toast's timer must have been cleared, not merely re-armed.
    expect(result.current.toast).toEqual({ message: 'Second', tone: 'error' })

    advance(1000)
    expect(result.current.toast).toBeNull()
  })

  it('clears the pending timer on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { result, unmount } = renderHook(() => useToast())

    act(() => result.current.showToast('Saved'))
    unmount()

    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})
