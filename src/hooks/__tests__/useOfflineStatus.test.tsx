// @vitest-environment jsdom
/**
 * RH-78 — `useOfflineStatus` is the online/offline signal the rest of the
 * offline feature (RH-79, RH-80) reads. Three things are the contract: the
 * initial value comes from `navigator.onLine`, the value flips on the `window`
 * `online`/`offline` events, and both listeners are removed on unmount.
 *
 * Like `useHydrated` (RH-77) it is a `useSyncExternalStore`, deliberately, and
 * not `useState` + `useEffect`: that shape is a
 * `react-hooks/set-state-in-effect` error under this repository's eslint
 * config.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, renderHook, cleanup } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { useOfflineStatus } from '../useOfflineStatus'

afterEach(() => {
  cleanup()
  setOnLine(true)
})

function setOnLine(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  })
}

function Probe() {
  return <span>{useOfflineStatus() ? 'offline' : 'online'}</span>
}

describe('useOfflineStatus', () => {
  it('reports online when navigator.onLine is true', () => {
    setOnLine(true)

    const { result } = renderHook(() => useOfflineStatus())

    expect(result.current).toBe(false)
  })

  it('reports offline when navigator.onLine is false at mount', () => {
    setOnLine(false)

    const { result } = renderHook(() => useOfflineStatus())

    expect(result.current).toBe(true)
  })

  it('flips to offline on the window offline event', () => {
    setOnLine(true)
    const { result } = renderHook(() => useOfflineStatus())

    act(() => {
      setOnLine(false)
      window.dispatchEvent(new Event('offline'))
    })

    expect(result.current).toBe(true)
  })

  it('flips back to online on the window online event', () => {
    setOnLine(false)
    const { result } = renderHook(() => useOfflineStatus())

    act(() => {
      setOnLine(true)
      window.dispatchEvent(new Event('online'))
    })

    expect(result.current).toBe(false)
  })

  it('removes both listeners on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')

    const { unmount } = renderHook(() => useOfflineStatus())

    const added = add.mock.calls.filter(([type]) => type === 'online' || type === 'offline')
    expect(added.map(([type]) => type).sort()).toEqual(['offline', 'online'])

    unmount()

    const removed = remove.mock.calls.filter(([type]) => type === 'online' || type === 'offline')
    expect(removed.map(([type]) => type).sort()).toEqual(['offline', 'online'])

    add.mockRestore()
    remove.mockRestore()
  })

  it('reports online during a server render', () => {
    expect(renderToString(<Probe />)).toContain('online')
  })

  it('uses useSyncExternalStore and no useEffect (ER10)', () => {
    // `import.meta.url` is not a file URL under the jsdom environment, so the
    // source is read from the project root instead.
    const source = readFileSync(
      path.join(process.cwd(), 'src/hooks/useOfflineStatus.ts'),
      'utf8',
    )

    // Comments are stripped first: the prose above the hook explains *why*
    // `useEffect` is not used, and naming it there must not fail the guard.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    expect(code).toContain('useSyncExternalStore')
    expect(code).not.toMatch(/\buseEffect\b/)
  })
})
