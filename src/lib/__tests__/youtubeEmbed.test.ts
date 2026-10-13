import { describe, it, expect } from 'vitest'
import { youtubeVideoId, youtubeEmbedUrl, pickYoutubeVideoId } from '../youtubeEmbed'

describe('youtubeVideoId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?list=PL1&v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ?feature=share', 'dQw4w9WgXcQ'],
  ])('extracts the id from %s', (url, id) => {
    expect(youtubeVideoId(url)).toBe(id)
  })

  it.each([
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/@channel',
    'https://www.youtube.com/channel/UC123',
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/watch?v=bad id!',
    'https://youtu.be/',
    'not a url',
    '',
  ])('returns null for %s', (url) => {
    expect(youtubeVideoId(url)).toBeNull()
  })
})

describe('youtubeEmbedUrl', () => {
  it('builds a nocookie embed url with no autoplay', () => {
    const url = youtubeEmbedUrl('dQw4w9WgXcQ')
    expect(url).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(url).not.toContain('autoplay')
  })
})

describe('pickYoutubeVideoId', () => {
  it('uses the first youtube-provider link, ignoring other providers', () => {
    const id = pickYoutubeVideoId([
      { label: 'a', url: 'https://youtube.com/watch?v=aaaaaaaaaaa', provider: 'other' },
      { label: 'b', url: 'https://open.spotify.com/track/1', provider: 'spotify' },
      { label: 'c', url: 'https://youtu.be/ccccccccccc', provider: 'youtube' },
    ])
    expect(id).toBe('ccccccccccc')
  })

  it('does not fall through to a later link when the first youtube link is unusable', () => {
    expect(
      pickYoutubeVideoId([
        { label: 'c', url: 'https://www.youtube.com/@chan', provider: 'youtube' },
        { label: 'd', url: 'https://youtu.be/ddddddddddd', provider: 'youtube' },
      ]),
    ).toBeNull()
  })

  it('returns null with no links', () => {
    expect(pickYoutubeVideoId([])).toBeNull()
  })
})
