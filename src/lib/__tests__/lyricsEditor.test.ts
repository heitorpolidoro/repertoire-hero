import { describe, it, expect } from 'vitest'
import {
  clampLyricsFontSize,
  hasPersonalVersion,
  resolveLyricsSaveTarget,
  resolveLyricsVersion,
  seedLyricsDraft,
  selectDisplayedLyrics,
  stepLyricsFontSize,
  type LyricsSource,
} from '@/lib/lyricsEditor'

const BAND_ENTRY: LyricsSource = { band_id: 'band-1', lyrics: 'band words' }
const SOLO_ENTRY: LyricsSource = { band_id: null, lyrics: 'my only words' }
const PERSONAL_ENTRY: LyricsSource = { band_id: null, lyrics: 'my words' }

describe('lyricsEditor', () => {
  it('clampLyricsFontSize keeps a size inside the range untouched', () => {
    expect(clampLyricsFontSize(18)).toBe(18)
    expect(clampLyricsFontSize(12)).toBe(12)
    expect(clampLyricsFontSize(36)).toBe(36)
  })

  it('clampLyricsFontSize clamps at the lower bound of 12', () => {
    expect(clampLyricsFontSize(4)).toBe(12)
  })

  it('clampLyricsFontSize clamps at the upper bound of 36', () => {
    expect(clampLyricsFontSize(99)).toBe(36)
  })

  it('stepLyricsFontSize increases by two up to the upper bound and no further', () => {
    expect(stepLyricsFontSize(18, 2)).toBe(20)
    expect(stepLyricsFontSize(34, 2)).toBe(36)
    expect(stepLyricsFontSize(36, 2)).toBe(36)
  })

  it('stepLyricsFontSize decreases by two down to the lower bound and no further', () => {
    expect(stepLyricsFontSize(18, -2)).toBe(16)
    expect(stepLyricsFontSize(14, -2)).toBe(12)
    expect(stepLyricsFontSize(12, -2)).toBe(12)
  })

  // ---------------------------------------------------------------------
  // RH-83 ER1 — which version is read, with no interaction at all.
  // ---------------------------------------------------------------------

  it('resolveLyricsVersion is band outside a band, whatever the personal row says', () => {
    expect(resolveLyricsVersion(SOLO_ENTRY, PERSONAL_ENTRY)).toBe('band')
    expect(resolveLyricsVersion(null, PERSONAL_ENTRY)).toBe('band')
  })

  it('resolveLyricsVersion is band when the member has no personal row', () => {
    expect(resolveLyricsVersion(BAND_ENTRY, null)).toBe('band')
  })

  it('resolveLyricsVersion is band when the personal lyrics are empty or whitespace only', () => {
    expect(resolveLyricsVersion(BAND_ENTRY, { band_id: null, lyrics: null })).toBe('band')
    expect(resolveLyricsVersion(BAND_ENTRY, { band_id: null, lyrics: '' })).toBe('band')
    expect(resolveLyricsVersion(BAND_ENTRY, { band_id: null, lyrics: '   \n\t ' })).toBe('band')
  })

  it('resolveLyricsVersion is personal when a band member has a non-empty personal version', () => {
    expect(resolveLyricsVersion(BAND_ENTRY, PERSONAL_ENTRY)).toBe('personal')
    // Identical text still counts: what matters is that a version exists.
    expect(resolveLyricsVersion(BAND_ENTRY, { band_id: null, lyrics: 'band words' })).toBe('personal')
  })

  it('hasPersonalVersion is false outside a band and without a personal version', () => {
    expect(hasPersonalVersion(SOLO_ENTRY, PERSONAL_ENTRY)).toBe(false)
    expect(hasPersonalVersion(null, PERSONAL_ENTRY)).toBe(false)
    expect(hasPersonalVersion(BAND_ENTRY, null)).toBe(false)
    expect(hasPersonalVersion(BAND_ENTRY, { band_id: null, lyrics: '' })).toBe(false)
    expect(hasPersonalVersion(BAND_ENTRY, { band_id: null, lyrics: '  ' })).toBe(false)
  })

  it('hasPersonalVersion is true even when the personal version matches the band one', () => {
    expect(hasPersonalVersion(BAND_ENTRY, PERSONAL_ENTRY)).toBe(true)
    expect(hasPersonalVersion(BAND_ENTRY, { band_id: null, lyrics: 'band words' })).toBe(true)
  })

  it('selectDisplayedLyrics shows the entry lyrics outside a band', () => {
    expect(selectDisplayedLyrics(SOLO_ENTRY, PERSONAL_ENTRY, 'personal')).toBe('my only words')
    expect(selectDisplayedLyrics(SOLO_ENTRY, PERSONAL_ENTRY, 'band')).toBe('my only words')
    expect(selectDisplayedLyrics(null, PERSONAL_ENTRY, 'band')).toBeNull()
  })

  it('selectDisplayedLyrics shows the band lyrics on the band version', () => {
    expect(selectDisplayedLyrics(BAND_ENTRY, PERSONAL_ENTRY, 'band')).toBe('band words')
  })

  it('selectDisplayedLyrics shows the personal lyrics on the personal version', () => {
    expect(selectDisplayedLyrics(BAND_ENTRY, PERSONAL_ENTRY, 'personal')).toBe('my words')
  })

  it('selectDisplayedLyrics falls back to the band lyrics when no personal entry has loaded', () => {
    expect(selectDisplayedLyrics(BAND_ENTRY, null, 'personal')).toBe('band words')
  })

  // ---------------------------------------------------------------------
  // RH-83 ER5 — the draft a chosen version starts from.
  // ---------------------------------------------------------------------

  it('seedLyricsDraft seeds the band text for the band version, personal version on screen or not', () => {
    expect(seedLyricsDraft('band', BAND_ENTRY, PERSONAL_ENTRY)).toBe('band words')
    expect(seedLyricsDraft('band', BAND_ENTRY, null)).toBe('band words')
    expect(seedLyricsDraft('band', { band_id: 'band-1', lyrics: null }, null)).toBe('')
    expect(seedLyricsDraft('band', null, null)).toBe('')
  })

  it('seedLyricsDraft seeds an existing personal version with itself', () => {
    expect(seedLyricsDraft('personal', BAND_ENTRY, PERSONAL_ENTRY)).toBe('my words')
  })

  it('seedLyricsDraft seeds a first personal version from the band text', () => {
    expect(seedLyricsDraft('personal', BAND_ENTRY, null)).toBe('band words')
    expect(seedLyricsDraft('personal', BAND_ENTRY, { band_id: null, lyrics: '' })).toBe('band words')
    expect(seedLyricsDraft('personal', BAND_ENTRY, { band_id: null, lyrics: '  \n ' })).toBe('band words')
  })

  it('resolveLyricsSaveTarget targets the entry itself outside a band', () => {
    expect(
      resolveLyricsSaveTarget({
        entryId: 'rep-1',
        entryBandId: null,
        personalRepertoireId: null,
        version: 'personal',
      }),
    ).toEqual({ repertoireId: 'rep-1', bandId: null, toPersonalEntry: false })
  })

  it('resolveLyricsSaveTarget targets the band entry on the band version', () => {
    expect(
      resolveLyricsSaveTarget({
        entryId: 'band-rep',
        entryBandId: 'band-1',
        personalRepertoireId: 'personal-rep',
        version: 'band',
      }),
    ).toEqual({ repertoireId: 'band-rep', bandId: 'band-1', toPersonalEntry: false })
  })

  it('resolveLyricsSaveTarget targets the personal entry with a null band id on the personal version', () => {
    expect(
      resolveLyricsSaveTarget({
        entryId: 'band-rep',
        entryBandId: 'band-1',
        personalRepertoireId: 'personal-rep',
        version: 'personal',
      }),
    ).toEqual({ repertoireId: 'personal-rep', bandId: null, toPersonalEntry: true })
  })

  it('resolveLyricsSaveTarget asks for a personal entry to be created when the member has none', () => {
    expect(
      resolveLyricsSaveTarget({
        entryId: 'band-rep',
        entryBandId: 'band-1',
        personalRepertoireId: null,
        version: 'personal',
      }),
    ).toEqual({ repertoireId: null, bandId: null, toPersonalEntry: true })
  })
})
