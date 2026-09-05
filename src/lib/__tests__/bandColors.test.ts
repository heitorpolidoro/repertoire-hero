import { describe, it, expect } from 'vitest'
import {
  BAND_COLOR_PRESETS,
  DEFAULT_BAND_COLOR,
  getContrastTextColor,
  getBandThemeStyles,
} from '../bandColors'

const WHITE = '#ffffff'
const DARK = '#0f172a'

describe('getContrastTextColor', () => {
  // Perceived brightness is (r*299 + g*587 + b*114) / 1000, so for a neutral
  // grey #xxxxxx the brightness is exactly the byte value: 0x8c = 140 sits on
  // the `> 140` boundary and 0x8d = 141 is the first value past it.
  it.each([
    ['a null colour', null, WHITE],
    ['an undefined colour', undefined, WHITE],
    ['an empty string', '', WHITE],
    ['a 6-digit dark hex', '#18181b', WHITE],
    ['a 6-digit light hex', '#fef08a', DARK],
    ['a 3-digit dark hex', '#123', WHITE],
    ['a 3-digit light hex', '#ffe', DARK],
    ['a hex without the leading #', '18181b', WHITE],
    ['a malformed 4-char hex', '#12345', WHITE],
    ['a colour name instead of a hex', 'rebeccapurple', WHITE],
    ['exactly the brightness boundary (140)', '#8c8c8c', WHITE],
    ['one step past the brightness boundary (141)', '#8d8d8d', DARK],
  ])('returns the legible text colour for %s', (_label, input, expected) => {
    expect(getContrastTextColor(input)).toBe(expected)
  })
})

describe('getBandThemeStyles', () => {
  it.each([
    ['a non-# string', 'not-a-hex'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('falls back to DEFAULT_BAND_COLOR for %s', (_label, input) => {
    const theme = getBandThemeStyles(input)
    expect(theme.bgHex).toBe(DEFAULT_BAND_COLOR)
    expect(theme.style.backgroundColor).toBe(DEFAULT_BAND_COLOR)
  })

  it('keeps a valid hex and derives white text plus translucent-white chrome on a dark background', () => {
    const theme = getBandThemeStyles('#18181b')

    expect(theme.bgHex).toBe('#18181b')
    expect(theme.textColor).toBe(WHITE)
    expect(theme.isDarkText).toBe(false)
    expect(theme.style).toEqual({ backgroundColor: '#18181b', color: WHITE })
    expect(theme.borderStyle.borderColor).toBe('rgba(255, 255, 255, 0.2)')
    expect(theme.badgeStyle).toEqual({
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
      color: WHITE,
    })
  })

  it('derives dark text plus translucent-slate chrome on a light background', () => {
    const theme = getBandThemeStyles('#fef08a')

    expect(theme.textColor).toBe(DARK)
    expect(theme.isDarkText).toBe(true)
    expect(theme.borderStyle.borderColor).toBe('rgba(15, 23, 42, 0.2)')
    expect(theme.badgeStyle).toEqual({
      backgroundColor: 'rgba(15, 23, 42, 0.15)',
      color: DARK,
    })
  })

  it('builds the light-card badge from alpha suffixes on the background hex', () => {
    const theme = getBandThemeStyles('#1d4ed8')

    expect(theme.lightCardBadgeStyle).toEqual({
      backgroundColor: '#1d4ed818',
      color: '#1d4ed8',
      borderColor: '#1d4ed835',
    })
  })

  it('produces a legible theme for every shipped preset', () => {
    expect(BAND_COLOR_PRESETS.length).toBeGreaterThan(0)

    for (const preset of BAND_COLOR_PRESETS) {
      const theme = getBandThemeStyles(preset.hex)
      expect(theme.bgHex).toBe(preset.hex)
      expect([WHITE, DARK]).toContain(theme.textColor)
    }
  })
})
