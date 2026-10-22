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
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import type { BandOption } from '@/types/database'
import { getBandIndicatorCopies } from '@/lib/i18n'

const { loadSongsSpy, pushSpy, useSessionSpy, signOutSpy, signOutSteps } = vi.hoisted(() => {
  const signOutSteps: string[] = []
  return {
    loadSongsSpy: vi.fn(),
    pushSpy: vi.fn(),
    useSessionSpy: vi.fn(),
    signOutSpy: vi.fn(() => {
      signOutSteps.push('signOut')
    }),
    signOutSteps,
  }
})

/**
 * RH-79: the sign-out path purges the offline cache. The store is mocked here
 * only to record *when* the purge happens relative to the sign-out — the store
 * itself is exercised for real in `src/lib/__tests__/offlineStore.test.ts`.
 */
vi.mock('@/lib/offlineStore', () => ({
  OFFLINE_STORE: {
    clearAllOfflineData: vi.fn(async () => {
      await Promise.resolve()
      signOutSteps.push('clearAllOfflineData')
    }),
  },
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

const COPIES = getBandIndicatorCopies()

const SESSION = {
  data: { user: { id: 'user-1', name: 'Ada', email: 'ada@example.com' } },
  isPending: false,
}
/** What `authClient.useSession()` answers before the session request settles. */
const PENDING = { data: undefined, isPending: true }
const SIGNED_OUT = { data: null, isPending: false }

beforeEach(() => {
  vi.clearAllMocks()
  signOutSteps.length = 0
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
      <AppLayout bandIndicatorCopies={COPIES} bands={[]}>
        <p>page body</p>
      </AppLayout>,
    )

    expect(screen.getByText('page body')).toBeDefined()
    expect(screen.getAllByRole('navigation')).toHaveLength(2)
  })

  it('lists every band in the bands prop inside the context switcher', async () => {
    render(
      <AppLayout bandIndicatorCopies={COPIES} bands={BANDS}>
        <p>page body</p>
      </AppLayout>,
    )

    await openContextSwitcher()

    expect(screen.getByText('Alpha Quartet')).toBeDefined()
    expect(screen.getByText('Beta Ensemble')).toBeDefined()
  })

  it('switches the band context to the band the user picks', async () => {
    render(
      <AppLayout bandIndicatorCopies={COPIES} bands={BANDS}>
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
    useSessionSpy.mockReturnValue(SIGNED_OUT)

    render(
      <AppLayout bandIndicatorCopies={COPIES} bands={BANDS}>
        <p>page body</p>
      </AppLayout>,
    )

    expect(await screen.findByText('page body')).toBeDefined()
    expect(screen.queryAllByRole('navigation')).toHaveLength(0)
  })
})

describe('AppLayout keeps one stable tree across session resolution (RH-73)', () => {
  /**
   * The bug this pins: AppLayout used to `return <>{children}</>` for the
   * render between its mount effect and `useSession()` answering. `children`
   * changed parent element and tree position, so React unmounted the route
   * subtree and mounted a fresh copy — twice per load — and for a few frames
   * the document carried two copies of every route control.
   */
  const routeControl = <button type="button">Route control</button>

  it('keeps the very same child DOM node when the session resolves to a user', () => {
    useSessionSpy.mockReturnValue(PENDING)
    const { rerender } = render(<AppLayout bandIndicatorCopies={COPIES} bands={BANDS}>{routeControl}</AppLayout>)

    const pendingNode = screen.getByRole('button', { name: 'Route control' })

    useSessionSpy.mockReturnValue(SESSION)
    rerender(<AppLayout bandIndicatorCopies={COPIES} bands={BANDS}>{routeControl}</AppLayout>)

    const resolvedNode = screen.getByRole('button', { name: 'Route control' })
    expect(resolvedNode).toBe(pendingNode)
    expect(pendingNode.parentElement).not.toBeNull()
    expect(pendingNode.isConnected).toBe(true)
  })

  it('never renders two copies of a route control in any session phase', () => {
    useSessionSpy.mockReturnValue(PENDING)
    const { rerender } = render(<AppLayout bandIndicatorCopies={COPIES} bands={BANDS}>{routeControl}</AppLayout>)
    expect(screen.getAllByText('Route control')).toHaveLength(1)

    useSessionSpy.mockReturnValue(SESSION)
    rerender(<AppLayout bandIndicatorCopies={COPIES} bands={BANDS}>{routeControl}</AppLayout>)
    expect(screen.getAllByText('Route control')).toHaveLength(1)

    useSessionSpy.mockReturnValue(SIGNED_OUT)
    rerender(<AppLayout bandIndicatorCopies={COPIES} bands={BANDS}>{routeControl}</AppLayout>)
    expect(screen.getAllByText('Route control')).toHaveLength(1)
  })

  it('renders the chrome, including the main landmark, while the session is still pending', () => {
    useSessionSpy.mockReturnValue(PENDING)
    render(<AppLayout bandIndicatorCopies={COPIES} bands={BANDS}>{routeControl}</AppLayout>)

    expect(screen.getAllByRole('navigation')).toHaveLength(2)
    expect(screen.queryByRole('main')).not.toBeNull()
  })

  it('drops every chrome landmark and layout class once the session resolves to no user', () => {
    useSessionSpy.mockReturnValue(SIGNED_OUT)
    const { container } = render(<AppLayout bandIndicatorCopies={COPIES} bands={BANDS}>{routeControl}</AppLayout>)

    expect(screen.getByText('Route control')).toBeDefined()
    expect(screen.queryAllByRole('navigation')).toHaveLength(0)
    expect(screen.queryByRole('main')).toBeNull()

    // The wrappers survive (that is the point — the children never move), but
    // they must be layout-neutral so a chrome-less page lays itself out.
    const child = screen.getByText('Route control')
    const contentWrapper = child.parentElement
    const outerWrapper = contentWrapper?.parentElement
    expect(contentWrapper?.className).toBe('contents')
    expect(outerWrapper?.className).toBe('contents')
    expect(container.querySelector('.h-screen')).toBeNull()
    expect(container.querySelector('.bg-gray-50')).toBeNull()
  })
})

describe('AppLayout signs the device out as well as the session (RH-79)', () => {
  it('awaits the offline purge before signing out, because the cache bypasses the proxy', async () => {
    render(
      <AppLayout bandIndicatorCopies={COPIES} bands={BANDS}>
        <p>page body</p>
      </AppLayout>,
    )

    fireEvent.click(screen.getAllByRole('button', { name: /sign out/i })[0])

    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('/login'))
    expect(signOutSteps).toEqual(['clearAllOfflineData', 'signOut'])
    expect(useBandContextStore.getState().context).toEqual({ type: 'user' })
  })
})

describe('AppLayout band-mode indicator (RH-180)', () => {
  const ALPHA = BANDS[0]

  function enterBand() {
    act(() => {
      useBandContextStore.getState().setBandContext(ALPHA.id, ALPHA.name, ALPHA.color ?? undefined)
    })
  }

  function renderLayout() {
    return render(
      <AppLayout bandIndicatorCopies={COPIES} bands={BANDS}>
        <p>page body</p>
      </AppLayout>,
    )
  }

  afterEach(() => {
    document.cookie = 'NEXT_LOCALE=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  })

  it('shows the band name and the localized label in band context', () => {
    document.cookie = 'NEXT_LOCALE=en'
    enterBand()
    renderLayout()

    const indicator = screen.getByTestId('band-indicator')
    expect(indicator.textContent).toContain('Alpha Quartet')
    expect(indicator.textContent).toContain('Band mode')
    expect(indicator.textContent).toContain('Exit')
  })

  it('shows the Portuguese label when the locale cookie is pt-BR', () => {
    document.cookie = 'NEXT_LOCALE=pt-BR'
    enterBand()
    renderLayout()

    const indicator = screen.getByTestId('band-indicator')
    expect(indicator.textContent).toContain('Modo banda')
    expect(indicator.textContent).toContain('Sair')
  })

  it('carries a band icon and the band colour as its background', () => {
    enterBand()
    renderLayout()

    const indicator = screen.getByTestId('band-indicator')
    expect(indicator.querySelector('[data-testid="band-indicator-icon"]')?.textContent).toBe('🎸')
    expect(indicator.style.backgroundColor).toBe('rgb(29, 78, 216)')
  })

  it('renders nothing in personal context', () => {
    renderLayout()

    expect(screen.queryByTestId('band-indicator')).toBeNull()
  })

  it('is removed and restored in place by setUserContext then setBandContext', () => {
    enterBand()
    renderLayout()
    const body = screen.getByText('page body')
    expect(screen.getByTestId('band-indicator')).toBeDefined()

    act(() => {
      useBandContextStore.getState().setUserContext()
    })
    expect(screen.queryByTestId('band-indicator')).toBeNull()

    enterBand()
    expect(screen.getByTestId('band-indicator').textContent).toContain('Alpha Quartet')
    expect(screen.getByText('page body')).toBe(body)
  })

  it('keeps the bottom navigation free of any band strip', () => {
    enterBand()
    renderLayout()

    const [, bottomNav] = screen.getAllByRole('navigation')
    expect(bottomNav.textContent).not.toContain('Alpha Quartet')
    expect(bottomNav.textContent).not.toContain('Exit')
    expect(screen.getAllByTestId('band-indicator')).toHaveLength(1)
  })

  it('exits band mode from the indicator', () => {
    enterBand()
    renderLayout()

    fireEvent.click(screen.getByRole('button', { name: /Exit|Sair/ }))

    expect(useBandContextStore.getState().context).toEqual({ type: 'user' })
    expect(loadSongsSpy).toHaveBeenCalled()
    expect(pushSpy).toHaveBeenCalledWith('/')
    expect(screen.queryByTestId('band-indicator')).toBeNull()
  })
})

describe('AppLayout Catalog nav entry (RH-156)', () => {
  function catalogLinks() {
    return screen.queryAllByRole('link').filter((a) => a.getAttribute('href') === '/admin/catalog')
  }

  it('renders a Catalog link in both navs for a system admin', () => {
    render(
      <AppLayout bandIndicatorCopies={COPIES} bands={[]} isSystemAdmin>
        <p>page body</p>
      </AppLayout>,
    )

    expect(catalogLinks()).toHaveLength(2)
    for (const nav of screen.getAllByRole('navigation')) {
      expect(nav.querySelector('a[href="/admin/catalog"]')?.textContent).toContain('Catalog')
    }
  })

  it('renders no Catalog link when the flag is false or omitted', () => {
    const { rerender } = render(
      <AppLayout bandIndicatorCopies={COPIES} bands={[]} isSystemAdmin={false}>
        <p>page body</p>
      </AppLayout>,
    )
    expect(catalogLinks()).toHaveLength(0)

    rerender(
      <AppLayout bandIndicatorCopies={COPIES} bands={[]}>
        <p>page body</p>
      </AppLayout>,
    )
    expect(catalogLinks()).toHaveLength(0)
  })
})
