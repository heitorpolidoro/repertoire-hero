// @vitest-environment jsdom
/** RH-164 — the Fast View Spotify player: states, and no playback until a tap. */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { SongLink } from '@/types/database'
import { PLAYBACK_SCOPES, type PlaybackFacts } from '@/lib/spotifyPlayback'
import { SpotifyPlayer } from '../SpotifyPlayer'

afterEach(cleanup)

const TRACK: SongLink[] = [{ label: 'Spotify', url: 'https://open.spotify.com/track/abc123?si=x' }]
const OK: PlaybackFacts = { connected: true, scope: PLAYBACK_SCOPES.join(' '), premium: true }

function setup(links: SongLink[], facts: PlaybackFacts, offline = false) {
  const loadFacts = vi.fn().mockResolvedValue(facts)
  const play = vi.fn().mockResolvedValue(undefined)
  render(<SpotifyPlayer links={links} offline={offline} loadFacts={loadFacts} play={play} />)
  return { loadFacts, play }
}

describe('SpotifyPlayer', () => {
  it('renders a player for a track link and does not play on mount', async () => {
    const { play } = setup(TRACK, OK)
    const button = await screen.findByRole('button', { name: /play/i })
    expect(play).not.toHaveBeenCalled()
    fireEvent.click(button)
    await waitFor(() => expect(play).toHaveBeenCalledWith('spotify:track:abc123'))
  })

  it.each(['https://spotify.link/abc', 'https://spoti.fi/abc'])('renders nothing for the short link %s', (url) => {
    const { loadFacts } = setup([{ label: 'S', url }], OK)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(/spotify/i)).toBeNull()
    expect(loadFacts).not.toHaveBeenCalled()
  })

  it('shows a reconnect prompt linking to the authorize route when scopes are missing', async () => {
    setup(TRACK, { connected: true, scope: 'user-read-private', premium: true })
    const link = await screen.findByRole('link', { name: /re-connect spotify \(new permissions\)/i })
    expect(link.getAttribute('href')).toBe('/api/auth/spotify/authorize')
    expect(screen.queryByRole('button', { name: /play/i })).toBeNull()
  })

  it('shows the Premium message and no controls for a free account', async () => {
    setup(TRACK, { ...OK, premium: false })
    expect(await screen.findByText('Spotify Premium is required to play here')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows the offline message instead of a player', async () => {
    setup(TRACK, OK, true)
    expect(await screen.findByText('No connection: playback unavailable')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /play/i })).toBeNull()
  })

  it('surfaces a playback failure', async () => {
    const loadFacts = vi.fn().mockResolvedValue(OK)
    const play = vi.fn().mockRejectedValue(new Error('boom'))
    render(<SpotifyPlayer links={TRACK} offline={false} loadFacts={loadFacts} play={play} />)
    fireEvent.click(await screen.findByRole('button', { name: /play/i }))
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('treats a failed facts load as a reconnect prompt', async () => {
    const loadFacts = vi.fn().mockRejectedValue(new Error('x'))
    render(<SpotifyPlayer links={TRACK} offline={false} loadFacts={loadFacts} play={vi.fn()} />)
    expect(await screen.findByRole('link', { name: /re-connect/i })).toBeTruthy()
  })
})
