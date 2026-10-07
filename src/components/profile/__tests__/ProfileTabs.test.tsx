// @vitest-environment jsdom
/**
 * RH-129 §A1 — the profile tab state, and the one thing the key expression must be.
 *
 * `ProfilePage` used to reset its `activeTab` from a `useEffect` depending on
 * `[context.type]`, which is a `react-hooks/set-state-in-effect` error. The
 * remedy moves the state into this component and resets it with a React key
 * instead of a state write.
 *
 * The key is `context.type`, not `context.id`, and the first test below is why:
 * today's effect depends on `[context.type]`, so switching from one band to
 * another does NOT reset the tab. Keying on `id` would remount the band panel on
 * a band→band switch, discarding whatever it had loaded and flashing a reload —
 * a user-visible regression that no lint rule would catch. That test fails under
 * `key={context.id}` and passes under `key={context.type}`.
 *
 * The panels arrive as `ReactNode` props because `BandProfileView` and
 * `PersonalProfileView` are private to `src/app/profile/page.tsx` and F21
 * forbids importing from `@/app/*`. React elements are lazy, so passing both
 * costs nothing: only the selected one is placed in the tree.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { BandContext } from '@/store/bandContextStore'
import { ProfileTabs } from '../ProfileTabs'

afterEach(cleanup)

const ALPHA: BandContext = { type: 'band', id: 'band-alpha', name: 'Alpha Quartet', color: '#1d4ed8' }
const BETA: BandContext = { type: 'band', id: 'band-beta', name: 'Beta Ensemble' }
const PERSONAL: BandContext = { type: 'user' }

const BAND_PANEL = 'band panel contents'
const PERSONAL_PANEL = 'personal panel contents'

function renderTabs(context: BandContext) {
  return render(
    <ProfileTabs
      context={context}
      bandPanel={<p>{BAND_PANEL}</p>}
      personalPanel={<p>{PERSONAL_PANEL}</p>}
    />
  )
}

function rerenderTabs(rerender: (ui: React.ReactElement) => void, context: BandContext) {
  rerender(
    <ProfileTabs
      context={context}
      bandPanel={<p>{BAND_PANEL}</p>}
      personalPanel={<p>{PERSONAL_PANEL}</p>}
    />
  )
}

describe('ProfileTabs (RH-129 §A1)', () => {
  it('selects the band tab on first render in band context', () => {
    renderTabs(ALPHA)

    expect(screen.getByRole('heading').textContent).toContain('Alpha Quartet')
    expect(screen.getByText(BAND_PANEL)).toBeDefined()
    expect(screen.queryByText(PERSONAL_PANEL)).toBeNull()
  })

  it('keeps the tab the user selected across a band to band switch', () => {
    const { rerender } = renderTabs(ALPHA)

    fireEvent.click(screen.getByRole('button', { name: /Personal/ }))
    expect(screen.getByText(PERSONAL_PANEL)).toBeDefined()
    expect(screen.queryByText(BAND_PANEL)).toBeNull()

    // Same `type`, different `id` and `name`: the switcher relabels, the
    // selection survives. This is the assertion `key={context.id}` fails.
    rerenderTabs(rerender, BETA)

    expect(screen.getByRole('button', { name: /Beta Ensemble/ })).toBeDefined()
    expect(screen.getByText(PERSONAL_PANEL)).toBeDefined()
    expect(screen.queryByText(BAND_PANEL)).toBeNull()
  })

  it('keeps the band tab across a band to band switch too', () => {
    const { rerender } = renderTabs(ALPHA)
    rerenderTabs(rerender, BETA)

    expect(screen.getByText(BAND_PANEL)).toBeDefined()
    expect(screen.queryByText(PERSONAL_PANEL)).toBeNull()
  })

  it('shows the personal panel and no switcher in personal context', () => {
    renderTabs(PERSONAL)

    expect(screen.getByRole('heading').textContent).toContain('Personal Profile')
    expect(screen.getByText(PERSONAL_PANEL)).toBeDefined()
    expect(screen.queryByText(BAND_PANEL)).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('resets the tab when the context type changes, which is what the key is for', () => {
    const { rerender } = renderTabs(PERSONAL)
    expect(screen.getByText(PERSONAL_PANEL)).toBeDefined()

    rerenderTabs(rerender, ALPHA)

    expect(screen.getByText(BAND_PANEL)).toBeDefined()
    expect(screen.queryByText(PERSONAL_PANEL)).toBeNull()
  })
})
