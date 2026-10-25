// @vitest-environment jsdom
/**
 * RH-181 — `useContextSwitch` is the one switch routine both context controls
 * call: the desktop sidebar switcher and the mobile sheet. A switch writes the
 * persisted `band-context` store, reloads the songs, then returns to `/`, in
 * that order.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup, act } from '@testing-library/react'

const { steps, pushSpy, loadSongsSpy } = vi.hoisted(() => {
  const steps: string[] = []
  return {
    steps,
    pushSpy: vi.fn((href: string) => {
      steps.push(`push:${href}`)
    }),
    loadSongsSpy: vi.fn(async () => {
      steps.push('loadSongs')
    }),
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushSpy }),
}))

vi.mock('@/store/repertoireStore', () => ({
  useRepertoireStore: (selector: (state: { loadSongs: () => Promise<void> }) => unknown) =>
    selector({ loadSongs: loadSongsSpy }),
}))

import { useContextSwitch } from '../useContextSwitch'
import { useBandContextStore } from '@/store/bandContextStore'

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  steps.length = 0
  useBandContextStore.getState().setUserContext()
})

describe('useContextSwitch', () => {
  it('writes a band target with its id, name and colour, then reloads and goes home', () => {
    const unsubscribe = useBandContextStore.subscribe((state) => {
      steps.push(`store:${state.context.type}`)
    })
    const { result } = renderHook(() => useContextSwitch())

    act(() => {
      result.current.switchTo({ type: 'band', id: 'band-1', name: 'The Owls', color: '#7c3aed' })
    })
    unsubscribe()

    expect(useBandContextStore.getState().context).toEqual({
      type: 'band',
      id: 'band-1',
      name: 'The Owls',
      color: '#7c3aed',
    })
    expect(steps).toEqual(['store:band', 'loadSongs', 'push:/'])
  })

  it('writes the personal context for a user target', () => {
    useBandContextStore.getState().setBandContext('band-1', 'The Owls')
    const { result } = renderHook(() => useContextSwitch())

    act(() => {
      result.current.switchTo({ type: 'user' })
    })

    expect(useBandContextStore.getState().context).toEqual({ type: 'user' })
    expect(loadSongsSpy).toHaveBeenCalledTimes(1)
    expect(pushSpy).toHaveBeenCalledWith('/')
  })

  it('keeps a band target without a colour colourless', () => {
    const { result } = renderHook(() => useContextSwitch())

    act(() => {
      result.current.switchTo({ type: 'band', id: 'band-2', name: 'Trio' })
    })

    expect(useBandContextStore.getState().context).toEqual({
      type: 'band',
      id: 'band-2',
      name: 'Trio',
      color: undefined,
    })
  })
})
