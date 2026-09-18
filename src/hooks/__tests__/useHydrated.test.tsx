// @vitest-environment jsdom
/**
 * RH-77 — `useHydrated` is the guard that keeps a `localStorage`-rehydrated
 * store out of the server render. The two snapshots are the whole contract:
 * `false` on the server, `true` in the browser, with no `setState` in an
 * effect (which is a `react-hooks/set-state-in-effect` error under this
 * repository's eslint config — see `AppLayout.tsx:48` and `:165`).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { useHydrated } from '../useHydrated'

afterEach(cleanup)

function Probe() {
  return <span>{useHydrated() ? 'hydrated' : 'server'}</span>
}

describe('useHydrated', () => {
  it('returns true in the browser', () => {
    const { result } = renderHook(() => useHydrated())

    expect(result.current).toBe(true)
  })

  it('returns false during a server render', () => {
    expect(renderToString(<Probe />)).toContain('server')
  })

  it('stays true across a re-render without subscribing to anything', () => {
    const { result, rerender } = renderHook(() => useHydrated())
    rerender()

    expect(result.current).toBe(true)
  })
})
