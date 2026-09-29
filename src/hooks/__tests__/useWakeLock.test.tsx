// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useWakeLock } from '../useWakeLock'

afterEach(() => {
  cleanup()
  // Remove the stub so every test decides whether the API exists.
  delete (navigator as { wakeLock?: unknown }).wakeLock
})

function makeSentinel() {
  const sentinel = {
    released: false,
    release: vi.fn(async () => {
      sentinel.released = true
    }),
  }
  return sentinel
}

function stubWakeLock(request: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useWakeLock', () => {
  it('requests a screen lock on mount and releases it on unmount', async () => {
    setVisibility('visible')
    const sentinel = makeSentinel()
    const request = vi.fn().mockResolvedValue(sentinel)
    stubWakeLock(request)

    const { unmount } = renderHook(() => useWakeLock())
    await flush()
    expect(request).toHaveBeenCalledWith('screen')

    unmount()
    expect(sentinel.release).toHaveBeenCalledTimes(1)
  })

  it('requests the lock again when the page comes back into view', async () => {
    setVisibility('visible')
    const first = makeSentinel()
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(makeSentinel())
    stubWakeLock(request)
    renderHook(() => useWakeLock())
    await flush()

    // The browser drops the lock while hidden.
    first.released = true
    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(request).toHaveBeenCalledTimes(1)

    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('releases a lock granted after the page already unmounted', async () => {
    setVisibility('visible')
    const sentinel = makeSentinel()
    let grant: (value: unknown) => void = () => {}
    stubWakeLock(vi.fn().mockReturnValue(new Promise((resolve) => { grant = resolve })))

    const { unmount } = renderHook(() => useWakeLock())
    unmount()
    grant(sentinel)
    await flush()

    expect(sentinel.release).toHaveBeenCalledTimes(1)
  })

  it('does nothing without the API and swallows a refused request', async () => {
    setVisibility('visible')
    expect(() => renderHook(() => useWakeLock())).not.toThrow()

    stubWakeLock(vi.fn().mockRejectedValue(new Error('NotAllowedError')))
    renderHook(() => useWakeLock())
    await flush()
  })
})
