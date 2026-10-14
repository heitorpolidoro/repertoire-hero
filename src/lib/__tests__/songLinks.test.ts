import { describe, it, expect } from 'vitest'
import { appendLink, groupLinksByProvider, isDuplicateLinkUrl, removeLinkByUrl, resolveLinkLabel } from '@/lib/songLinks'
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

  describe('groupLinksByProvider', () => {
    const mixed: SongLink[] = [
      { label: 'Chords', url: 'https://cifra.example/1', provider: 'other' },
      { label: 'YT A', url: 'https://youtube.com/watch?v=a', provider: 'youtube' },
      { label: 'Sp', url: 'https://open.spotify.com/track/1', provider: 'spotify' },
      { label: 'YT B', url: 'https://youtube.com/watch?v=b', provider: 'youtube' },
      { label: 'Drive', url: 'https://drive.example/2', provider: 'other' },
      { label: 'Bare', url: 'https://bare.example/3' },
      { label: 'YT C', url: 'https://youtube.com/watch?v=c', provider: 'youtube' },
    ]

    it('orders Spotify, YouTube, then other rows, keeping input order inside each', () => {
      const entries = groupLinksByProvider(mixed)

      expect(entries.map((e) => e.kind)).toEqual(['single', 'group', 'single', 'single', 'single'])
      expect(entries[0]).toMatchObject({ kind: 'single', link: { label: 'Sp' } })
      expect(entries[1]).toMatchObject({ kind: 'group', provider: 'youtube' })
      expect(entries[1].kind === 'group' && entries[1].links.map((l) => l.label)).toEqual(['YT A', 'YT B', 'YT C'])
      expect(entries.slice(2).map((e) => e.kind === 'single' && e.link.label)).toEqual(['Chords', 'Drive', 'Bare'])
    })

    it('turns a lone provider link into a single and returns nothing for no links', () => {
      expect(groupLinksByProvider([])).toEqual([])
      const one: SongLink = { label: 'YT', url: 'https://youtu.be/x', provider: 'youtube' }
      expect(groupLinksByProvider([one])).toEqual([{ kind: 'single', link: one }])
    })

    it('groups several Spotify links and never groups other links', () => {
      const sp = [1, 2].map((n) => ({ label: `S${n}`, url: `https://open.spotify.com/track/${n}`, provider: 'spotify' as const }))
      const oth = [1, 2].map((n) => ({ label: `O${n}`, url: `https://o.example/${n}`, provider: 'other' as const }))
      expect(groupLinksByProvider([...oth, ...sp]).map((e) => e.kind)).toEqual(['group', 'single', 'single'])
    })
  })
})
