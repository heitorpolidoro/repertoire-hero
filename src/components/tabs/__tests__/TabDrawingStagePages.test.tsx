// @vitest-environment jsdom
/**
 * RH-128 ER4 — the page controls follow the page count, not the file type.
 *
 * The prev/next buttons and the `Page n / m` indicator only make sense for a
 * file that has more than one page, and an image has exactly one. They are
 * therefore gated on the count the page surface reports, which also removes
 * them from a single-page PDF — the honest reading of the rule, not a special
 * case. The save-state indicator lived in that row and must survive its
 * absence: a tab that can be annotated with no visible save state is the one
 * outcome this must not produce.
 *
 * Unlike `TabDrawingStage.test.tsx`, the `ResizeObserver` stub here *fires*, so
 * `renderWidth` is defined and the page surface really mounts. `react-pdf` is
 * mocked (jsdom cannot load `pdfjs-dist`) and reports a seven-page document.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('react-pdf', () => ({
  Document: ({
    onLoadSuccess,
    children,
  }: {
    onLoadSuccess: (d: { numPages: number }) => void
    children: React.ReactNode
  }) => {
    onLoadSuccess({ numPages: 7 })
    return <div data-testid="pdf-document">{children}</div>
  },
  Page: () => <div data-testid="pdf-page" />,
}))

vi.mock('@/lib/pdfWorker', () => ({}))

import TabDrawingStage from '../TabDrawingStage'

/** Reports one width, once, so `renderWidth` is defined and the surface mounts. */
class FiringResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ contentRect: { width: 800 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
    void target
  }
  disconnect() {}
  unobserve() {}
}
vi.stubGlobal('ResizeObserver', FiringResizeObserver)

afterEach(cleanup)

function renderStage(overrides: Partial<React.ComponentProps<typeof TabDrawingStage>> = {}) {
  return render(
    <TabDrawingStage
      fileUrl="https://blob.example/chart.pdf"
      annotations={{}}
      annotationsError={null}
      onSaveAnnotations={vi.fn().mockResolvedValue({ success: true })}
      {...overrides}
    />,
  )
}

describe('TabDrawingStage page controls (RH-128 ER4)', () => {
  it('renders no page controls for an image, and still shows the save state', () => {
    const { container } = renderStage({
      fileUrl: 'https://blob.example/chart.jpg',
      contentType: 'image/jpeg',
    })

    expect(container.querySelector('img')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /Prev/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Next/ })).toBeNull()
    expect(screen.queryByText(/^Page /)).toBeNull()
    expect(screen.getByText(/^(Saved|Saving|Loading|Save failed)/)).toBeDefined()
  })

  it('renders the page controls and the save state for a multi-page PDF', () => {
    renderStage({ contentType: 'application/pdf' })

    expect(screen.getByRole('button', { name: /Prev/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /Next/ })).toBeDefined()
    expect(screen.getByText('Page 1 / 7')).toBeDefined()
    expect(screen.getByText(/^(Saved|Saving|Loading|Save failed)/)).toBeDefined()
  })

  it('renders the PDF surface when the content type is absent', () => {
    const { container } = renderStage()

    expect(screen.getByTestId('pdf-document')).toBeDefined()
    expect(container.querySelector('img')).toBeNull()
  })
})
