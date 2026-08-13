import { describe, it, expect } from 'vitest'
import { sanitizeSongTitle, isSpecialSongVersion } from '../songSanitizer'

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
