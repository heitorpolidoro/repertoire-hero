// @vitest-environment jsdom
/**
 * RH-128 ER5/ER6 — the stage's page surface.
 *
 * `TabDrawingStage` no longer knows how a page is produced: it hands a file
 * url, a page number and a render width to `StagePageSurface` and gets back a
 * page count and a `PageGeometry`. There are two implementations behind that
 * seam, and this suite is what says they agree on the contract.
 *
 * `react-pdf` is mocked for the same reason the stage suite mocks it: its
 * `pdfjs-dist` dependency touches `DOMMatrix` at module load, which jsdom has
 * not got. The mock is as thin as the contract — it reports a page count and a
 * geometry through the two callbacks and renders nothing.
 *
 * ER6 is here rather than in `annotationMath`'s own suite on purpose: the claim
 * the task rests on is about the geometry *an `<img>` actually produces*, so
 * the numbers fed to `normalizePoint` are read off a real mounted surface.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { normalizePoint, denormalizePoint, type PageGeometry } from '@/lib/annotationMath'

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
  Page: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid="pdf-page" data-page-number={pageNumber} />
  ),
}))

vi.mock('@/lib/pdfWorker', () => ({}))

import { StagePageSurface } from '../StagePageSurface'

afterEach(cleanup)

const IMAGE_URL = 'https://blob.example/chart.jpg'
const NATURAL_WIDTH = 1600
const NATURAL_HEIGHT = 1200

function renderSurface(
  overrides: Partial<React.ComponentProps<typeof StagePageSurface>> = {},
) {
  const onPageCount = vi.fn()
  const onGeometry = vi.fn()
  const view = render(
    <StagePageSurface
      fileUrl={IMAGE_URL}
      contentType="image/jpeg"
      pageNumber={1}
      renderWidth={800}
      onPageCount={onPageCount}
      onGeometry={onGeometry}
      {...overrides}
    />,
  )
  return { ...view, onPageCount, onGeometry }
}

/**
 * Mounts the image surface and fires a load with known natural dimensions.
 *
 * `complete` is stubbed alongside them because jsdom loads no image data: a
 * real decoded image is `complete` with non-zero naturals, and the surface
 * reads all three (a still-decoding image must report nothing).
 */
function loadImageAt(renderWidth: number): PageGeometry {
  const { onGeometry, container } = renderSurface({ renderWidth })
  const img = container.querySelector('img') as HTMLImageElement
  Object.defineProperty(img, 'naturalWidth', { value: NATURAL_WIDTH, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: NATURAL_HEIGHT, configurable: true })
  Object.defineProperty(img, 'complete', { value: true, configurable: true })
  fireEvent.load(img)
  return onGeometry.mock.calls.at(-1)?.[0] as PageGeometry
}

describe('StagePageSurface (RH-128)', () => {
  it('renders the image itself for an image tab, and no react-pdf document', () => {
    const { container } = renderSurface()

    const img = container.querySelector('img') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.getAttribute('src')).toBe(IMAGE_URL)
    expect(screen.queryByTestId('pdf-document')).toBeNull()
  })

  it('reports exactly one page for an image tab', () => {
    const { onPageCount } = renderSurface()

    expect(onPageCount).toHaveBeenCalledWith(1)
  })

  it('reports the rendered box and the native dimensions when the image loads', () => {
    const geometry = loadImageAt(800)

    expect(geometry).toEqual({
      width: 800,
      height: 600,
      originalWidth: NATURAL_WIDTH,
      originalHeight: NATURAL_HEIGHT,
    })
  })

  it('reports no geometry while the natural dimensions are still unknown', () => {
    const { onGeometry, container } = renderSurface()

    // A still-decoding image: jsdom leaves both naturals at 0, and a
    // zero-width geometry would send every later normalization to Infinity.
    fireEvent.load(container.querySelector('img') as HTMLImageElement)

    expect(onGeometry).not.toHaveBeenCalled()
  })

  it('renders the react-pdf pair for a PDF tab, and no image', () => {
    const { container, onPageCount } = renderSurface({
      contentType: 'application/pdf',
      fileUrl: 'https://blob.example/chart.pdf',
      pageNumber: 3,
    })

    expect(screen.getByTestId('pdf-document')).toBeDefined()
    expect(screen.getByTestId('pdf-page').getAttribute('data-page-number')).toBe('3')
    expect(container.querySelector('img')).toBeNull()
    expect(onPageCount).toHaveBeenCalledWith(7)
  })

  it('renders the react-pdf pair when the content type is absent, as a pre-RH-127 row is', () => {
    const { container } = renderSurface({ contentType: undefined })

    expect(screen.getByTestId('pdf-document')).toBeDefined()
    expect(container.querySelector('img')).toBeNull()
  })

  it('round-trips a stroke point through the geometry an image surface produces (ER6)', () => {
    const geometry = loadImageAt(800)

    const [normX, normY] = normalizePoint(240, 90, geometry)
    const [pixelX, pixelY] = denormalizePoint(normX, normY, geometry)

    expect(pixelX).toBeCloseTo(240, 6)
    expect(pixelY).toBeCloseTo(90, 6)
  })

  it('normalizes the same point identically at two render widths (ER6)', () => {
    const narrow = loadImageAt(800)
    cleanup()
    const wide = loadImageAt(1200)

    // The same physical spot on the chart, in each box's own pixel space.
    const atNarrow = normalizePoint(240, 90, narrow)
    const atWide = normalizePoint(360, 135, wide)

    expect(atNarrow[0]).toBeCloseTo(atWide[0], 10)
    expect(atNarrow[1]).toBeCloseTo(atWide[1], 10)
    expect(atNarrow[0]).toBeCloseTo(0.3, 10)
  })
})

/**
 * Makes every `<img>` in the test behave like one the browser has already
 * decoded: non-zero naturals and `complete === true` from the first frame.
 *
 * jsdom loads no image data, so without this an `<img>` is permanently 0×0 and
 * never `complete` — which is the *broken* image, not the cached one. Stubbing
 * the prototype is what lets a surface be mounted over an image that will
 * never fire `load`, i.e. the second open of a chart the browser has cached.
 */
function stubDecodedImages(width: number, height: number, complete = true) {
  const proto = HTMLImageElement.prototype
  const saved = new Map<string, PropertyDescriptor | undefined>()
  const values: Record<string, unknown> = {
    naturalWidth: width,
    naturalHeight: height,
    complete,
  }
  for (const [key, value] of Object.entries(values)) {
    saved.set(key, Object.getOwnPropertyDescriptor(proto, key))
    Object.defineProperty(proto, key, { configurable: true, get: () => value })
  }
  return () => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(proto, key, descriptor)
      else Reflect.deleteProperty(proto, key)
    }
  }
}

/**
 * RH-128 code review — the geometry must follow the *current* render width,
 * and it must be readable from an image that never fires `load`.
 *
 * Both are the same root cause: reporting only from the `load` handler. Zoom
 * (`TabDrawingStage`'s +/- buttons and the pinch gesture) and a device
 * rotation both change `renderWidth` on a *mounted* surface, and an `<img>`
 * repainted at a new width fires no second `load`. The stage sizes the
 * annotation canvas from the reported geometry alone, so a stale geometry
 * leaves the canvas at the old box over a larger image: the uncovered part
 * cannot be drawn on at all, and every stroke that *is* drawn is normalized
 * against the wrong box and reopens somewhere else. That is persisted
 * corruption, and it is image-only — `react-pdf` re-fires `onRenderSuccess`.
 *
 * The suite above remounts between widths, which hides all of it, so these
 * rerender the same mounted surface.
 */
describe('ImagePageSurface geometry tracks the live render width (RH-128 review)', () => {
  let restoreImages: (() => void) | undefined

  afterEach(() => {
    restoreImages?.()
    restoreImages = undefined
  })

  function mountImage(renderWidth: number) {
    const onGeometry = vi.fn()
    const onPageCount = vi.fn()
    const view = render(
      <StagePageSurface
        fileUrl={IMAGE_URL}
        contentType="image/jpeg"
        pageNumber={1}
        renderWidth={renderWidth}
        onPageCount={onPageCount}
        onGeometry={onGeometry}
      />,
    )
    const rerenderAt = (width: number) =>
      view.rerender(
        <StagePageSurface
          fileUrl={IMAGE_URL}
          contentType="image/jpeg"
          pageNumber={1}
          renderWidth={width}
          onPageCount={onPageCount}
          onGeometry={onGeometry}
        />,
      )
    return { ...view, onGeometry, onPageCount, rerenderAt }
  }

  function lastGeometry(onGeometry: ReturnType<typeof vi.fn>): PageGeometry {
    return onGeometry.mock.calls.at(-1)?.[0] as PageGeometry
  }

  it('re-reports the geometry when the render width changes on a mounted surface', () => {
    restoreImages = stubDecodedImages(NATURAL_WIDTH, NATURAL_HEIGHT)
    const { onGeometry, rerenderAt } = mountImage(800)

    expect(lastGeometry(onGeometry)).toEqual({
      width: 800,
      height: 600,
      originalWidth: NATURAL_WIDTH,
      originalHeight: NATURAL_HEIGHT,
    })

    // Zoom 2.0, or a rotation: the same mounted <img> is simply repainted, so
    // no second `load` event is ever fired.
    rerenderAt(1600)

    expect(lastGeometry(onGeometry)).toEqual({
      width: 1600,
      height: 1200,
      originalWidth: NATURAL_WIDTH,
      originalHeight: NATURAL_HEIGHT,
    })
  })

  it('reports the geometry of an already-complete image with no load event', () => {
    restoreImages = stubDecodedImages(NATURAL_WIDTH, NATURAL_HEIGHT)
    const { onGeometry, container } = mountImage(800)

    // The second open of a chart the browser has cached: `complete` is true
    // from the first frame and `load` never fires again.
    expect(container.querySelector('img')).not.toBeNull()
    expect(onGeometry).toHaveBeenCalledTimes(1)
    expect(lastGeometry(onGeometry).originalWidth).toBe(NATURAL_WIDTH)
  })

  it('reports no geometry for an image that failed to decode', () => {
    // A broken image settles `complete` true with both naturals still 0. A
    // zero-width geometry would send every later `normalizePoint` to Infinity.
    restoreImages = stubDecodedImages(0, 0)
    const { onGeometry, container } = mountImage(800)

    fireEvent.error(container.querySelector('img') as HTMLImageElement)

    expect(onGeometry).not.toHaveBeenCalled()
  })

  it('round-trips a stroke across a live width change, which is the corruption this prevents', () => {
    restoreImages = stubDecodedImages(NATURAL_WIDTH, NATURAL_HEIGHT)
    const { onGeometry, rerenderAt } = mountImage(800)

    // A stroke drawn at fit width, stored normalized.
    const stored = normalizePoint(240, 90, lastGeometry(onGeometry))
    expect(stored[0]).toBeCloseTo(0.3, 10)

    // The musician zooms to 2.0 without closing the stage.
    rerenderAt(1600)
    const [pixelX, pixelY] = denormalizePoint(stored[0], stored[1], lastGeometry(onGeometry))

    // The same spot on the chart, now at twice the pixels — not still at 240.
    expect(pixelX).toBeCloseTo(480, 6)
    expect(pixelY).toBeCloseTo(180, 6)

    // And a stroke drawn at the zoomed width normalizes to the same fraction.
    expect(normalizePoint(480, 180, lastGeometry(onGeometry))[0]).toBeCloseTo(stored[0], 10)
  })
})
