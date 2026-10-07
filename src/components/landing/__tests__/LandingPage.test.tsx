// @vitest-environment jsdom
/**
 * RH-129 §F — the landing page's locale derivation is hydration-safe.
 *
 * `LandingPage` read the locale cookie into state from a mount effect (a
 * `react-hooks/set-state-in-effect` error). The remedy derives it during render,
 * gated on `useHydrated()` so the SSR pass and the hydration render still agree
 * on the `pt-BR` default; the dev-profile `fetch` in the same effect stays,
 * because its `setDevProfiles` lives in a `.then` callback and the rule does not
 * flag it.
 *
 * Unlike `LanguageSelector`, this component's locale is plainly visible in its
 * text: all 26 `landing.*` keys differ between `pt-BR.json` and `en.json`, so
 * the server-shaped render and the client render are textually distinct and can
 * be compared by copy. `useHydrated()` is `useSyncExternalStore` with
 * `getServerSnapshot = () => false`, and `renderToStaticMarkup` takes that path.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { COOKIE_NAME, getDictionary } from '@/lib/i18n'
import LandingPage from '../LandingPage'

const PT = getDictionary('pt-BR')
const EN = getDictionary('en')

/**
 * `renderToStaticMarkup` escapes text content, and `landing.badge` carries an
 * `&` in both dictionaries. Escaping the expected string is more honest than
 * picking whichever key happens to have no special character in it today.
 */
function asMarkupText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

afterEach(() => {
  cleanup()
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`
})

describe('LandingPage locale derivation (RH-129)', () => {
  it('renders the en copy on the client when the cookie says en', () => {
    document.cookie = `${COOKIE_NAME}=en; path=/`

    render(<LandingPage />)

    expect(screen.getByText(EN.landing.badge)).toBeDefined()
    expect(screen.queryByText(PT.landing.badge)).toBeNull()
  })

  it('still renders the pt-BR copy on the server-shaped render, cookie or no cookie', () => {
    document.cookie = `${COOKIE_NAME}=en; path=/`

    const markup = renderToStaticMarkup(<LandingPage />)

    expect(markup).toContain(asMarkupText(PT.landing.badge))
    expect(markup).not.toContain(asMarkupText(EN.landing.badge))
  })

  it('renders the pt-BR copy on the client when no cookie is set', () => {
    render(<LandingPage />)

    expect(screen.getByText(PT.landing.badge)).toBeDefined()
    expect(screen.queryByText(EN.landing.badge)).toBeNull()
  })
})
