// @vitest-environment jsdom
/**
 * RH-129 §F — `/reset-password` still resets a password, and no longer flashes
 * the wrong panel on the way there.
 *
 * The page read `searchParams.get('token')` into state from an effect (a
 * `react-hooks/set-state-in-effect` error); the remedy reads it during render.
 * The observable difference is an improvement: `token` was `null` on the first
 * render, so `isTokenMissing` was briefly true and the **missing-token** panel
 * painted before the effect flipped it.
 *
 * That panel is the one headed **"Invalid Link"**
 * (`src/app/reset-password/page.tsx:85`) with the body *"The password reset
 * token is missing from the URL…"* (`:86`). It is NOT the string "Invalid or
 * expired reset token", which `setError` writes inside `handleSubmit` only
 * (`:30`) and which never appears on a first paint before or after this change —
 * asserting on that one would pass identically either way and verify nothing.
 *
 * "On the first render" is asserted through `renderToStaticMarkup`, which is the
 * render before any effect runs. A client `render()` flushes effects inside
 * `act`, so it cannot see the flash at all; that is the whole reason the bug was
 * invisible.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'

const { resetPasswordSpy, pushSpy, searchParamsSpy } = vi.hoisted(() => ({
  resetPasswordSpy: vi.fn(),
  pushSpy: vi.fn(),
  searchParamsSpy: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushSpy }),
  useSearchParams: () => searchParamsSpy(),
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: { resetPassword: resetPasswordSpy },
}))

import ResetPasswordPage from '../page'

const INVALID_LINK_HEADING = 'Invalid Link'
const INVALID_LINK_BODY = 'The password reset token is missing from the URL'

function withToken(token: string | null) {
  searchParamsSpy.mockReturnValue(new URLSearchParams(token === null ? '' : `token=${token}`))
}

beforeEach(() => {
  vi.clearAllMocks()
  resetPasswordSpy.mockResolvedValue({ error: null })
})

afterEach(cleanup)

describe('ResetPasswordPage (RH-129)', () => {
  it('never paints the missing-token panel on the first render when the URL carries a token', () => {
    withToken('abc')

    const markup = renderToStaticMarkup(<ResetPasswordPage />)

    expect(markup).not.toContain(INVALID_LINK_HEADING)
    expect(markup).not.toContain(INVALID_LINK_BODY)
    expect(markup).toContain('Update password')
  })

  it('shows the password form, and not the missing-token panel, when the URL carries a token', () => {
    withToken('abc')

    render(<ResetPasswordPage />)

    expect(screen.queryByText(INVALID_LINK_HEADING)).toBeNull()
    expect(screen.queryByText(new RegExp(INVALID_LINK_BODY))).toBeNull()
    expect(screen.getByLabelText('New Password')).toBeDefined()
    expect(screen.getByLabelText('Confirm Password')).toBeDefined()
  })

  it('submits the token from the URL to authClient.resetPassword', async () => {
    withToken('abc')

    render(<ResetPasswordPage />)

    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'hunter2hunter2' } })
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'hunter2hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))

    await waitFor(() => {
      expect(resetPasswordSpy).toHaveBeenCalledWith({
        newPassword: 'hunter2hunter2',
        token: 'abc',
      })
    })
  })

  it('shows the missing-token panel, and no password form, when the URL carries no token', () => {
    withToken(null)

    render(<ResetPasswordPage />)

    expect(screen.getByText(INVALID_LINK_HEADING)).toBeDefined()
    expect(screen.getByText(new RegExp(INVALID_LINK_BODY))).toBeDefined()
    expect(screen.queryByLabelText('New Password')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Update password' })).toBeNull()
  })
})
