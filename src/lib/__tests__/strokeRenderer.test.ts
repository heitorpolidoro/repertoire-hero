/**
 * RH-99 ER10 — `drawPath`, the stage's canvas painter, extracted out of
 * `TabDrawingStage` into `src/lib/strokeRenderer.ts`.
 *
 * It closes over nothing: every input is a parameter, so it is testable with a
 * fake `CanvasRenderingContext2D` that only records the calls made on it — the
 * same way `annotationMath.ts` and `stageInteraction.ts` are tested without a
 * DOM. The three cases are the three branches: no point, one point (a dot) and
 * a polyline.
 */
import { describe, it, expect } from 'vitest'
import { drawPath } from '@/lib/strokeRenderer'

interface Call {
  name: string
  args: unknown[]
}

/** Records every method call and every property assignment, in order. */
function createFakeContext() {
  const calls: Call[] = []
  const record = (name: string) => (...args: unknown[]) => { calls.push({ name, args }) }
  const ctx = {
    calls,
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    arc: record('arc'),
    fill: record('fill'),
  }
  return ctx
}

function names(ctx: ReturnType<typeof createFakeContext>) {
  return ctx.calls.map((c) => c.name)
}

function asContext(ctx: ReturnType<typeof createFakeContext>) {
  return ctx as unknown as CanvasRenderingContext2D
}

describe('drawPath', () => {
  it('draws nothing for an empty point list', () => {
    const ctx = createFakeContext()

    drawPath(asContext(ctx), [], 3, '#ef4444')

    expect(names(ctx)).toEqual([])
    // Not even the style is touched: an empty stroke must leave the context as
    // it was, so the next stroke in the loop is not painted with its settings.
    expect(ctx.lineWidth).toBe(0)
    expect(ctx.strokeStyle).toBe('')
  })

  it('draws a single point as a filled dot of half the stroke width', () => {
    const ctx = createFakeContext()

    drawPath(asContext(ctx), [[12, 34]], 4, '#2563eb')

    expect(names(ctx)).toEqual(['beginPath', 'arc', 'fill'])
    expect(ctx.calls[1].args).toEqual([12, 34, 2, 0, Math.PI * 2])
    expect(ctx.lineWidth).toBe(4)
    expect(ctx.strokeStyle).toBe('#2563eb')
    expect(ctx.fillStyle).toBe('#2563eb')
    expect(names(ctx)).not.toContain('stroke')
  })

  it('draws a multi-point path as one moveTo followed by a lineTo per point', () => {
    const ctx = createFakeContext()

    drawPath(asContext(ctx), [[0, 0], [10, 5], [20, 15]], 3, '#16a34a')

    expect(names(ctx)).toEqual(['beginPath', 'moveTo', 'lineTo', 'lineTo', 'stroke'])
    expect(ctx.calls[1].args).toEqual([0, 0])
    expect(ctx.calls[2].args).toEqual([10, 5])
    expect(ctx.calls[3].args).toEqual([20, 15])
    expect(ctx.lineWidth).toBe(3)
    expect(ctx.strokeStyle).toBe('#16a34a')
  })

  it('never draws thinner than one device pixel', () => {
    const ctx = createFakeContext()

    drawPath(asContext(ctx), [[1, 1]], 0.2, '#000000')

    expect(ctx.lineWidth).toBe(1)
    // The dot radius follows the same floor: half of 1, not half of 0.2.
    expect(ctx.calls[1].args).toEqual([1, 1, 0.5, 0, Math.PI * 2])
  })
})
