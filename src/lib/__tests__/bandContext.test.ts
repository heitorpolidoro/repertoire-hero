/**
 * RH-98 — the band-context reconciliation decision.
 *
 * The decision used to live inline in `AppShell`'s mount effect and had no
 * `else`: a persisted context pointing at a band the server no longer returns
 * survived in `localStorage` and poisoned every band-scoped call. The function
 * under test owns all three outcomes; `AppShell` only applies them.
 */
import { describe, it, expect } from 'vitest'
import { reconcileBandContext, type BandContextDecision } from '@/lib/bandContext'
import { DEFAULT_BAND_COLOR } from '@/lib/bandColors'
import type { BandOption } from '@/types/database'

const BANDS: BandOption[] = [
  { id: 'band-1', name: 'The Nulls', color: null },
  { id: 'band-2', name: 'Stone Pilots', color: '#1d4ed8' },
]

describe('reconcileBandContext', () => {
  it('keeps a personal context whatever the list holds', () => {
    expect(reconcileBandContext({ type: 'user' }, BANDS)).toEqual({ action: 'keep' })
  })

  it('keeps a personal context against an empty list', () => {
    expect(reconcileBandContext({ type: 'user' }, [])).toEqual({ action: 'keep' })
  })

  it('keeps a band context that already matches the fetched row', () => {
    const decision: BandContextDecision = reconcileBandContext(
      { type: 'band', id: 'band-2', name: 'Stone Pilots', color: '#1d4ed8' },
      BANDS
    )
    expect(decision).toEqual({ action: 'keep' })
  })

  it('treats a null fetched colour as the default colour rather than a refresh loop', () => {
    expect(
      reconcileBandContext(
        { type: 'band', id: 'band-1', name: 'The Nulls', color: DEFAULT_BAND_COLOR },
        BANDS
      )
    ).toEqual({ action: 'keep' })
  })

  it('refreshes a renamed band', () => {
    expect(
      reconcileBandContext(
        { type: 'band', id: 'band-2', name: 'Old Name', color: '#1d4ed8' },
        BANDS
      )
    ).toEqual({ action: 'refresh', id: 'band-2', name: 'Stone Pilots', color: '#1d4ed8' })
  })

  it('refreshes a recoloured band', () => {
    expect(
      reconcileBandContext(
        { type: 'band', id: 'band-2', name: 'Stone Pilots', color: '#047857' },
        BANDS
      )
    ).toEqual({ action: 'refresh', id: 'band-2', name: 'Stone Pilots', color: '#1d4ed8' })
  })

  it('refreshes a context with no stored colour to the default when the row has none', () => {
    expect(
      reconcileBandContext({ type: 'band', id: 'band-1', name: 'The Nulls' }, BANDS)
    ).toEqual({ action: 'refresh', id: 'band-1', name: 'The Nulls', color: DEFAULT_BAND_COLOR })
  })

  it('resets to personal when the band is absent from the list', () => {
    expect(
      reconcileBandContext(
        { type: 'band', id: 'band-gone', name: 'Disbanded', color: DEFAULT_BAND_COLOR },
        BANDS
      )
    ).toEqual({ action: 'reset' })
  })

  it('resets to personal when the resolved list is empty', () => {
    expect(
      reconcileBandContext(
        { type: 'band', id: 'band-1', name: 'The Nulls', color: DEFAULT_BAND_COLOR },
        []
      )
    ).toEqual({ action: 'reset' })
  })
})
