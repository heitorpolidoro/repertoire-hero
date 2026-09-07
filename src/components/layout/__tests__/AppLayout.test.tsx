// @vitest-environment jsdom
/**
 * RH-46 — AppLayout (and the ContextSwitcher declared inside it) is a pure
 * presentational component.
 *
 * The band list used to be fetched from inside ContextSwitcher's mount effect.
 * It now arrives as the `bands` prop, so this suite renders the whole app
 * chrome from props alone. Nothing here mocks a data module: the three mocks
 * below stand in for the browser-session client, the Next.js router hooks that
 * need an App Router runtime, and the repertoire store (whose spy also lets the
 * third test prove a context switch reloads the song list).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { BandOption } from '@/types/database'

const { loadSongsSpy, pushSpy, useSessionSpy, signOutSpy } = vi.hoisted(() => ({
  loadSongsSpy: vi.fn(),
  pushSpy: vi.fn(),
  useSessionSpy: vi.fn(),
  signOutSpy: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: useSessionSpy,
    signOut: signOutSpy,
  },
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: pushSpy }),
}))

vi.mock('@/store/repertoireStore', () => ({
  useRepertoireStore: (selector: (state: { loadSongs: () => void }) => unknown) =>
    selector({ loadSongs: loadSongsSpy }),
}))

import AppLayout from '../AppLayout'
import { useBandContextStore } from '@/store/bandContextStore'

afterEach(cleanup)

const BANDS: BandOption[] = [
  { id: 'band-alpha', name: 'Alpha Quartet', color: '#1d4ed8' },
  { id: 'band-beta', name: 'Beta Ensemble', color: null },
]

const SESSION = { data: { user: { id: 'user-1', name: 'Ada', email: 'ada@example.com' } } }

beforeEach(() => {
  vi.clearAllMocks()
  useSessionSpy.mockReturnValue(SESSION)
  useBandContextStore.getState().setUserContext()
})

/** ContextSwitcher is an `ssr: false` dynamic import, so it appears a tick late. */
async function openContextSwitcher() {
  const trigger = await screen.findByRole('button', { name: /Ada/ })
  fireEvent.click(trigger)
}

describe('AppLayout renders from props (RH-46)', () => {
  it('renders its children and both navigation landmarks from props alone', () => {
    render(
      <AppLayout bands={[]}>
        <p>page body</p>
      </AppLayout>,
    )

    expect(screen.getByText('page body')).toBeDefined()
    expect(screen.getAllByRole('navigation')).toHaveLength(2)
  })

  it('lists every band in the bands prop inside the context switcher', async () => {
    render(
      <AppLayout bands={BANDS}>
        <p>page body</p>
      </AppLayout>,
    )

    await openContextSwitcher()

    expect(screen.getByText('Alpha Quartet')).toBeDefined()
    expect(screen.getByText('Beta Ensemble')).toBeDefined()
  })

  it('switches the band context to the band the user picks', async () => {
    render(
      <AppLayout bands={BANDS}>
        <p>page body</p>
      </AppLayout>,
    )

    await openContextSwitcher()
    fireEvent.click(screen.getByText('Beta Ensemble'))

    expect(useBandContextStore.getState().context).toEqual({
      type: 'band',
      id: 'band-beta',
      name: 'Beta Ensemble',
      color: undefined,
    })
    expect(loadSongsSpy).toHaveBeenCalled()
  })

  it('renders only its children once the session resolves to no user', async () => {
    useSessionSpy.mockReturnValue({ data: null })

    render(
      <AppLayout bands={BANDS}>
        <p>page body</p>
      </AppLayout>,
    )

    expect(await screen.findByText('page body')).toBeDefined()
    expect(screen.queryAllByRole('navigation')).toHaveLength(0)
  })
})
