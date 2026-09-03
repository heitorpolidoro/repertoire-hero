/**
 * RH-23 — Pins the toast tone class strings that the shared `<Toast>` renders.
 *
 * The sweep that extracted `<Toast>` promised UI identity: every page that used
 * to hard-code these Tailwind class lists must keep rendering exactly the same
 * colours. Asserting the literals here makes that promise mechanical.
 */

import { describe, it, expect } from 'vitest'
import { TOAST_TONE_CLASSES } from '../uiTones'

describe('TOAST_TONE_CLASSES', () => {
  it('renders the success tone with the emerald palette', () => {
    expect(TOAST_TONE_CLASSES.success).toBe(
      'bg-emerald-950/90 text-emerald-100 border-emerald-800',
    )
  })

  it('renders the error tone with the red palette', () => {
    expect(TOAST_TONE_CLASSES.error).toBe('bg-red-950/90 text-red-100 border-red-800')
  })

  it('renders the warning tone with the amber palette', () => {
    expect(TOAST_TONE_CLASSES.warning).toBe(
      'bg-amber-950/90 text-amber-100 border-amber-800',
    )
  })

  it('renders the info tone with the neutral palette', () => {
    expect(TOAST_TONE_CLASSES.info).toBe('bg-gray-900/90 text-white border-gray-700')
  })

  it('defines exactly the four supported tones', () => {
    expect(Object.keys(TOAST_TONE_CLASSES)).toEqual([
      'success',
      'error',
      'warning',
      'info',
    ])
  })
})
