// @vitest-environment jsdom
/**
 * RH-158 — the per-song "Practised" commands of `/playlists/[id]`.
 *
 * Plain `vi.fn()` actions: nothing here imports a Server Action. The owner every
 * write carries is the playlist's band id, which the Server Action turns into
 * the admin rule.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { usePractiseSong } from '@/hooks/usePractiseSong'

afterEach(cleanup)

function setup(bandId: string | null = null, overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const actions = {
    recordPractice: vi.fn().mockResolvedValue(undefined),
    recordPracticeStatus: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  const setError = vi.fn()
  const onRefresh = vi.fn()
  const view = renderHook(() => usePractiseSong({ actions, bandId, setError, onRefresh }))
  return { ...view, actions, setError, onRefresh }
}

describe('usePractiseSong', () => {
  it('practise writes the date for the version with the band id, refreshes and reports success', async () => {
    const { result, actions, onRefresh, setError } = setup('band-1')

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.practise('v1')
    })

    expect(ok).toBe(true)
    expect(actions.recordPractice).toHaveBeenCalledWith([{ versionId: 'v1' }], 'band-1')
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(setError).toHaveBeenCalledWith(null)
  })

  it('practise reports failure through the error path and does not refresh', async () => {
    const { result, onRefresh, setError } = setup(null, {
      recordPractice: vi.fn().mockRejectedValue(new Error('Access denied: not a member of this band')),
    })

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.practise('v1')
    })

    expect(ok).toBe(false)
    expect(setError).toHaveBeenLastCalledWith('Access denied: not a member of this band')
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('practise falls back to a fixed message for a non-Error rejection', async () => {
    const { result, setError } = setup(null, { recordPractice: vi.fn().mockRejectedValue('boom') })

    await act(async () => {
      await result.current.practise('v1')
    })

    expect(setError).toHaveBeenLastCalledWith('Failed to record practice')
  })

  it('practiseStatus issues the status-only action and refreshes', async () => {
    const { result, actions, onRefresh } = setup('band-1')

    await act(async () => {
      await result.current.practiseStatus('v1', 'polishing')
    })

    expect(actions.recordPracticeStatus).toHaveBeenCalledWith([{ versionId: 'v1', status: 'polishing' }], 'band-1')
    expect(actions.recordPractice).not.toHaveBeenCalled()
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('practiseStatus reports a failure through the error path', async () => {
    const { result, onRefresh, setError } = setup(null, {
      recordPracticeStatus: vi.fn().mockRejectedValue(new Error('nope')),
    })

    await act(async () => {
      await result.current.practiseStatus('v1', 'learning')
    })

    expect(setError).toHaveBeenLastCalledWith('nope')
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('practiseStatus falls back to a fixed message for a non-Error rejection', async () => {
    const { result, setError } = setup(null, { recordPracticeStatus: vi.fn().mockRejectedValue(1) })

    await act(async () => {
      await result.current.practiseStatus('v1', 'learning')
    })

    expect(setError).toHaveBeenLastCalledWith('Failed to update status')
  })
})
