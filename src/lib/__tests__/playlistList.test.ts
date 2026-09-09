/**
 * RH-63 — the pure decisions lifted out of `src/app/playlists/page.tsx` when it
 * became a Server Component. Grouping, the local overlay of in-flight edits and
 * the two duration helpers used to live inside the 899-line client page, where
 * nothing could reach them; here they are plain functions with no React, no
 * network and no database, in the spirit of the Fast View precedent (AGENTS.md).
 */

import { describe, it, expect } from 'vitest'
import {
  applyPlaylistOverlay,
  buildPlaylistGroups,
  formatPlaylistDuration,
  playlistDurationSeconds,
} from '@/lib/playlistList'
import type { Playlist } from '@/types/database'

function playlist(overrides: Partial<Playlist> & { id: string }): Playlist {
  return {
    user_id: 'user-1',
    band_id: null,
    name: `Playlist ${overrides.id}`,
    description: null,
    cover_url: null,
    spotify_playlist_id: null,
    sync_with_spotify: false,
    last_synced_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    tags: [],
    ...overrides,
  } as Playlist
}

describe('buildPlaylistGroups', () => {
  it('groups personal playlists into a single personal group', () => {
    const groups = buildPlaylistGroups([
      playlist({ id: 'p1' }),
      playlist({ id: 'p2' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].type).toBe('personal')
    expect(groups[0].playlists.map(pl => pl.id)).toEqual(['p1', 'p2'])
  })

  it('groups band playlists under the band name, sorted alphabetically', () => {
    const groups = buildPlaylistGroups([
      playlist({ id: 'p1', band_id: 'b-z', band: { id: 'b-z', name: 'Zebras' } }),
      playlist({ id: 'p2', band_id: 'b-a', band: { id: 'b-a', name: 'Antelopes' } }),
      playlist({ id: 'p3', band_id: 'b-z', band: { id: 'b-z', name: 'Zebras' } }),
      playlist({ id: 'p0' }),
    ])

    expect(groups.map(g => g.type)).toEqual(['personal', 'band', 'band'])
    expect(groups[1].bandName).toBe('Antelopes')
    expect(groups[1].bandId).toBe('b-a')
    expect(groups[1].playlists.map(pl => pl.id)).toEqual(['p2'])
    expect(groups[2].bandName).toBe('Zebras')
    expect(groups[2].playlists.map(pl => pl.id)).toEqual(['p1', 'p3'])
  })

  it('falls back to the band id when the band row carries no name', () => {
    const groups = buildPlaylistGroups([
      playlist({ id: 'p1', band_id: 'band-42', band: null }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].type).toBe('band')
    expect(groups[0].bandName).toBe('band-42')
  })

  it('returns no group at all for an empty playlist list', () => {
    expect(buildPlaylistGroups([])).toEqual([])
  })
})

describe('applyPlaylistOverlay', () => {
  it('hides every playlist whose id is in the removed list', () => {
    const result = applyPlaylistOverlay(
      [playlist({ id: 'p1' }), playlist({ id: 'p2' }), playlist({ id: 'p3' })],
      { removedIds: ['p2'], renames: {} },
    )

    expect(result.map(pl => pl.id)).toEqual(['p1', 'p3'])
  })

  it('applies a rename to the matching playlist and leaves the others untouched', () => {
    const original = [
      playlist({ id: 'p1', name: 'Old name' }),
      playlist({ id: 'p2', name: 'Untouched' }),
    ]

    const result = applyPlaylistOverlay(original, {
      removedIds: [],
      renames: { p1: 'New name' },
    })

    expect(result[0].name).toBe('New name')
    expect(result[1].name).toBe('Untouched')
    expect(result[1]).toBe(original[1])
    expect(original[0].name).toBe('Old name')
  })

  it('returns an equal list when the overlay is empty', () => {
    const original = [playlist({ id: 'p1' }), playlist({ id: 'p2' })]

    expect(applyPlaylistOverlay(original, { removedIds: [], renames: {} })).toEqual(original)
  })
})

describe('formatPlaylistDuration', () => {
  it('formats a duration under an hour as minutes and seconds', () => {
    expect(formatPlaylistDuration(0)).toBe('0:00')
    expect(formatPlaylistDuration(65)).toBe('1:05')
    expect(formatPlaylistDuration(3599)).toBe('59:59')
  })

  it('formats a duration of an hour or more with an hours segment', () => {
    expect(formatPlaylistDuration(3600)).toBe('1:00:00')
    expect(formatPlaylistDuration(3725)).toBe('1:02:05')
  })
})

describe('playlistDurationSeconds', () => {
  it('sums the song durations of a playlist', () => {
    const withSongs = playlist({
      id: 'p1',
      songs: [
        { song: { duration_seconds: 100 } },
        { song: { duration_seconds: 65 } },
        { song: { duration_seconds: null } },
        {},
      ],
    } as unknown as Partial<Playlist> & { id: string })

    expect(playlistDurationSeconds(withSongs)).toBe(165)
  })

  it('returns zero seconds when the playlist carries no song array', () => {
    expect(playlistDurationSeconds(playlist({ id: 'p1' }))).toBe(0)
    expect(
      playlistDurationSeconds(
        playlist({ id: 'p2', songs: undefined } as Partial<Playlist> & { id: string }),
      ),
    ).toBe(0)
  })
})
