import { describe, it, expect } from 'vitest'
import { EMPTY_MANUAL_DRAFT, draftTitle, manualEntryInput } from '@/lib/manualEntry'

describe('manualEntry (RH-152)', () => {
  it('follows the query until a title is typed', () => {
    expect(draftTitle(EMPTY_MANUAL_DRAFT, 'wonder')).toBe('wonder')
    expect(draftTitle({ ...EMPTY_MANUAL_DRAFT, title: '' }, 'wonder')).toBe('')
  })

  it('refuses a blank title or artist', () => {
    expect(manualEntryInput({ ...EMPTY_MANUAL_DRAFT, artist: 'Oasis' }, '  ')).toBeNull()
    expect(manualEntryInput(EMPTY_MANUAL_DRAFT, 'Wonderwall')).toBeNull()
  })

  it('builds a minimal payload leaving empty optional fields out', () => {
    expect(manualEntryInput({ ...EMPTY_MANUAL_DRAFT, artist: ' Oasis ' }, ' Wonderwall ')).toEqual({
      title: 'Wonderwall',
      artist: 'Oasis',
    })
  })

  it('carries album, key, cover, parsed duration and non-blank links', () => {
    const input = manualEntryInput(
      {
        ...EMPTY_MANUAL_DRAFT,
        title: 'Wonderwall',
        artist: 'Oasis',
        album: 'Morning Glory',
        key: 'F#m',
        cover: 'https://x/c.jpg',
        duration: '4:18',
        links: [
          { label: 'Chords', url: 'https://x/chords', id: 'a' },
          { label: '', url: '  ' },
        ],
      },
      'ignored',
    )
    expect(input).toEqual({
      title: 'Wonderwall',
      artist: 'Oasis',
      album: 'Morning Glory',
      standard_key: 'F#m',
      cover_url: 'https://x/c.jpg',
      duration_seconds: 258,
      links: [{ label: 'Chords', url: 'https://x/chords' }],
    })
  })
})
