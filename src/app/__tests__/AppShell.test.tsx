// @vitest-environment jsdom
/**
 * RH-98 — `AppShell` applies the band-context reconciliation.
 *
 * The decision itself is unit-tested in `src/lib/__tests__/bandContext.test.ts`;
 * this suite drives the **real** `bandContextStore` through the component's
 * mount effect and asserts what the store ends up holding.
 *
 * Mocks, and why each one is here:
 *   - `@/lib/auth-client` — the shell only fetches for a signed-in session.
 *   - `@/app/actions/bands` — the fetch under test; a Server Action cannot run
 *     in vitest, and each case needs its own resolution or rejection.
 *   - `@/store/repertoireStore` — importing it for real pulls
 *     `@/app/actions/repertoire` and therefore `pg` into jsdom. The spy is also
 *     how the reload-after-reset is counted.
 *   - `@/components/layout/ConditionalLayout` — the chrome is presentational
 *     and has its own suite (`AppLayout.test.tsx`); stubbing it keeps this file
 *     about the reconciliation, and lets the router spy prove `AppShell`
 *     navigates nowhere.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import AppShell from '@/app/AppShell'
import { useBandContextStore } from '@/store/bandContextStore'
import { DEFAULT_BAND_COLOR } from '@/lib/bandColors'
import type { BandOption } from '@/types/database'

const { getBandsSpy, loadSongsSpy, pushSpy, loggerErrorSpy } = vi.hoisted(() => ({
  getBandsSpy: vi.fn(),
  loadSongsSpy: vi.fn(),
  pushSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: 'user-1' } } }),
  },
}))

vi.mock('@/app/actions/bands', () => ({
  getBandsAction: getBandsSpy,
}))

vi.mock('@/store/repertoireStore', () => ({
  useRepertoireStore: {
    getState: () => ({ loadSongs: loadSongsSpy }),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: loggerErrorSpy, warn: vi.fn(), info: vi.fn() },
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: pushSpy }),
}))

vi.mock('@/components/layout/ConditionalLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const BANDS: BandOption[] = [
  { id: 'band-1', name: 'Stone Pilots', color: '#1d4ed8' },
  { id: 'band-2', name: 'The Nulls', color: null },
]

function renderShell() {
  return render(<AppShell>content</AppShell>)
}

describe('AppShell band-context reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useBandContextStore.setState({ context: { type: 'user' } })
  })

  afterEach(cleanup)

  it('resets a context whose band is absent from the fetched list (ER2)', async () => {
    useBandContextStore.setState({
      context: { type: 'band', id: 'band-gone', name: 'Disbanded', color: DEFAULT_BAND_COLOR },
    })
    getBandsSpy.mockResolvedValue(BANDS)

    renderShell()

    await waitFor(() => {
      expect(useBandContextStore.getState().context).toEqual({ type: 'user' })
    })
  })

  it('resets a band context when the resolved list is empty (ER3)', async () => {
    useBandContextStore.setState({
      context: { type: 'band', id: 'band-1', name: 'Stone Pilots', color: '#1d4ed8' },
    })
    getBandsSpy.mockResolvedValue([])

    renderShell()

    await waitFor(() => {
      expect(useBandContextStore.getState().context).toEqual({ type: 'user' })
    })
  })

  it('reloads the personal repertoire exactly once after a reset, without navigating (ER6)', async () => {
    useBandContextStore.setState({
      context: { type: 'band', id: 'band-gone', name: 'Disbanded', color: DEFAULT_BAND_COLOR },
    })
    getBandsSpy.mockResolvedValue(BANDS)

    renderShell()

    await waitFor(() => expect(loadSongsSpy).toHaveBeenCalledTimes(1))
    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('refreshes the stored name and colour of a renamed band and keeps it selected (ER4)', async () => {
    useBandContextStore.setState({
      context: { type: 'band', id: 'band-1', name: 'Old Name', color: '#047857' },
    })
    getBandsSpy.mockResolvedValue(BANDS)

    renderShell()

    await waitFor(() => {
      expect(useBandContextStore.getState().context).toEqual({
        type: 'band',
        id: 'band-1',
        name: 'Stone Pilots',
        color: '#1d4ed8',
      })
    })
    expect(loadSongsSpy).not.toHaveBeenCalled()
  })

  it('defaults a null fetched colour to DEFAULT_BAND_COLOR on refresh (ER4)', async () => {
    useBandContextStore.setState({
      context: { type: 'band', id: 'band-2', name: 'Nulls', color: '#047857' },
    })
    getBandsSpy.mockResolvedValue(BANDS)

    renderShell()

    await waitFor(() => {
      expect(useBandContextStore.getState().context).toEqual({
        type: 'band',
        id: 'band-2',
        name: 'The Nulls',
        color: DEFAULT_BAND_COLOR,
      })
    })
  })

  it('writes nothing when the context already matches the fetched row (ER4)', async () => {
    const matching = { type: 'band' as const, id: 'band-1', name: 'Stone Pilots', color: '#1d4ed8' }
    useBandContextStore.setState({ context: matching })
    const setSpy = vi.fn()
    const unsubscribe = useBandContextStore.subscribe(setSpy)
    getBandsSpy.mockResolvedValue(BANDS)

    renderShell()

    await waitFor(() => expect(getBandsSpy).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(setSpy).not.toHaveBeenCalled()
    expect(useBandContextStore.getState().context).toBe(matching)
    expect(loadSongsSpy).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('leaves the persisted context untouched and logs when the fetch rejects (ER5)', async () => {
    const persisted = { type: 'band' as const, id: 'band-gone', name: 'Disbanded', color: '#047857' }
    useBandContextStore.setState({ context: persisted })
    getBandsSpy.mockRejectedValue(new Error('network down'))

    renderShell()

    await waitFor(() => expect(loggerErrorSpy).toHaveBeenCalledTimes(1))
    expect(useBandContextStore.getState().context).toEqual(persisted)
    expect(loadSongsSpy).not.toHaveBeenCalled()
    expect(loggerErrorSpy.mock.calls[0][1]).toBeInstanceOf(Error)
  })
})
