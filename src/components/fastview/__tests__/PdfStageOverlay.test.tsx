// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PdfStageOverlay, type PdfStageOverlayProps } from '../PdfStageOverlay'
import type { Stroke, TabAnnotations } from '@/types/database'

/**
 * The real stage pulls in react-pdf/pdfjs-dist, which touches `DOMMatrix` at
 * module load; it has its own jsdom suite. Here it is a stub that echoes the
 * props the overlay hands it.
 */
vi.mock('@/components/tabs/TabDrawingStage', () => ({
  default: (props: {
    fileUrl: string
    annotations: TabAnnotations | null
    annotationsError: string | null
    onSaveAnnotations: (pageNumber: number, strokes: Stroke[]) => Promise<{ success?: boolean; error?: string }>
  }) => (
    <div
      data-testid="drawing-stage"
      data-file-url={props.fileUrl}
      data-annotations={JSON.stringify(props.annotations)}
      data-annotations-error={props.annotationsError ?? ''}
    >
      <button type="button" onClick={() => void props.onSaveAnnotations(3, [])}>
        save
      </button>
    </div>
  ),
}))

afterEach(cleanup)

const ANNOTATIONS: TabAnnotations = { '1': [] }

function props(overrides: Partial<PdfStageOverlayProps> = {}): PdfStageOverlayProps {
  return {
    open: true,
    overlayRef: { current: null },
    height: null,
    tabId: 't-1',
    fileUrl: 'https://blob.test/t-1.pdf',
    tabTitle: 'Horn section',
    songTitle: 'Sultans of Swing',
    songKey: 'Dm',
    annotations: null,
    annotationsError: null,
    onSaveAnnotations: vi.fn().mockResolvedValue({ success: true }),
    onClose: vi.fn(),
    ...overrides,
  }
}

/** The overlay root, i.e. the element carrying the RH-28 gesture rules. */
function root(container: HTMLElement): HTMLElement {
  return container.firstElementChild as HTMLElement
}

describe('PdfStageOverlay', () => {
  it('PdfStageOverlay renders nothing while the stage is closed', () => {
    const { container } = render(<PdfStageOverlay {...props({ open: false })} />)

    expect(container.innerHTML).toBe('')
  })

  it('PdfStageOverlay renders nothing without an active tab url', () => {
    const noUrl = render(<PdfStageOverlay {...props({ fileUrl: null })} />)
    expect(noUrl.container.innerHTML).toBe('')
    noUrl.unmount()

    const noTab = render(<PdfStageOverlay {...props({ tabId: null })} />)
    expect(noTab.container.innerHTML).toBe('')
  })

  it('PdfStageOverlay shows the tab title, the song title and the key in the header', () => {
    const withKey = render(<PdfStageOverlay {...props()} />)
    expect(screen.getByText('Horn section')).toBeDefined()
    expect(screen.getByText(/Sultans of Swing/).textContent).toContain('• Dm')
    withKey.unmount()

    // No key, and a tab whose title never loaded: the header falls back.
    render(<PdfStageOverlay {...props({ songKey: null, tabTitle: '' })} />)
    expect(screen.getByText('PDF Tab')).toBeDefined()
    expect(screen.getByText(/Sultans of Swing/).textContent).not.toContain('•')
  })

  it('PdfStageOverlay sizes itself to the measured height and falls back to 100dvh', () => {
    const measured = render(<PdfStageOverlay {...props({ height: 640 })} />)
    expect(root(measured.container).style.height).toBe('640px')
    measured.unmount()

    const unmeasured = render(<PdfStageOverlay {...props({ height: null })} />)
    expect(root(unmeasured.container).style.height).toBe('100dvh')
  })

  it('PdfStageOverlay keeps the overlay root touch-action, overflow and overscroll rules', () => {
    const { container } = render(<PdfStageOverlay {...props({ height: 640 })} />)
    const overlay = root(container)

    expect(overlay.style.touchAction).toBe('pan-x pan-y')
    expect(overlay.style.overflow).toBe('hidden')
    expect(overlay.style.overscrollBehavior).toBe('contain')
    expect(overlay.className).toBe('fixed inset-x-0 top-0 z-50 bg-black flex flex-col')
  })

  it('PdfStageOverlay reports the close button press', () => {
    const onClose = vi.fn()
    render(<PdfStageOverlay {...props({ onClose })} />)

    fireEvent.click(screen.getByTitle('Close PDF Stage Mode'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('PdfStageOverlay hands the annotations, the error and the save callback to the drawing stage', async () => {
    const onSaveAnnotations = vi.fn().mockResolvedValue({ success: true })
    render(
      <PdfStageOverlay
        {...props({ annotations: ANNOTATIONS, annotationsError: 'Failed to load', onSaveAnnotations })}
      />,
    )

    const stage = screen.getByTestId('drawing-stage')
    expect(stage.getAttribute('data-file-url')).toBe('https://blob.test/t-1.pdf')
    expect(stage.getAttribute('data-annotations')).toBe(JSON.stringify(ANNOTATIONS))
    expect(stage.getAttribute('data-annotations-error')).toBe('Failed to load')

    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    expect(onSaveAnnotations).toHaveBeenCalledWith(3, [])
  })
})
