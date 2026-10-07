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

  it('shows a loading status over the iframe until it loads', () => {
    const { container } = render(
      <TabViewer url="https://blob.example/a.pdf" title="Riff" onOpenStage={vi.fn()} onClose={vi.fn()} />,
    )

    expect(screen.getByRole('status').textContent).toContain('Loading preview')
    fireEvent.load(container.querySelector('iframe') as HTMLIFrameElement)
    expect(screen.queryByRole('status')).toBeNull()
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
  /**
   * RH-128 ER2/ER3/ER8 — the image branch, and the PDF regressions beside it.
   *
   * The branch is taken *before* the offline one on purpose. `gview` is a
   * cross-origin viewer that cannot load with no network, which is the whole
   * reason for the offline panel; an `<img>` pointed at the same-origin cache
   * key `src/app/sw.ts` answers has no such problem, so painting "Preview
   * needs a connection" over a photograph that renders perfectly well would be
   * a lie the user pays for.
   */
  describe('an image tab (RH-128)', () => {
    it('renders the file itself and mounts no gview iframe', () => {
      const { container } = render(
        <TabViewer
          url="https://blob.example/chart.jpg"
          title="Chart photo"
          contentType="image/jpeg"
          onOpenStage={vi.fn()}
          onClose={vi.fn()}
        />,
      )

      const img = container.querySelector('img') as HTMLImageElement
      expect(img).not.toBeNull()
      expect(img.getAttribute('src')).toBe('https://blob.example/chart.jpg')
      expect(container.querySelector('iframe[src*="docs.google.com/gview"]')).toBeNull()
      expect(container.querySelector('iframe')).toBeNull()
    })

    it('shows a loading status over the image until it loads', () => {
      const { container } = render(
        <TabViewer
          url="https://blob.example/chart.png"
          title="Chart photo"
          contentType="image/png"
          onOpenStage={vi.fn()}
          onClose={vi.fn()}
        />,
      )

      expect(screen.getByRole('status').textContent).toContain('Loading preview')
      fireEvent.load(container.querySelector('img') as HTMLImageElement)
      expect(screen.queryByRole('status')).toBeNull()
    })

    it('renders from the offline cache key offline, with no offline panel (ER8)', () => {
      const { container } = render(
        <TabViewer
          url="/__offline-tab/pl-1/tab-1"
          title="Chart photo"
          contentType="image/webp"
          onOpenStage={vi.fn()}
          onClose={vi.fn()}
          offline
        />,
      )

      const img = container.querySelector('img') as HTMLImageElement
      expect(img).not.toBeNull()
      expect(img.getAttribute('src')).toBe('/__offline-tab/pl-1/tab-1')
      expect(container.querySelector('[data-testid="tab-viewer-offline"]')).toBeNull()
      expect(container.querySelector('iframe')).toBeNull()
    })
  })

  describe('a PDF tab is untouched (RH-128 ER3/ER8)', () => {
    it('still builds the same gview src for an explicit application/pdf', () => {
      const { container } = render(
        <TabViewer
          url="https://blob.example/a.pdf"
          title="Riff"
          contentType="application/pdf"
          onOpenStage={vi.fn()}
          onClose={vi.fn()}
        />,
      )

      const iframe = container.querySelector('iframe') as HTMLIFrameElement
      expect(iframe.getAttribute('src')).toBe(
        'https://docs.google.com/gview?url=https%3A%2F%2Fblob.example%2Fa.pdf&embedded=true',
      )
      expect(container.querySelector('img')).toBeNull()
    })

    it('still shows the offline panel offline', () => {
      const { container } = render(
        <TabViewer
          url="/__offline-tab/pl-1/tab-1"
          title="Riff"
          contentType="application/pdf"
          onOpenStage={vi.fn()}
          onClose={vi.fn()}
          offline
        />,
      )

      expect(screen.getByTestId('tab-viewer-offline')).toBeDefined()
      expect(container.querySelector('img')).toBeNull()
      expect(container.querySelector('iframe')).toBeNull()
    })

    it('reads an absent content type as a PDF, as every pre-RH-127 row is', () => {
      const { container } = render(
        <TabViewer url="https://blob.example/a.pdf" title="Riff" onOpenStage={vi.fn()} onClose={vi.fn()} />,
      )

      expect(container.querySelector('iframe[src*="docs.google.com"]')).not.toBeNull()
      expect(container.querySelector('img')).toBeNull()
    })
  })
})
