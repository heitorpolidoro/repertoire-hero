// @vitest-environment jsdom
/** RH-163 ER1/ER2/ER3/ER5 — the Fast View YouTube embed. */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { SongLink } from '@/types/database'
import { YoutubeEmbed } from '../YoutubeEmbed'

afterEach(cleanup)

const YT: SongLink = { label: 'Video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', provider: 'youtube' }
const SP: SongLink = { label: 'Spotify', url: 'https://open.spotify.com/track/1', provider: 'spotify' }

describe('YoutubeEmbed online', () => {
  it('renders one titled iframe on the nocookie embed origin with no autoplay', () => {
    const { container } = render(<YoutubeEmbed song={{ links: [SP, YT] }} offline={false} />)
    const frames = container.querySelectorAll('iframe')
    expect(frames).toHaveLength(1)
    const f = frames[0]
    expect(f.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(f.getAttribute('src')).not.toContain('autoplay')
    expect(f.getAttribute('title')).toBeTruthy()
    expect(f.getAttribute('loading')).toBe('lazy')
    expect(f.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin')
    expect(f.getAttribute('allow')).toBe('encrypted-media; picture-in-picture')
    expect(f.hasAttribute('allowfullscreen')).toBe(true)
  })

  it('renders nothing for a spotify-only song', () => {
    const { container } = render(<YoutubeEmbed song={{ links: [SP] }} offline={false} />)
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing for an unparseable youtube link', () => {
    const bad: SongLink = { label: 'c', url: 'https://www.youtube.com/@chan', provider: 'youtube' }
    const { container } = render(<YoutubeEmbed song={{ links: [bad] }} offline={false} />)
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing with no links', () => {
    const { container } = render(<YoutubeEmbed song={{ links: [] }} offline={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing before the song has loaded', () => {
    const { container } = render(<YoutubeEmbed song={null} offline={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing for a song with no links field', () => {
    const { container } = render(<YoutubeEmbed song={{}} offline={false} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('YoutubeEmbed offline', () => {
  it('renders the offline note and no iframe', () => {
    const { container } = render(<YoutubeEmbed song={{ links: [YT] }} offline />)
    expect(screen.getByText('Video is not available offline')).toBeTruthy()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('renders nothing offline when there is no usable link', () => {
    const { container } = render(<YoutubeEmbed song={{ links: [SP] }} offline />)
    expect(container.innerHTML).toBe('')
  })
})
