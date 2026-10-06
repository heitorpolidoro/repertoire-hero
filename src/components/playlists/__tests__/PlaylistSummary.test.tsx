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

/** Keyed by the **version** it names (RH-125); the song id is derived. */
function playlistSong(versionId: string, duration: number | null = null): PlaylistSong {
  return {
    id: `ps-${versionId}`,
    playlist_id: 'playlist-1',
    version_id: versionId,
    position: 0,
    song: {
      id: `song-of-${versionId}`,
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

/** Keyed by `version_id`, which is what `summarisePlaylistMastery` reads. */
function repertoireOf(statuses: Record<string, SongStatus>): Map<string, Repertoire> {
  return new Map(
    Object.entries(statuses).map(([versionId, status]) => [
      versionId,
      {
        id: `rep-${versionId}`,
        user_id: 'user-1',
        band_id: null,
        song_id: `song-of-${versionId}`,
        version_id: versionId,
        key: null,
        tuning: null,
        map: null,
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

  // RH-102: `unknown` is not a stage, so it draws no segment. The unassessed
  // share of the playlist is the part of the grey track no segment covers.
  it('renders one segment per stage present, and none for the unassessed share', () => {
    render(
      <PlaylistSummary
        songs={[playlistSong('song-1'), playlistSong('song-2'), playlistSong('song-3')]}
        repertoireMap={repertoireOf({ 'song-1': 'learning', 'song-2': 'mastered' })}
      />,
    )

    const segments = Array.from(distributionBar().children) as HTMLElement[]
    expect(segments).toHaveLength(2)
    expect(segments.map((segment) => segment.getAttribute('title'))).toEqual([
      'Learning: 1',
      'Mastered: 1',
    ])
  })

  it('leaves three quarters of the grey track uncovered for 1 mastered of 4 songs', () => {
    render(
      <PlaylistSummary
        songs={[1, 2, 3, 4].map((n) => playlistSong(`song-${n}`))}
        repertoireMap={repertoireOf({ 'song-1': 'mastered' })}
      />,
    )

    const track = distributionBar()
    const segments = Array.from(track.children) as HTMLElement[]
    expect(segments).toHaveLength(1)
    expect(segments[0].style.width).toBe('25%')
    expect(segments[0].getAttribute('title')).toBe('Mastered: 1')
    // The remaining 75% is the track itself, which is grey and carries no
    // per-status colour of its own.
    expect(track.className).toContain('bg-gray-200')
  })

  it('renders one legend entry per stage present and none for a stage with no song', () => {
    render(
      <PlaylistSummary
        songs={[playlistSong('song-1'), playlistSong('song-2')]}
        repertoireMap={repertoireOf({ 'song-1': 'polishing', 'song-2': 'polishing' })}
      />,
    )

    expect(screen.getByText('Polishing (2)')).toBeDefined()
    expect(screen.queryByText(/^Learning \(/)).toBeNull()
    expect(screen.queryByText(/^Unknown \(/)).toBeNull()
    expect(screen.queryByText(/unassessed/)).toBeNull()
  })

  it('ends the legend with a swatch-less unassessed entry when any song has no stage', () => {
    render(
      <PlaylistSummary
        songs={[1, 2, 3, 4].map((n) => playlistSong(`song-${n}`))}
        repertoireMap={repertoireOf({ 'song-1': 'mastered' })}
      />,
    )

    const entries = Array.from(
      screen.getByLabelText('Status distribution legend').children,
    ) as HTMLElement[]
    expect(entries.map((entry) => entry.textContent)).toEqual(['Mastered (1)', '3 unassessed'])

    const unassessed = entries[entries.length - 1]
    expect(unassessed.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(unassessed.innerHTML).toBe('3 unassessed')
  })
})
