import { describe, it, expect } from 'vitest'
import { appendLink, isDuplicateLinkUrl, removeLinkByUrl, resolveLinkLabel } from '@/lib/songLinks'
import type { SongLink } from '@/types/database'

const LINKS: SongLink[] = [
  { label: 'Chords', url: 'https://cifraclub.com.br/black-dog' },
  { label: 'Video', url: 'https://youtube.com/watch?v=1' },
]

describe('songLinks', () => {
  it('isDuplicateLinkUrl is false for a url that is not in the list', () => {
    expect(isDuplicateLinkUrl(LINKS, 'https://open.spotify.com/track/1')).toBe(false)
    expect(isDuplicateLinkUrl([], 'https://youtube.com/watch?v=1')).toBe(false)
  })

  it('isDuplicateLinkUrl is true for a url already in the list', () => {
    expect(isDuplicateLinkUrl(LINKS, 'https://youtube.com/watch?v=1')).toBe(true)
  })

  it('isDuplicateLinkUrl ignores surrounding whitespace on the candidate url', () => {
    expect(isDuplicateLinkUrl(LINKS, '  https://youtube.com/watch?v=1  ')).toBe(true)
  })

  it('resolveLinkLabel keeps the label the musician typed', () => {
    expect(resolveLinkLabel('My tab', 'Fetched title', 'https://example.com')).toBe('My tab')
  })

  it('resolveLinkLabel uses the fetched title when the typed label is blank', () => {
    expect(resolveLinkLabel('', 'Fetched title', 'https://example.com')).toBe('Fetched title')
  })

  it('resolveLinkLabel falls back to the url when both the label and the fetched title are blank', () => {
    expect(resolveLinkLabel('', '', 'https://example.com')).toBe('https://example.com')
  })

  it('appendLink adds the link at the end without mutating the input list', () => {
    const link: SongLink = { label: 'Track', url: 'https://open.spotify.com/track/1' }
    const appended = appendLink(LINKS, link)

    expect(appended).toEqual([...LINKS, link])
    expect(appended).not.toBe(LINKS)
    expect(LINKS).toHaveLength(2)
  })

  it('removeLinkByUrl drops every link with that url and keeps the others', () => {
    const withDuplicate = [...LINKS, { label: 'Same video', url: 'https://youtube.com/watch?v=1' }]

    expect(removeLinkByUrl(withDuplicate, 'https://youtube.com/watch?v=1')).toEqual([LINKS[0]])
    expect(removeLinkByUrl(LINKS, 'https://example.com/nothing')).toEqual(LINKS)
    expect(LINKS).toHaveLength(2)
  })
})
