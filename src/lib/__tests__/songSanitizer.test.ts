import { describe, it, expect } from 'vitest'
import { sanitizeSongTitle, isSpecialSongVersion, sanitizeAlbumName } from '../songSanitizer'

describe('songSanitizer', () => {
  it('strips year remasters', () => {
    expect(sanitizeSongTitle('Still Of The Night - 2018 Remaster')).toBe('Still Of The Night')
    expect(sanitizeSongTitle('Still Of The Night - 2017 Remaster')).toBe('Still Of The Night')
    expect(sanitizeSongTitle('Hotel California - 2013 Remaster')).toBe('Hotel California')
    expect(sanitizeSongTitle('Sweet Child O\' Mine (2022 Remastered)')).toBe('Sweet Child O\' Mine')
    expect(sanitizeSongTitle('Ain\'t Talkin\' \'Bout Love - 2015 Remaster')).toBe('Ain\'t Talkin\' \'Bout Love')
  })

  it('strips deluxe and anniversary edition suffixes', () => {
    expect(sanitizeSongTitle('Still Of The Night (30th Anniversary Super Deluxe Edition)')).toBe('Still Of The Night')
    expect(sanitizeSongTitle('Back in Black (Deluxe Edition)')).toBe('Back in Black')
    expect(sanitizeSongTitle('Smells Like Teen Spirit - 20th Anniversary Edition')).toBe('Smells Like Teen Spirit')
  })

  it('preserves Live and Acoustic versions', () => {
    expect(sanitizeSongTitle('Still Of The Night - Live at Donington 1990')).toBe('Still Of The Night - Live at Donington 1990')
    expect(sanitizeSongTitle('Layla - Acoustic / Live')).toBe('Layla - Acoustic / Live')
    expect(isSpecialSongVersion('Still Of The Night - Live at Donington 1990')).toBe(true)
    expect(isSpecialSongVersion('Still Of The Night')).toBe(false)
  })
})

describe('songSanitizer edge cases', () => {
  it.each([
    ['a parenthesized remaster that is also a live take', 'Still Of The Night (Live 2018 Remaster)'],
    ['a bracketed deluxe edition of an acoustic take', 'Layla [Acoustic Deluxe Edition]'],
    ['a dash-separated remaster of a live take', 'Hotel California - Live 2013 Remaster'],
    ['a dash-separated anniversary edition of an unplugged take', 'The Man Who Sold The World - Unplugged 25th Anniversary'],
  ])('keeps %s untouched', (_label, title) => {
    expect(sanitizeSongTitle(title)).toBe(title)
  })

  it.each([
    ['an empty title', '', ''],
    ['a whitespace-only title', '   ', ''],
  ])('returns an empty string for %s', (_label, input, expected) => {
    expect(sanitizeSongTitle(input)).toBe(expected)
  })

  it('falls back to the original when stripping the noise would empty the title', () => {
    expect(sanitizeSongTitle('(2018 Remaster)')).toBe('(2018 Remaster)')
  })

  it('collapses the whitespace and dangling separators left behind', () => {
    expect(sanitizeSongTitle('  Black  Dog   (2007 Remaster)  ')).toBe('Black Dog')
  })

  it('treats an empty title as not a special version', () => {
    expect(isSpecialSongVersion('')).toBe(false)
  })

  it.each([
    ['a radio edit', 'Song - Radio Edit'],
    ['an extended mix', 'Song (Extended Mix)'],
  ])('recognises %s as a special version', (_label, title) => {
    expect(isSpecialSongVersion(title)).toBe(true)
  })
})

describe('sanitizeAlbumName', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['a whitespace-only name', '   '],
  ])('returns null for %s', (_label, album) => {
    expect(sanitizeAlbumName(album)).toBeNull()
  })

  it('strips edition noise from a real album name', () => {
    expect(sanitizeAlbumName('Nevermind (30th Anniversary Super Deluxe Edition)')).toBe('Nevermind')
    expect(sanitizeAlbumName('Back in Black - 2003 Remaster')).toBe('Back in Black')
  })

  it('preserves a live album name', () => {
    expect(sanitizeAlbumName('Unplugged in New York')).toBe('Unplugged in New York')
  })
})
