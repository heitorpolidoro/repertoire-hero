// @vitest-environment jsdom
/**
 * RH-96 — `useBandRole` is the client half of the band-admin gate, so the only
 * thing worth asserting is that it fails closed: `null` before the read
 * settles, `null` without a band, `null` on a refusal, and a stale band's
 * answer never shown for the band that replaced it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, cleanup, waitFor } from '@testing-library/react'
import { useBandRole, type BandRole } from '../useBandRole'

afterEach(cleanup)

describe('useBandRole', () => {
  it('asks for nothing and stays null without a band', () => {
    const getBandRole = vi.fn<(bandId: string) => Promise<BandRole>>()

    const { result } = renderHook(() => useBandRole(null, getBandRole))

    expect(result.current).toBeNull()
    expect(getBandRole).not.toHaveBeenCalled()
  })

  it('is null until the read resolves, then reports the role', async () => {
    const getBandRole = vi.fn(async () => 'admin' as BandRole)

    const { result } = renderHook(() => useBandRole('band-1', getBandRole))
    expect(result.current).toBeNull()

    await waitFor(() => expect(result.current).toBe('admin'))
    expect(getBandRole).toHaveBeenCalledExactlyOnceWith('band-1')
  })

  it('stays null when the read is refused', async () => {
    const getBandRole = vi.fn(async () => {
      throw new Error('Access denied: not a member of this band')
    })

    const { result } = renderHook(() => useBandRole('band-1', getBandRole))

    await waitFor(() => expect(getBandRole).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })

  it.each([
    ['resolves', (resolve: (r: BandRole) => void) => resolve('admin')],
    ['is refused', (_r: (r: BandRole) => void, reject: (e: Error) => void) => reject(new Error('gone'))],
  ])('writes no state when the read %s after the hook unmounted', async (_label, settle) => {
    let resolve!: (role: BandRole) => void
    let reject!: (error: Error) => void
    const getBandRole = vi.fn(
      () =>
        new Promise<BandRole>((res, rej) => {
          resolve = res
          reject = rej
        }),
    )

    const { result, unmount } = renderHook(() => useBandRole('band-1', getBandRole))
    unmount()
    settle(resolve, reject)
    await Promise.resolve()

    expect(result.current).toBeNull()
  })

  it('never reports one band\'s role for another', async () => {
    const roles: Record<string, BandRole> = { 'band-1': 'admin', 'band-2': 'member' }
    const getBandRole = vi.fn(async (bandId: string) => roles[bandId])

    const { result, rerender } = renderHook(({ bandId }) => useBandRole(bandId, getBandRole), {
      initialProps: { bandId: 'band-1' },
    })
    await waitFor(() => expect(result.current).toBe('admin'))

    rerender({ bandId: 'band-2' })
    expect(result.current).toBeNull()

    await waitFor(() => expect(result.current).toBe('member'))
  })
})
