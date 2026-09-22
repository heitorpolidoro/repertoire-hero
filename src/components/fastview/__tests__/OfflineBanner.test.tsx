// @vitest-environment jsdom
/**
 * RH-80 ER3 / ER5 — the two whole-state offline surfaces of the Fast View.
 *
 * Both are presentational and neither reads `navigator.onLine`: the page makes
 * the single `useOfflineStatus()` call and decides whether to render them
 * (RH-38/RH-52). That is why these tests need no browser signal at all.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { OfflineBanner } from '../OfflineBanner'
import { OfflineUnavailable } from '../OfflineUnavailable'

afterEach(cleanup)

describe('OfflineBanner (RH-80)', () => {
  it('carries the read-only test id and says the session is read-only', () => {
    render(<OfflineBanner />)

    const banner = screen.getByTestId('offline-read-only-banner')
    expect(banner).toBeDefined()
    expect(banner.textContent).toMatch(/read-only/i)
    expect(banner.textContent).toMatch(/offline/i)
  })

  it('is announced to assistive technology as a status', () => {
    render(<OfflineBanner />)

    expect(screen.getByRole('status')).toBeDefined()
  })
})

describe('OfflineUnavailable (RH-80)', () => {
  it('explains that the song was never downloaded', () => {
    render(<OfflineUnavailable onBack={vi.fn()} />)

    const panel = screen.getByTestId('offline-unavailable')
    expect(panel.textContent).toMatch(/not available offline/i)
    expect(screen.queryByText('Song not found')).toBeNull()
  })

  it('reports the back press', () => {
    const onBack = vi.fn()
    render(<OfflineUnavailable onBack={onBack} />)

    fireEvent.click(screen.getByRole('button'))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
