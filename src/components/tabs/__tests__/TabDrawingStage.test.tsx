// @vitest-environment jsdom
/**
 * RH-46 — TabDrawingStage is a pure presentational component.
 *
 * It used to reach up into the App Router tree for its own data. It now takes
 * `annotations`, `annotationsError` and `onSaveAnnotations` as props, so this
 * suite renders it from props alone: nothing here mocks a data module, and the
 * only mocks below are for two things jsdom genuinely cannot run —
 * `react-pdf` (its `pdfjs-dist` dependency touches `DOMMatrix` at module load)
 * and the worker-asset shim it pulls in.
 *
 * `ResizeObserver` is stubbed with a class that never fires, so `baseFitWidth`
 * stays 0, `renderWidth` stays undefined and the <Document> subtree is never
 * mounted. The toolbar — the part this suite asserts on — renders regardless.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { Stroke } from '@/types/database'

vi.mock('react-pdf', () => ({
  Document: () => null,
  Page: () => null,
}))

vi.mock('@/lib/pdfWorker', () => ({}))

import TabDrawingStage from '../TabDrawingStage'

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

afterEach(cleanup)

const STROKE_A: Stroke = {
  id: 'stroke-a',
  color: '#000000',
  width: 0.01,
  points: [
    [0.1, 0.1],
    [0.2, 0.2],
  ],
}

const STROKE_B: Stroke = {
  id: 'stroke-b',
  color: '#ef4444',
  width: 0.01,
  points: [
    [0.5, 0.5],
    [0.6, 0.6],
  ],
}

let onSaveAnnotations: ReturnType<typeof vi.fn>

beforeEach(() => {
  onSaveAnnotations = vi.fn().mockResolvedValue({ success: true })
})

function renderStage(
  overrides: Partial<React.ComponentProps<typeof TabDrawingStage>> = {},
) {
  return render(
    <TabDrawingStage
      fileUrl="https://blob.example/tab.pdf"
      annotations={{}}
      annotationsError={null}
      onSaveAnnotations={onSaveAnnotations}
      {...overrides}
    />,
  )
}

/** The save-state badge is the only element whose text is one of these words. */
function saveBadgeText() {
  return screen.getByText(/^(Saved|Saving|Loading|Save failed)/).textContent
}

describe('TabDrawingStage renders from props (RH-46)', () => {
  it('renders the page toolbar from props alone, with no annotation fetch', () => {
    renderStage()

    expect(screen.getByText(/^Page 1 /)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Toggle drawing' })).toBeDefined()
    expect(saveBadgeText()).toMatch(/^Saved$/)
  })

  it('shows the loading badge while the annotations prop is null', () => {
    renderStage({ annotations: null })

    expect(saveBadgeText()).toMatch(/^Loading/)
  })

  it('calls onSaveAnnotations with the remaining strokes when Undo is pressed', async () => {
    renderStage({ annotations: { '1': [STROKE_A, STROKE_B] } })

    fireEvent.click(screen.getByRole('button', { name: 'Toggle drawing' }))
    fireEvent.click(screen.getByRole('button', { name: /Undo$/ }))

    await waitFor(
      () => {
        expect(onSaveAnnotations).toHaveBeenCalledTimes(1)
      },
      { timeout: 3000 },
    )
    expect(onSaveAnnotations).toHaveBeenCalledWith(1, [STROKE_A])
  })

  it('calls onSaveAnnotations with an empty page when Clear page is confirmed', async () => {
    renderStage({ annotations: { '1': [STROKE_A, STROKE_B] } })

    fireEvent.click(screen.getByRole('button', { name: 'Toggle drawing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear page' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    await waitFor(
      () => {
        expect(onSaveAnnotations).toHaveBeenCalledTimes(1)
      },
      { timeout: 3000 },
    )
    expect(onSaveAnnotations).toHaveBeenCalledWith(1, [])
  })

  it('renders the annotationsError prop inside the stage', () => {
    renderStage({ annotations: {}, annotationsError: 'Tab not found' })

    expect(screen.getByText('Tab not found')).toBeDefined()
  })

  it('flushes a pending save through onSaveAnnotations when it unmounts', () => {
    const { unmount } = renderStage({ annotations: { '1': [STROKE_A, STROKE_B] } })

    fireEvent.click(screen.getByRole('button', { name: 'Toggle drawing' }))
    fireEvent.click(screen.getByRole('button', { name: /Undo$/ }))
    // Unmounting well inside the 800 ms debounce window: the flush, not the
    // timer, is what must produce the save.
    expect(onSaveAnnotations).not.toHaveBeenCalled()

    unmount()

    expect(onSaveAnnotations).toHaveBeenCalledWith(1, [STROKE_A])
  })
})
