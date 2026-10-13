import { describe, it, expect } from 'vitest'
import { isSongRecordId, songRecordId } from '@/lib/offlineSongRecord'

const UUID = '0b6f1c1e-5c1a-4a52-9d57-6f3b1f0a7c11'

describe('songRecordId', () => {
  it('is deterministic for one version and context', () => {
    expect(songRecordId('v-1', null)).toBe(songRecordId('v-1', null))
    expect(songRecordId('v-1', 'band-1')).toBe(songRecordId('v-1', 'band-1'))
  })

  it('separates the personal copy from a band-context copy of one version', () => {
    expect(songRecordId('v-1', null)).not.toBe(songRecordId('v-1', 'band-1'))
    expect(songRecordId('v-1', 'band-1')).not.toBe(songRecordId('v-1', 'band-2'))
  })

  it('never equals or prefixes a playlist record cache prefix (ER5)', () => {
    const playlistIds = [UUID, 'pl-1', 'v-1', 'song', 'band-1']
    const songIds = [songRecordId('v-1', null), songRecordId('v-1', 'band-1'), songRecordId(UUID, UUID)]
    for (const song of songIds) {
      const songPrefix = `/__offline-tab/${song}/`
      for (const playlist of playlistIds) {
        const playlistPrefix = `/__offline-tab/${playlist}/`
        expect(song).not.toBe(playlist)
        expect(songPrefix.startsWith(playlistPrefix)).toBe(false)
        expect(playlistPrefix.startsWith(songPrefix)).toBe(false)
      }
    }
  })

  it('does not let one song prefix collide with another song record', () => {
    const a = `/__offline-tab/${songRecordId('v-1', null)}/`
    const b = `/__offline-tab/${songRecordId('v-1', 'band-1')}/`
    expect(b.startsWith(a)).toBe(false)
    expect(a.startsWith(b)).toBe(false)
  })
})

describe('isSongRecordId', () => {
  it('recognises song record ids and rejects playlist ids', () => {
    expect(isSongRecordId(songRecordId('v-1', null))).toBe(true)
    expect(isSongRecordId(songRecordId('v-1', 'band-1'))).toBe(true)
    expect(isSongRecordId(UUID)).toBe(false)
    expect(isSongRecordId('pl-1')).toBe(false)
  })
})
