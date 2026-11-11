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

  /** RH-196 — the per-song offline model, in the body copy. */
  it('says the song is not stored on this device and names both ways to store it', () => {
    render(<OfflineUnavailable onBack={vi.fn()} />)

    expect(screen.getByTestId('offline-unavailable').textContent).toContain(
      'It is not stored on this device. While you have a connection, open its playlist and choose Make available offline, or open the song and choose Available offline.',
    )
  })

  it('offers Previous and Next to the nearest available queue songs', () => {
    const prev = { title: 'Índios', onSelect: vi.fn() }
    const next = { title: 'Eduardo e Mônica', onSelect: vi.fn() }
    const onBack = vi.fn()
    render(<OfflineUnavailable onBack={onBack} prev={prev} next={next} />)

    fireEvent.click(screen.getByRole('button', { name: /Previous: Índios/ }))
    expect(prev.onSelect).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /Next: Eduardo e Mônica/ }))
    expect(next.onSelect).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('omits a direction with no available song', () => {
    render(<OfflineUnavailable onBack={vi.fn()} prev={null} next={{ title: 'Tempo Perdido', onSelect: vi.fn() }} />)

    expect(screen.queryByRole('button', { name: /Previous:/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Next: Tempo Perdido/ })).toBeDefined()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })
})
