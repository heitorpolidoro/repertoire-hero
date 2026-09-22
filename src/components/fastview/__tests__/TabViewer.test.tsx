// @vitest-environment jsdom
/**
 * RH-80 ER11 — the inline tab card offline.
 *
 * `TabViewer` embeds the PDF in a `docs.google.com/gview` iframe, which cannot
 * load with no network, and it is the *only* `TabViewer` call site's `Stage`
 * trigger. Offline the iframe is therefore replaced by a panel while the header
 * row — `Stage` included — stays exactly where it was: Stage Mode is the one
 * renderer that does work offline, and it is reachable only from this card.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TabViewer } from '../TabViewer'

afterEach(cleanup)

describe('TabViewer (RH-80)', () => {
  it('renders the gview iframe online, as before', () => {
    const { container } = render(
      <TabViewer url="https://blob.example/a.pdf" title="Riff" onOpenStage={vi.fn()} onClose={vi.fn()} />,
    )

    const iframe = container.querySelector('iframe[src*="docs.google.com"]')
    expect(iframe).not.toBeNull()
    expect(container.querySelector('[data-testid="tab-viewer-offline"]')).toBeNull()
  })

  it('replaces the iframe with the offline panel when offline', () => {
    const { container } = render(
      <TabViewer
        url="/__offline-tab/pl-1/tab-1"
        title="Riff"
        onOpenStage={vi.fn()}
        onClose={vi.fn()}
        offline
      />,
    )

    expect(screen.getByTestId('tab-viewer-offline')).toBeDefined()
    expect(container.querySelector('iframe[src*="docs.google.com"]')).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('keeps Stage and Close reachable offline', () => {
    const onOpenStage = vi.fn()
    const onClose = vi.fn()
    render(
      <TabViewer
        url="/__offline-tab/pl-1/tab-1"
        title="Riff"
        onOpenStage={onOpenStage}
        onClose={onClose}
        offline
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Stage/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onOpenStage).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing without an active tab, offline included', () => {
    const { container } = render(
      <TabViewer url={null} title="Riff" onOpenStage={vi.fn()} onClose={vi.fn()} offline />,
    )

    expect(container.firstChild).toBeNull()
  })
})
