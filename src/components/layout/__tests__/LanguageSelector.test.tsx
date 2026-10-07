// @vitest-environment jsdom
/**
 * RH-129 §F — the locale derivation is hydration-safe.
 *
 * `LanguageSelector` read the locale cookie into state from a mount effect (a
 * `react-hooks/set-state-in-effect` error). The remedy derives it during render
 * instead, which is only correct if the derivation stays gated on
 * `useHydrated()`: the server cannot see `document.cookie`, so an ungated read
 * would make the SSR pass and the hydration render disagree — and a hydration
 * mismatch is invisible to an ordinary client-side test.
 *
 * `useHydrated()` is `useSyncExternalStore` with `getServerSnapshot = () =>
 * false`, and `renderToStaticMarkup` takes that path, so the SSR-shaped render
 * below is the server's answer and the `render()` below is the browser's.
 *
 * **What this file asserts is deliberately not what `LandingPage.test.tsx`
 * asserts.** This component's two `<option>` labels are hardcoded and rendered
 * unconditionally, and `common.portuguese` / `common.english` are identical
 * strings in both dictionaries, so its client `en` markup is byte-identical to
 * its client `pt-BR` markup. "Produces the `en` output" would assert nothing
 * here. The locale reaches the DOM only through `<select value={…}>`, which
 * React sets as a DOM **property** on the client and serialises as a
 * `selected` **attribute** on the server — so those are the two things asserted.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { COOKIE_NAME } from '@/lib/i18n'
import { LanguageSelector } from '../LanguageSelector'

afterEach(() => {
  cleanup()
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`
  vi.restoreAllMocks()
})

function setLocaleCookie(locale: string) {
  document.cookie = `${COOKIE_NAME}=${locale}; path=/`
}

function selector(): HTMLSelectElement {
  return screen.getByLabelText('Language selector') as HTMLSelectElement
}

describe('LanguageSelector locale derivation (RH-129)', () => {
  it('reads the cookie on the client render', () => {
    setLocaleCookie('en')

    render(<LanguageSelector />)

    expect(selector().value).toBe('en')
  })

  it('still answers the pt-BR default on the server-shaped render, cookie or no cookie', () => {
    setLocaleCookie('en')

    const markup = renderToStaticMarkup(<LanguageSelector />)

    // This is the only place the SSR locale is visible: a `<select value>`
    // serialises as `selected` on the matching option.
    expect(markup).toContain('<option value="pt-BR" selected="">')
    expect(markup).toContain('<option value="en">')
    expect(markup).not.toContain('<option value="en" selected="">')
  })

  it('falls back to pt-BR on the client when the cookie names an unsupported locale', () => {
    setLocaleCookie('fr')

    render(<LanguageSelector />)

    expect(selector().value).toBe('pt-BR')
  })

  it('writes the cookie and reloads when the user picks a language', () => {
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      reload,
    } as unknown as Location)

    render(<LanguageSelector />)
    fireEvent.change(selector(), { target: { value: 'en' } })

    expect(document.cookie).toContain(`${COOKIE_NAME}=en`)
    expect(reload).toHaveBeenCalled()
  })
})
