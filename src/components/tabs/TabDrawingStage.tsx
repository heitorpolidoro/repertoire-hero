'use client'

import { useEffect, useRef, useState } from 'react'
import { Document, Page } from 'react-pdf'
import '@/lib/pdfWorker'
import { getTabAnnotationsAction, saveTabAnnotationsAction } from '@/app/actions/tabs'
import type { Stroke, TabAnnotations } from '@/types/database'
import {
  normalizePoint,
  denormalizePoint,
  normalizeWidth,
  denormalizeWidth,
  applyEraseAt,
  type PageGeometry,
} from '@/lib/annotationMath'
import {
  canvasPointerEvents,
  stageTouchAction,
  shouldHandleStagePointer,
} from '@/lib/stageInteraction'

interface TabDrawingStageProps {
  tabId: string
  repertoireId: string
  fileUrl: string
}

type Mode = 'pen' | 'erase' | 'pan'
type SaveState = 'loading' | 'saving' | 'saved' | 'error'

const PRESET_COLORS = ['#000000', '#ef4444', '#2563eb', '#16a34a']
const STROKE_WIDTH_PX = 3
const MIN_ZOOM = 1.0
const MAX_ZOOM = 3.0
const ZOOM_STEP = 0.25
const SAVE_DEBOUNCE_MS = 800

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function midpointOf(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

interface PinchState {
  initialDistance: number
  initialZoom: number
  initialMidpoint: { x: number; y: number }
  initialScrollLeft: number
  initialScrollTop: number
}

export default function TabDrawingStage({ tabId, repertoireId, fileUrl }: TabDrawingStageProps) {
  const stageContainerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [baseFitWidth, setBaseFitWidth] = useState(0)
  const [zoomLevel, setZoomLevel] = useState(MIN_ZOOM)
  const [numPages, setNumPages] = useState<number | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [pageGeometry, setPageGeometry] = useState<PageGeometry | null>(null)

  // Drawing is OFF every time Stage Mode opens and the preference is never
  // persisted: a tablet handed to a bandmate must not be drawn on by accident.
  const [drawingEnabled, setDrawingEnabled] = useState(false)
  const [mode, setMode] = useState<Mode>('pen')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [customColor, setCustomColor] = useState('#f97316')
  const colorInputRef = useRef<HTMLInputElement>(null)

  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [saveState, setSaveState] = useState<SaveState>('loading')
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [localToast, setLocalToast] = useState<{ message: string } | null>(null)

  const annotationsRef = useRef<TabAnnotations>({})
  const annotationsLoadedRef = useRef(false)
  const [annotationsLoaded, setAnnotationsLoaded] = useState(false)

  // Refs kept in sync purely so the final flush-on-unmount effect (whose
  // cleanup closure is captured once, at mount) can read the latest values
  // without needing to re-run the effect on every keystroke of drawing.
  const strokesRef = useRef<Stroke[]>([])
  const pageNumberRef = useRef(1)
  const pageGeometryRef = useRef<PageGeometry | null>(null)
  useEffect(() => { strokesRef.current = strokes }, [strokes])
  useEffect(() => { pageNumberRef.current = pageNumber }, [pageNumber])
  useEffect(() => { pageGeometryRef.current = pageGeometry }, [pageGeometry])

  // Live in-progress gesture state — kept in refs (not React state) so a fast
  // pointermove drag redraws the canvas imperatively without going through a
  // full React re-render on every point, avoiding perceptible lag while drawing.
  // Erasing keeps no gesture state at all: each removal is applied and persisted
  // on the spot (RH-20), so there is nothing for an aborted gesture to lose.
  const activeStrokeRef = useRef<{ x: number; y: number }[] | null>(null)
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const lastPanPosRef = useRef<{ x: number; y: number } | null>(null)
  const pinchStateRef = useRef<PinchState | null>(null)

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSaveRef = useRef(false)

  function showLocalToast(message: string) {
    setLocalToast({ message })
  }

  useEffect(() => {
    if (!localToast) return
    const t = setTimeout(() => setLocalToast(null), 4000)
    return () => clearTimeout(t)
  }, [localToast])

  // ---- Load stored annotations once on mount ----
  useEffect(() => {
    let cancelled = false
    getTabAnnotationsAction(tabId, repertoireId).then((res) => {
      if (cancelled) return
      if (res.data) {
        annotationsRef.current = res.data
      } else if (res.error) {
        showLocalToast(res.error)
      }
      annotationsLoadedRef.current = true
      setAnnotationsLoaded(true)
      setSaveState('saved')
    })
    return () => {
      cancelled = true
    }
    // Intentionally only depends on tabId/repertoireId — this loads the
    // whole tab's annotations once, not per-page.
  }, [tabId, repertoireId])

  // Sync the current page's strokes from the loaded annotations whenever
  // the page changes (or once loading completes for the initial page).
  useEffect(() => {
    if (!annotationsLoaded) return
    setStrokes(annotationsRef.current[String(pageNumber)] ?? [])
  }, [pageNumber, annotationsLoaded])

  // ---- baseFitWidth via ResizeObserver on the outer, fixed-layout viewport box ----
  useEffect(() => {
    const el = stageContainerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setBaseFitWidth(entry.contentRect.width)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ---- Canvas sizing to match the currently-rendered page pixel size ----
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !pageGeometry) return
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    canvas.width = Math.round(pageGeometry.width * dpr)
    canvas.height = Math.round(pageGeometry.height * dpr)
    canvas.style.width = `${pageGeometry.width}px`
    canvas.style.height = `${pageGeometry.height}px`
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageGeometry])

  // ---- Redraw whenever the persisted stroke set changes ----
  useEffect(() => {
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes])

  // ---- Flush any pending save immediately when this component unmounts (Stage Mode closes) ----
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
      if (pendingSaveRef.current) {
        void saveTabAnnotationsAction(tabId, repertoireId, pageNumberRef.current, strokesRef.current)
      }
    }
  }, [tabId, repertoireId])

  function redraw() {
    const canvas = canvasRef.current
    const page = pageGeometryRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !page) return

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (const stroke of strokesRef.current) {
      const pixelPoints = stroke.points.map(([nx, ny]) => denormalizePoint(nx, ny, page))
      const widthPx = denormalizeWidth(stroke.width, page)
      drawPath(ctx, pixelPoints, widthPx, stroke.color)
    }

    if (activeStrokeRef.current && activeStrokeRef.current.length > 0) {
      const livePoints = activeStrokeRef.current.map((p) => [p.x, p.y] as [number, number])
      drawPath(ctx, livePoints, STROKE_WIDTH_PX, color)
    }

    ctx.restore()
  }

  function drawPath(ctx: CanvasRenderingContext2D, points: [number, number][], widthPx: number, strokeColor: string) {
    if (points.length === 0) return
    ctx.lineWidth = Math.max(widthPx, 1)
    ctx.strokeStyle = strokeColor
    if (points.length === 1) {
      ctx.beginPath()
      ctx.fillStyle = strokeColor
      ctx.arc(points[0][0], points[0][1], Math.max(widthPx, 1) / 2, 0, Math.PI * 2)
      ctx.fill()
      return
    }
    ctx.beginPath()
    ctx.moveTo(points[0][0], points[0][1])
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1])
    }
    ctx.stroke()
  }

  // ---- Autosave: debounced, coalescing rapid consecutive strokes/erasures into one save ----
  function performSave(page: number, strokesToSave: Stroke[]) {
    setSaveState('saving')
    saveTabAnnotationsAction(tabId, repertoireId, page, strokesToSave).then((res) => {
      pendingSaveRef.current = false
      if (res.error) {
        setSaveState('error')
        showLocalToast(res.error)
      } else {
        setSaveState('saved')
      }
    })
  }

  // Reads from annotationsRef.current (not the `strokes` state closure)
  // because every stroke-mutation call site (commitStroke, handleUndo,
  // handleClearConfirm, eraseAt) writes annotationsRef.current[page]
  // synchronously *before* calling scheduleSave()/flushSave(), whereas the
  // `strokes` state closure only reflects the update after React re-renders.
  // Calling scheduleSave() in the same handler as the preceding setStrokes()
  // would otherwise capture the stale, pre-action strokes array.
  function scheduleSave() {
    pendingSaveRef.current = true
    setSaveState('saving')
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    const page = pageNumber
    const strokesToSave = annotationsRef.current[String(page)] ?? []
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null
      performSave(page, strokesToSave)
    }, SAVE_DEBOUNCE_MS)
  }

  // A save is flushed immediately (not debounced) when the page changes, so
  // no stroke is ever lost to a pending debounce timer.
  function flushSave() {
    if (!saveTimeoutRef.current) return
    clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = null
    if (pendingSaveRef.current) {
      performSave(pageNumber, annotationsRef.current[String(pageNumber)] ?? [])
    }
  }

  function goToPage(next: number) {
    if (next < 1 || (numPages !== null && next > numPages)) return
    flushSave()
    setPageNumber(next)
    // Zoom always resets to 1.0 (fit-width) on every page navigation, so
    // each newly-viewed page starts predictable rather than carrying over
    // the previous page's zoom level.
    setZoomLevel(MIN_ZOOM)
  }

  // ---- Stroke mutation helpers (share the exact same debounced save path used for drawing and erasing) ----
  function commitStroke(rawPoints: { x: number; y: number }[]) {
    const page = pageGeometryRef.current
    if (!page || rawPoints.length === 0) return
    const points = rawPoints.map((p) => normalizePoint(p.x, p.y, page))
    const width = normalizeWidth(STROKE_WIDTH_PX, page)
    const stroke: Stroke = { id: crypto.randomUUID(), color, width, points }
    const next = [...strokes, stroke]
    annotationsRef.current[String(pageNumber)] = next
    setStrokes(next)
    scheduleSave()
  }

  function eraseAt(x: number, y: number) {
    const page = pageGeometryRef.current
    if (!page) return
    // annotationsRef — not the `strokes` state closure — is the source of truth the
    // save path reads; two erase hits inside one fast drag can share a stale
    // `strokes` value and the second would otherwise resurrect the first removal.
    const current = annotationsRef.current[String(pageNumber)] ?? strokes
    const { strokes: next, removedId } = applyEraseAt(current, x, y, page)
    if (!removedId) return
    annotationsRef.current[String(pageNumber)] = next
    setStrokes(next)
    // Persist here, never at the end of the gesture (RH-20): the removal is
    // already applied, and every gesture-abort path discards end-of-gesture state.
    scheduleSave()
  }

  function handleUndo() {
    if (strokes.length === 0) return
    const next = strokes.slice(0, -1)
    annotationsRef.current[String(pageNumber)] = next
    setStrokes(next)
    scheduleSave()
  }

  function handleClearConfirm() {
    setClearConfirmOpen(false)
    if (strokes.length === 0) return
    annotationsRef.current[String(pageNumber)] = []
    setStrokes([])
    scheduleSave()
  }

  // ---- Pointer Events: one unified code path for mouse, touch, and stylus ----
  function getRelativePos(e: { clientX: number; clientY: number }) {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function startPinch() {
    const pts = Array.from(pointersRef.current.values())
    if (pts.length < 2) return
    const [p1, p2] = pts
    pinchStateRef.current = {
      initialDistance: distanceBetween(p1, p2),
      initialZoom: zoomLevel,
      initialMidpoint: midpointOf(p1, p2),
      initialScrollLeft: scrollContainerRef.current?.scrollLeft ?? 0,
      initialScrollTop: scrollContainerRef.current?.scrollTop ?? 0,
    }
  }

  function updatePinch() {
    const state = pinchStateRef.current
    const pts = Array.from(pointersRef.current.values())
    if (!state || pts.length < 2) return
    const [p1, p2] = pts
    const dist = distanceBetween(p1, p2)
    if (state.initialDistance === 0) return
    const scaleFactor = dist / state.initialDistance
    setZoomLevel(clamp(state.initialZoom * scaleFactor, MIN_ZOOM, MAX_ZOOM))

    const mid = midpointOf(p1, p2)
    const dx = mid.x - state.initialMidpoint.x
    const dy = mid.y - state.initialMidpoint.y
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = state.initialScrollLeft - dx
      scrollContainerRef.current.scrollTop = state.initialScrollTop - dy
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!shouldHandleStagePointer(drawingEnabled)) return
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setPointerCapture(e.pointerId)
    const pos = getRelativePos(e)
    pointersRef.current.set(e.pointerId, pos)

    if (pointersRef.current.size === 2) {
      // A second simultaneous pointer always means "pinch zoom/pan" — abort
      // (not commit) any in-progress single-pointer stroke. Nothing has to be
      // rescued for an erase-drag: `eraseAt` already scheduled the save for every
      // stroke it removed, so there is no deferred write left to drop here.
      activeStrokeRef.current = null
      redraw()
      startPinch()
      return
    }
    if (pointersRef.current.size > 2) return

    lastPanPosRef.current = pos
    if (mode === 'pen') {
      activeStrokeRef.current = [pos]
      redraw()
    } else if (mode === 'erase') {
      eraseAt(pos.x, pos.y)
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!shouldHandleStagePointer(drawingEnabled)) return
    if (!pointersRef.current.has(e.pointerId)) return
    const pos = getRelativePos(e)
    pointersRef.current.set(e.pointerId, pos)

    if (pointersRef.current.size >= 2) {
      updatePinch()
      return
    }

    if (mode === 'pen' && activeStrokeRef.current) {
      activeStrokeRef.current.push(pos)
      redraw()
    } else if (mode === 'erase') {
      eraseAt(pos.x, pos.y)
    } else if (mode === 'pan') {
      const last = lastPanPosRef.current
      if (last && scrollContainerRef.current) {
        scrollContainerRef.current.scrollLeft -= pos.x - last.x
        scrollContainerRef.current.scrollTop -= pos.y - last.y
      }
      lastPanPosRef.current = pos
    }
  }

  function endPointer(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!shouldHandleStagePointer(drawingEnabled)) return
    const canvas = canvasRef.current
    // Drop the bookkeeping entry *before* releasing capture: the explicit
    // release below (and the implicit one the UA performs at `pointerup`) fires
    // `lostpointercapture`, and `handleLostPointerCapture` uses the absence of
    // this entry to tell a normal gesture end from a genuine silent loss.
    pointersRef.current.delete(e.pointerId)
    if (canvas?.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId)
    }

    if (pinchStateRef.current && pointersRef.current.size < 2) {
      pinchStateRef.current = null
      // When the pointer count drops back to 0 or 1, pinch tracking ends and
      // a fresh single-pointer touch starts a normal stroke/erase-drag/pan.
      if (pointersRef.current.size === 1) {
        const [remainingPos] = Array.from(pointersRef.current.values())
        lastPanPosRef.current = remainingPos
        if (mode === 'pen') {
          activeStrokeRef.current = [remainingPos]
        } else if (mode === 'erase') {
          eraseAt(remainingPos.x, remainingPos.y)
        }
      }
      return
    }

    if (mode === 'pen' && activeStrokeRef.current) {
      const points = activeStrokeRef.current
      activeStrokeRef.current = null
      commitStroke(points)
      redraw()
    }
    // No erase branch: every removal was already persisted by `eraseAt` itself.
    lastPanPosRef.current = null
  }

  /**
   * A pointer the browser silently takes away never fires `pointerup` /
   * `pointercancel`, so without this its `pointersRef` entry would survive and
   * the *next* single touch would be counted as `size === 2` and misread as a
   * pinch. Routed to the same cleanup as `endPointer`, minus the commit: the
   * interrupted stroke is aborted rather than turned into a stray mark.
   *
   * `lostpointercapture` also fires on *every* normal gesture end — both from
   * the explicit `releasePointerCapture` in `endPointer` and from the implicit
   * release the UA performs at `pointerup`. `endPointer` has already deleted the
   * id by then, so a missing entry means "already handled" and this must be a
   * no-op. Without that guard it would undo the state `endPointer` deliberately
   * just set when one finger of a pinch is lifted: the remaining finger's
   * `activeStrokeRef` / `lastPanPosRef`, so stroke continuation would die.
   *
   * An erase interrupted here needs no rescue either: `eraseAt` persists each
   * removal as it applies it (RH-20), so a pointer taken away mid-erase leaves
   * nothing unsaved behind.
   */
  function handleLostPointerCapture(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size < 2) {
      pinchStateRef.current = null
    }
    activeStrokeRef.current = null
    lastPanPosRef.current = null
    redraw()
  }

  function handleToggleDrawing() {
    if (drawingEnabled) {
      // Leaving drawing mode: abort anything in flight so no half-gesture is
      // committed, drop all pointer bookkeeping so re-enabling starts clean,
      // and flush the debounced save so switching to reading (and then closing
      // Stage Mode) can never drop the last stroke.
      activeStrokeRef.current = null
      pointersRef.current.clear()
      pinchStateRef.current = null
      lastPanPosRef.current = null
      redraw()
      flushSave()
    }
    setDrawingEnabled(!drawingEnabled)
  }

  function handleZoomIn() {
    setZoomLevel((z) => clamp(Math.round((z + ZOOM_STEP) * 100) / 100, MIN_ZOOM, MAX_ZOOM))
  }
  function handleZoomOut() {
    setZoomLevel((z) => clamp(Math.round((z - ZOOM_STEP) * 100) / 100, MIN_ZOOM, MAX_ZOOM))
  }
  function handleZoomReset() {
    setZoomLevel(MIN_ZOOM)
  }

  function handlePresetColor(preset: string) {
    setColor(preset)
  }

  function handleCustomColorSwatchClick() {
    colorInputRef.current?.click()
  }

  function handleCustomColorChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    setCustomColor(value)
    setColor(value)
  }

  const renderWidth = baseFitWidth > 0 ? baseFitWidth * zoomLevel : undefined
  const saveLabel = saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : saveState === 'loading' ? 'Loading…' : 'Saved'

  // The stage root below is the common ancestor of BOTH the drawing area and
  // the toolbar, and touch-action composes as the intersection down the
  // ancestor chain — a descendant can never widen it. It therefore stays
  // permissive ('pan-x pan-y') at all times, so the toolbar keeps its own
  // 'pan-x' horizontal scroll while drawing is on. Gestures over the drawing
  // area are suppressed by the three nodes below it instead ('none' while
  // drawing). Do not restore 'none' to the stage root.
  //
  // It is also laid out *inside* its parent's flex column ('flex-1 min-h-0'),
  // never 'h-full': the Stage Mode overlay is a `flex flex-col` with a definite
  // pixel height, so `height: 100%` here would resolve to the FULL overlay
  // height without subtracting the overlay header, pushing the toolbar exactly
  // one header-height below the visible area — the reported tablet bug.
  // 'min-h-0' is what lets this column shrink to the space the header leaves.
  return (
    <div className="flex-1 min-h-0 w-full bg-black flex flex-col relative" style={{ touchAction: 'pan-x pan-y' }}>
      <div
        ref={stageContainerRef}
        className="flex-1 min-h-0 relative overflow-hidden"
        style={{ touchAction: stageTouchAction(drawingEnabled) }}
      >
        <div
          ref={scrollContainerRef}
          className="w-full h-full overflow-auto"
          style={{ touchAction: stageTouchAction(drawingEnabled), overscrollBehavior: 'contain' }}
        >
          <div className="min-h-full w-full flex items-start justify-center p-4">
            {renderWidth !== undefined && (
              <div className="relative inline-block">
                <Document
                  file={fileUrl}
                  onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                  loading={<div className="text-white text-sm p-8">Loading PDF…</div>}
                  error={<div className="text-red-400 text-sm p-8">Failed to load PDF.</div>}
                >
                  <Page
                    pageNumber={pageNumber}
                    width={renderWidth}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    onRenderSuccess={(page) =>
                      setPageGeometry({
                        width: page.width,
                        height: page.height,
                        originalWidth: page.originalWidth,
                        originalHeight: page.originalHeight,
                      })
                    }
                  />
                </Document>
                {/* Stays mounted while drawing is off so saved strokes keep
                    rendering read-only; only hit-testing is disabled. */}
                <canvas
                  ref={canvasRef}
                  className="absolute top-0 left-0"
                  style={{
                    touchAction: stageTouchAction(drawingEnabled),
                    pointerEvents: canvasPointerEvents(drawingEnabled),
                  }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={endPointer}
                  onPointerCancel={endPointer}
                  onLostPointerCapture={handleLostPointerCapture}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Floating bottom toolbar — thumb-reachable. Its own border-box height is
          constant (page-nav row + one no-wrap control row) at every supported
          width; the device safe-area inset is carried by the sibling spacer
          below, never by this element's padding. */}
      <div
        className="shrink-0 bg-gray-900/95 backdrop-blur-sm border-t border-gray-800 px-3 py-2 flex flex-col gap-2"
        style={{ touchAction: 'pan-x' }}
      >
        {/* Page navigation */}
        <div className="flex items-center justify-center gap-3 text-white text-xs">
          <button
            type="button"
            onClick={() => goToPage(pageNumber - 1)}
            disabled={pageNumber <= 1}
            className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed font-semibold"
          >
            ‹ Prev
          </button>
          <span className="font-mono">
            Page {pageNumber} / {numPages ?? '…'}
          </span>
          <button
            type="button"
            onClick={() => goToPage(pageNumber + 1)}
            disabled={numPages === null || pageNumber >= numPages}
            className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed font-semibold"
          >
            Next ›
          </button>
          <span
            className={`ml-2 text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded-full ${
              saveState === 'error' ? 'bg-red-950 text-red-300' : 'bg-gray-800 text-gray-300'
            }`}
          >
            {saveLabel}
          </span>
        </div>

        {/* Single, never-wrapping control row: its height is what keeps the
            whole toolbar at a constant, budgeted height on tablets. Anything
            that does not fit is reached by scrolling the row horizontally. */}
        <div className="flex items-center justify-between gap-2 flex-nowrap overflow-x-auto overscroll-x-contain">
          {/* Drawing on/off — always rendered, leftmost, 44×44 touch target */}
          <button
            type="button"
            aria-label="Toggle drawing"
            aria-pressed={drawingEnabled}
            onClick={handleToggleDrawing}
            className={`shrink-0 min-h-11 min-w-11 px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              drawingEnabled ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-300 hover:text-white'
            }`}
          >
            {drawingEnabled ? '✏️ Draw: On' : '✏️ Draw: Off'}
          </button>

          {drawingEnabled && (
          <>
          {/* Mode toggle: Pen / Erase / Pan */}
          <div className="shrink-0 flex items-center gap-1 bg-gray-800 rounded-lg p-1">
            {(['pen', 'erase', 'pan'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-colors ${
                  mode === m ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:text-white'
                }`}
              >
                {m === 'pen' ? '✏️ Pen' : m === 'erase' ? '🧹 Erase' : '✋ Pan'}
              </button>
            ))}
          </div>

          {/* Color control: 4 presets + 1 custom swatch */}
          <div className="shrink-0 flex items-center gap-1.5">
            {PRESET_COLORS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-label={`Color ${preset}`}
                onClick={() => handlePresetColor(preset)}
                className={`w-6 h-6 rounded-full border-2 ${color === preset ? 'border-white' : 'border-gray-600'}`}
                style={{ backgroundColor: preset }}
              />
            ))}
            <button
              type="button"
              aria-label="Custom color"
              onClick={handleCustomColorSwatchClick}
              className={`w-6 h-6 rounded-full border-2 ${color === customColor ? 'border-white' : 'border-gray-600'}`}
              style={{ backgroundColor: customColor }}
            />
            <input
              ref={colorInputRef}
              type="color"
              value={customColor}
              onChange={handleCustomColorChange}
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
            />
          </div>
          </>
          )}

          {/* Zoom controls — in-app zoom only; it scales the PDF canvas and
              never the browser's visual viewport, so it is available in both
              read and draw mode. */}
          <div className="shrink-0 flex items-center gap-1 bg-gray-800 rounded-lg p-1">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoomLevel <= MIN_ZOOM}
              className="w-7 h-7 rounded-md text-white text-sm font-bold hover:bg-gray-700 disabled:opacity-30"
            >
              −
            </button>
            <button
              type="button"
              onClick={handleZoomReset}
              className="px-2 h-7 rounded-md text-white text-[11px] font-mono hover:bg-gray-700"
            >
              {Math.round(zoomLevel * 100)}%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoomLevel >= MAX_ZOOM}
              className="w-7 h-7 rounded-md text-white text-sm font-bold hover:bg-gray-700 disabled:opacity-30"
            >
              +
            </button>
          </div>

          {/* Undo / Clear */}
          {drawingEnabled && (
          <div className="shrink-0 flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleUndo}
              disabled={strokes.length === 0}
              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-semibold"
            >
              ↶ Undo
            </button>
            <button
              type="button"
              onClick={() => setClearConfirmOpen(true)}
              disabled={strokes.length === 0}
              className="px-3 py-1.5 rounded-lg bg-red-900/60 hover:bg-red-900 disabled:opacity-30 disabled:cursor-not-allowed text-red-200 text-xs font-semibold"
            >
              Clear page
            </button>
          </div>
          )}
        </div>
      </div>

      {/* Safe-area spacer: keeps env(safe-area-inset-bottom) OUT of the
          toolbar's own box, so the toolbar's border-box height is identical on
          every device, while the home-indicator strip is still filled with the
          toolbar's background and overlaps no control. */}
      <div
        aria-hidden
        className="shrink-0 bg-gray-900/95"
        style={{ height: 'env(safe-area-inset-bottom, 0px)' }}
      />

      {/* Clear-page confirmation — Toast-based, no native confirm() */}
      {clearConfirmOpen && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10 w-[90%] max-w-sm">
          <div className="rounded-xl px-4 py-3 shadow-xl border bg-gray-900/95 text-white border-gray-700 flex flex-col gap-2 text-xs font-semibold backdrop-blur-md">
            <span>Clear all annotations on this page? This can&apos;t be undone.</span>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setClearConfirmOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearConfirm}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Local error toast */}
      {localToast && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10 w-[90%] max-w-sm pointer-events-none">
          <div className="rounded-xl px-4 py-3 shadow-xl border bg-red-950/90 text-red-100 border-red-800 text-xs font-semibold backdrop-blur-md">
            {localToast.message}
          </div>
        </div>
      )}
    </div>
  )
}
