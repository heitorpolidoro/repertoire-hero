import { describe, it, expect } from 'vitest'
import {
  clampLyricsFontSize,
  hasDifferentPersonalLyrics,
  resolveLyricsSaveTarget,
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

  it('hasDifferentPersonalLyrics is false outside a band', () => {
    expect(hasDifferentPersonalLyrics(SOLO_ENTRY, PERSONAL_ENTRY)).toBe(false)
    // A null entry (the route has not loaded yet) is the same "no badge" case.
    expect(hasDifferentPersonalLyrics(null, PERSONAL_ENTRY)).toBe(false)
  })

  it('hasDifferentPersonalLyrics is false when there is no personal entry', () => {
    expect(hasDifferentPersonalLyrics(BAND_ENTRY, null)).toBe(false)
  })

  it('hasDifferentPersonalLyrics is false when the personal lyrics are empty', () => {
    expect(hasDifferentPersonalLyrics(BAND_ENTRY, { band_id: null, lyrics: '' })).toBe(false)
    expect(hasDifferentPersonalLyrics(BAND_ENTRY, { band_id: null, lyrics: null })).toBe(false)
  })

  it('hasDifferentPersonalLyrics is false when the personal lyrics match the band ones', () => {
    expect(hasDifferentPersonalLyrics(BAND_ENTRY, { band_id: null, lyrics: 'band words' })).toBe(false)
  })

  it('hasDifferentPersonalLyrics is true when a band member has their own different version', () => {
    expect(hasDifferentPersonalLyrics(BAND_ENTRY, PERSONAL_ENTRY)).toBe(true)
  })

  it('selectDisplayedLyrics shows the entry lyrics outside a band', () => {
    expect(selectDisplayedLyrics(SOLO_ENTRY, PERSONAL_ENTRY, true)).toBe('my only words')
    expect(selectDisplayedLyrics(SOLO_ENTRY, PERSONAL_ENTRY, false)).toBe('my only words')
    expect(selectDisplayedLyrics(null, PERSONAL_ENTRY, false)).toBeNull()
  })

  it('selectDisplayedLyrics shows the band lyrics while the band version is selected', () => {
    expect(selectDisplayedLyrics(BAND_ENTRY, PERSONAL_ENTRY, false)).toBe('band words')
  })

  it('selectDisplayedLyrics shows the personal lyrics while the personal version is selected', () => {
    expect(selectDisplayedLyrics(BAND_ENTRY, PERSONAL_ENTRY, true)).toBe('my words')
  })

  it('selectDisplayedLyrics falls back to the band lyrics when no personal entry has loaded', () => {
    expect(selectDisplayedLyrics(BAND_ENTRY, null, true)).toBe('band words')
  })

  it('resolveLyricsSaveTarget targets the entry itself outside a band', () => {
    expect(
      resolveLyricsSaveTarget({
        entryId: 'rep-1',
        entryBandId: null,
        personalRepertoireId: null,
        showPersonalLyrics: true,
      }),
    ).toEqual({ repertoireId: 'rep-1', bandId: null, toPersonalEntry: false })
  })

  it('resolveLyricsSaveTarget targets the band entry while the band version is selected', () => {
    expect(
      resolveLyricsSaveTarget({
        entryId: 'band-rep',
        entryBandId: 'band-1',
        personalRepertoireId: 'personal-rep',
        showPersonalLyrics: false,
      }),
    ).toEqual({ repertoireId: 'band-rep', bandId: 'band-1', toPersonalEntry: false })
  })

  it('resolveLyricsSaveTarget targets the personal entry with a null band id while the personal version is selected', () => {
    expect(
      resolveLyricsSaveTarget({
        entryId: 'band-rep',
        entryBandId: 'band-1',
        personalRepertoireId: 'personal-rep',
        showPersonalLyrics: true,
      }),
    ).toEqual({ repertoireId: 'personal-rep', bandId: null, toPersonalEntry: true })
  })

  it('resolveLyricsSaveTarget asks for a personal entry to be created when the member has none', () => {
    expect(
      resolveLyricsSaveTarget({
        entryId: 'band-rep',
        entryBandId: 'band-1',
        personalRepertoireId: null,
        showPersonalLyrics: true,
      }),
    ).toEqual({ repertoireId: null, bandId: null, toPersonalEntry: true })
  })
})
