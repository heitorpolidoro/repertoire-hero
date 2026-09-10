// @vitest-environment jsdom
/**
 * RH-68 — the mastery summary above the playlist song list.
 *
 * The component holds no decision beyond "hide me when the playlist is empty":
 * `summarisePlaylistMastery` counts, sums and scores, and this file checks that
 * what it returns reaches the score pill, the stacked bar (`aria-label="Status
 * distribution"`) and the legend. Plain props only — no Server Action, no
 * fetch, no `@/app/` import.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PlaylistSummary } from '@/components/playlists/PlaylistSummary'
import type { PlaylistSong, Repertoire, SongStatus } from '@/types/database'

afterEach(cleanup)

function playlistSong(songId: string, duration: number | null = null): PlaylistSong {
  return {
    id: `ps-${songId}`,
    playlist_id: 'playlist-1',
    song_id: songId,
    position: 0,
    song: {
      id: songId,
      title: 'Kashmir',
      artist: 'Led Zeppelin',
      album: 'Physical Graffiti',
      standard_key: null,
      cover_url: null,
      duration_seconds: duration,
      links: [],
      created_at: '2026-01-01T00:00:00.000Z',
    },
  }
}

function repertoireOf(statuses: Record<string, SongStatus>): Map<string, Repertoire> {
  return new Map(
    Object.entries(statuses).map(([songId, status]) => [
      songId,
      {
        id: `rep-${songId}`,
        user_id: 'user-1',
        band_id: null,
        song_id: songId,
        personal_key: null,
        status,
        tags: [],
        last_practiced: null,
        lyrics: null,
      },
    ]),
  )
}

/** The stacked bar, reached the way the component exposes it to assistive tech. */
function distributionBar(): HTMLElement {
  return screen.getByLabelText('Status distribution')
}

describe('PlaylistSummary', () => {
  it('renders nothing for an empty playlist', () => {
    const { container } = render(<PlaylistSummary songs={[]} repertoireMap={new Map()} />)

    expect(container.firstChild).toBeNull()
  })

  it('renders the playlist level with the total duration formatted', () => {
    render(
      <PlaylistSummary
        songs={[playlistSong('song-1', 200), playlistSong('song-2', 415)]}
        repertoireMap={new Map()}
      />,
    )

    expect(screen.getByText(/Playlist level/)).toBeDefined()
    expect(screen.getByText('10:15')).toBeDefined()
  })

  it('renders no duration when no song carries one', () => {
    render(<PlaylistSummary songs={[playlistSong('song-1')]} repertoireMap={new Map()} />)

    expect(screen.getByText(/Playlist level/)).toBeDefined()
    expect(screen.queryByText(/^\d+:\d\d$/)).toBeNull()
  })

  it('labels the score with the nearest status and its percentage', () => {
    const songs = [playlistSong('song-1'), playlistSong('song-2')]

    const { rerender } = render(
      <PlaylistSummary
        songs={songs}
        repertoireMap={repertoireOf({ 'song-1': 'mastered', 'song-2': 'mastered' })}
      />,
    )
    expect(screen.getByText('Mastered · 100%')).toBeDefined()

    rerender(
      <PlaylistSummary
        songs={songs}
        repertoireMap={repertoireOf({ 'song-1': 'learning', 'song-2': 'learning' })}
      />,
    )
    expect(screen.getByText('Learning · 25%')).toBeDefined()
  })

  it('renders one distribution segment per status present under the Status distribution label', () => {
    render(
      <PlaylistSummary
        songs={[playlistSong('song-1'), playlistSong('song-2'), playlistSong('song-3')]}
        repertoireMap={repertoireOf({ 'song-1': 'learning', 'song-2': 'mastered' })}
      />,
    )

    // unknown (the entry-less song), learning and mastered — three of the five.
    const segments = Array.from(distributionBar().children)
    expect(segments).toHaveLength(3)
    expect(segments.map((segment) => segment.getAttribute('title'))).toEqual([
      'Unknown: 1',
      'Learning: 1',
      'Mastered: 1',
    ])
  })

  it('renders one legend entry per status present and none for a status with no song', () => {
    render(
      <PlaylistSummary
        songs={[playlistSong('song-1'), playlistSong('song-2')]}
        repertoireMap={repertoireOf({ 'song-1': 'polishing', 'song-2': 'polishing' })}
      />,
    )

    expect(screen.getByText('Polishing (2)')).toBeDefined()
    expect(screen.queryByText(/^Learning \(/)).toBeNull()
    expect(screen.queryByText(/^Unknown \(/)).toBeNull()
  })
})
