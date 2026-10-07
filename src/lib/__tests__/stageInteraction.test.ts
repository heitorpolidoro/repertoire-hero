import { describe, it, expect } from 'vitest'
import {
  stageViewportHeight,
  canvasPointerEvents,
  stageTouchAction,
  isStableViewportMeasurement,
  shouldHandleStagePointer,
  stageSaveLabel,
} from '@/lib/stageInteraction'

describe('stageViewportHeight', () => {
  it('prefers the visual viewport height over innerHeight', () => {
    expect(stageViewportHeight(700, 800)).toBe(700)
  })

  it('falls back to innerHeight when visualViewport is unavailable', () => {
    expect(stageViewportHeight(undefined, 800)).toBe(800)
    expect(stageViewportHeight(null, 800)).toBe(800)
  })

  it('never produces a zero, NaN or negative overlay height', () => {
    expect(stageViewportHeight(0, 800)).toBe(800)
    expect(stageViewportHeight(NaN, 800)).toBe(800)
    expect(stageViewportHeight(-50, 800)).toBe(800)
    expect(stageViewportHeight(Infinity, 800)).toBe(800)
  })

  it('accepts a fractional visual viewport height as reported by the browser', () => {
    expect(stageViewportHeight(731.5, 800)).toBe(731.5)
  })
})

describe('canvasPointerEvents', () => {
  it('disables canvas hit-testing while drawing is off', () => {
    expect(canvasPointerEvents(false)).toBe('none')
  })

  it('enables canvas hit-testing while drawing is on', () => {
    expect(canvasPointerEvents(true)).toBe('auto')
  })
})

describe('stageTouchAction', () => {
  it('suppresses every native gesture on the drawing subtree while drawing', () => {
    expect(stageTouchAction(true)).toBe('none')
  })

  it('restores native panning — but not browser pinch-zoom — while reading', () => {
    expect(stageTouchAction(false)).toBe('pan-x pan-y')
    // Guard: 'auto' would re-enable browser pinch-zoom, which is
    // incompatible with visual-viewport sizing of the overlay (§2a).
    expect(stageTouchAction(false)).not.toBe('auto')
    expect(stageTouchAction(true)).not.toBe('auto')
  })
})

describe('shouldHandleStagePointer', () => {
  it('drops pointer events while drawing is off', () => {
    expect(shouldHandleStagePointer(false)).toBe(false)
  })

  it('handles pointer events while drawing is on', () => {
    expect(shouldHandleStagePointer(true)).toBe(true)
  })
})

describe('isStableViewportMeasurement', () => {
  it('treats an unreported scale as stable', () => {
    expect(isStableViewportMeasurement(undefined)).toBe(true)
    expect(isStableViewportMeasurement(null)).toBe(true)
    expect(isStableViewportMeasurement(NaN)).toBe(true)
  })

  it('treats a scale within 1% of 1 as stable', () => {
    expect(isStableViewportMeasurement(1)).toBe(true)
    expect(isStableViewportMeasurement(1.005)).toBe(true)
    expect(isStableViewportMeasurement(0.995)).toBe(true)
  })

  it('treats a pinch-zoomed visual viewport as unstable', () => {
    expect(isStableViewportMeasurement(1.5)).toBe(false)
    expect(isStableViewportMeasurement(2)).toBe(false)
    expect(isStableViewportMeasurement(0.5)).toBe(false)
    expect(isStableViewportMeasurement(1.02)).toBe(false)
  })
})

/**
 * RH-128 moved this out of `TabDrawingStage`'s render body. It is the stage's
 * only always-visible feedback that ink is safe — the page-navigation row it
 * used to share is now absent for an image and for a single-page PDF — so it
 * is worth a test of its own rather than a glance at a component tree.
 */
describe('stageSaveLabel', () => {
  it('reads as loading until the annotations prop has arrived', () => {
    expect(stageSaveLabel(false, 'saved')).toBe('Loading\u2026')
    expect(stageSaveLabel(false, 'saving')).toBe('Loading\u2026')
    expect(stageSaveLabel(false, 'error')).toBe('Loading\u2026')
  })

  it('reads each loaded save state', () => {
    expect(stageSaveLabel(true, 'loading')).toBe('Loading\u2026')
    expect(stageSaveLabel(true, 'saving')).toBe('Saving\u2026')
    expect(stageSaveLabel(true, 'error')).toBe('Save failed')
    expect(stageSaveLabel(true, 'saved')).toBe('Saved')
  })
})
