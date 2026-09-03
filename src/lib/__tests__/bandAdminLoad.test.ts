/**
 * RH-23 — The two band-admin surfaces (`/bands/[id]` and the band tab of
 * `/profile`) share one controller hook but keep two different `load()`
 * behaviours. Those behaviours are encoded as policy constants so the
 * divergence cannot be silently unified by a later refactor.
 */

import { describe, it, expect } from 'vitest'
import {
  BANDS_PAGE_LOAD_POLICY,
  BAND_PROFILE_LOAD_POLICY,
  resolveLoadErrorMessage,
} from '../bandAdminLoad'

describe('band admin load policies', () => {
  it('lets a load rejection escape and keeps loading on not-found for the bands page', () => {
    expect(BANDS_PAGE_LOAD_POLICY).toEqual({
      catchLoadErrors: false,
      clearLoadingOnNotFound: false,
    })
  })

  it('catches load rejections and clears loading on not-found for the band profile view', () => {
    expect(BAND_PROFILE_LOAD_POLICY).toEqual({
      catchLoadErrors: true,
      clearLoadingOnNotFound: true,
    })
  })

  it('keeps the two policies distinct so neither page inherits the other behaviour', () => {
    expect(BANDS_PAGE_LOAD_POLICY).not.toEqual(BAND_PROFILE_LOAD_POLICY)
  })
})

describe('resolveLoadErrorMessage', () => {
  it('uses the message of a real Error', () => {
    expect(resolveLoadErrorMessage(new Error('boom'), 'fallback')).toBe('boom')
  })

  it('uses the fallback for anything that is not an Error', () => {
    expect(resolveLoadErrorMessage('boom', 'fallback')).toBe('fallback')
    expect(resolveLoadErrorMessage(undefined, 'fallback')).toBe('fallback')
  })
})
