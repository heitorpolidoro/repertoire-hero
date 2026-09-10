/**
 * RH-68 — the pure decisions of the `/playlists/[id]` song list.
 *
 * Every function here used to be an inline `useMemo` body, an inline sort or an
 * inline `new Map(prev)` clone inside `PlaylistDetailPage`. They are decisions
 * about data, so they are exercised directly against hand-built fixtures — no
 * React, no DOM, no database. The file needs no `@vitest-environment` line:
 * `src/lib/playlistDetail.ts` touches no DOM API.
 */

import { describe, it, expect } from 'vitest'
import {
  collectPlaylistTags,
  cycleSongStatus,
  filterPlaylistSongs,
  sortPlaylistSongs,
  summarisePlaylistMastery,
  withRepertoireEntry,
} from '@/lib/playlistDetail'
import type { PlaylistSong, Repertoire, SongStatus } from '@/types/database'

function playlistSong(
  songId: string,
  overrides: {
    position?: number
    title?: string
    artist?: string
    duration?: number | null
  } = {},
): PlaylistSong {
  return {
    id: `ps-${songId}`,
    playlist_id: 'playlist-1',
    song_id: songId,
    position: overrides.position ?? 0,
    song: {
      id: songId,
      title: overrides.title ?? 'Kashmir',
      artist: overrides.artist ?? 'Led Zeppelin',
      album: 'Physical Graffiti',
      standard_key: null,
      cover_url: null,
      duration_seconds: overrides.duration === undefined ? null : overrides.duration,
      links: [],
      created_at: '2026-01-01T00:00:00.000Z',
    },
  }
}

function entry(songId: string, status: SongStatus, tags: string[] = []): Repertoire {
  return {
    id: `rep-${songId}`,
    user_id: 'user-1',
    band_id: null,
    song_id: songId,
    personal_key: null,
    status,
    tags,
    last_practiced: null,
    lyrics: null,
  }
}

function repertoireOf(...entries: Repertoire[]): Map<string, Repertoire> {
  return new Map(entries.map((rep) => [rep.song_id, rep]))
}

describe('collectPlaylistTags', () => {
  it('collects every tag of the playlist songs without repeating one', () => {
    const songs = [playlistSong('song-1'), playlistSong('song-2')]
    const repertoire = repertoireOf(
      entry('song-1', 'learning', ['encore', 'rock']),
      entry('song-2', 'mastered', ['rock', 'slow']),
    )

    expect(collectPlaylistTags(songs, repertoire)).toEqual(['encore', 'rock', 'slow'])
  })

  it('sorts the collected tags with localeCompare', () => {
    const songs = [playlistSong('song-1')]
    const repertoire = repertoireOf(entry('song-1', 'unknown', ['Zebra', 'apple', 'Banana']))

    // A plain `.sort()` would order these by code unit — `Banana`, `Zebra`, `apple`.
    expect(collectPlaylistTags(songs, repertoire)).toEqual(['apple', 'Banana', 'Zebra'])
  })

  it('collects nothing when no song has a repertoire entry', () => {
    const songs = [playlistSong('song-1'), playlistSong('song-2')]

    expect(collectPlaylistTags(songs, new Map())).toEqual([])
  })
})

describe('filterPlaylistSongs', () => {
  const songs = [
    playlistSong('song-1', { title: 'Kashmir', artist: 'Led Zeppelin' }),
    playlistSong('song-2', { title: 'Black Dog', artist: 'Led Zeppelin' }),
    playlistSong('song-3', { title: 'Roxanne', artist: 'The Police' }),
  ]
  const repertoire = repertoireOf(
    entry('song-1', 'learning', ['encore']),
    entry('song-2', 'mastered', ['encore', 'fast']),
    entry('song-3', 'unknown', ['fast']),
  )

  it('returns every song when neither a tag nor a query is set', () => {
    const result = filterPlaylistSongs(songs, repertoire, { tag: null, query: '' })

    expect(result.map((ps) => ps.song_id)).toEqual(['song-1', 'song-2', 'song-3'])
  })

  it('keeps only the songs carrying the active tag', () => {
    const result = filterPlaylistSongs(songs, repertoire, { tag: 'encore', query: '' })

    expect(result.map((ps) => ps.song_id)).toEqual(['song-1', 'song-2'])
  })

  it('matches the query against the song title, ignoring case', () => {
    const result = filterPlaylistSongs(songs, repertoire, { tag: null, query: 'ROXA' })

    expect(result.map((ps) => ps.song_id)).toEqual(['song-3'])
  })

  it('matches the query against the song artist, ignoring case', () => {
    const result = filterPlaylistSongs(songs, repertoire, { tag: null, query: 'led zep' })

    expect(result.map((ps) => ps.song_id)).toEqual(['song-1', 'song-2'])
  })

  it('treats a whitespace-only query as no query at all', () => {
    const result = filterPlaylistSongs(songs, repertoire, { tag: null, query: '   ' })

    expect(result.map((ps) => ps.song_id)).toEqual(['song-1', 'song-2', 'song-3'])
  })

  it('applies the tag filter and the text query together', () => {
    const result = filterPlaylistSongs(songs, repertoire, { tag: 'fast', query: 'police' })

    expect(result.map((ps) => ps.song_id)).toEqual(['song-3'])
  })
})

describe('sortPlaylistSongs', () => {
  it('orders the songs by position without mutating the input array', () => {
    const songs = [
      playlistSong('song-1', { position: 2 }),
      playlistSong('song-2', { position: 0 }),
      playlistSong('song-3', { position: 1 }),
    ]

    const sorted = sortPlaylistSongs(songs)

    expect(sorted.map((ps) => ps.song_id)).toEqual(['song-2', 'song-3', 'song-1'])
    expect(songs.map((ps) => ps.song_id)).toEqual(['song-1', 'song-2', 'song-3'])
    expect(sorted).not.toBe(songs)
  })
})

describe('summarisePlaylistMastery', () => {
  it('counts one song per status and reads a song with no repertoire entry as unknown', () => {
    const songs = [playlistSong('song-1'), playlistSong('song-2'), playlistSong('song-3')]
    const repertoire = repertoireOf(entry('song-1', 'polishing'), entry('song-2', 'polishing'))

    const summary = summarisePlaylistMastery(songs, repertoire)

    expect(summary.counts).toEqual({
      unknown: 1,
      learning: 0,
      practicing: 0,
      polishing: 2,
      mastered: 0,
    })
    expect(summary.total).toBe(3)
  })

  it('sums the duration of the songs that carry one and ignores the ones that do not', () => {
    const songs = [
      playlistSong('song-1', { duration: 200 }),
      playlistSong('song-2', { duration: null }),
      playlistSong('song-3', { duration: 415 }),
    ]

    expect(summarisePlaylistMastery(songs, new Map()).totalSeconds).toBe(615)
  })

  it('scores an all-mastered playlist at 100 and an all-unknown playlist at 0', () => {
    const songs = [playlistSong('song-1'), playlistSong('song-2')]

    const mastered = summarisePlaylistMastery(
      songs,
      repertoireOf(entry('song-1', 'mastered'), entry('song-2', 'mastered')),
    )
    expect(mastered.score).toBe(100)
    expect(mastered.scoreStatus).toBe('mastered')

    const unknown = summarisePlaylistMastery(songs, new Map())
    expect(unknown.score).toBe(0)
    expect(unknown.scoreStatus).toBe('unknown')
  })

  it('reports a total of zero for an empty playlist without dividing by zero', () => {
    const summary = summarisePlaylistMastery([], new Map())

    expect(summary.total).toBe(0)
    expect(summary.totalSeconds).toBe(0)
    expect(Number.isFinite(summary.score)).toBe(true)
    expect(summary.score).toBe(0)
    expect(summary.scoreStatus).toBe('unknown')
  })
})

describe('cycleSongStatus', () => {
  it('advances the song status one step and returns the original entry alongside the updated one', () => {
    const original = entry('song-1', 'learning', ['encore'])
    const cycle = cycleSongStatus(repertoireOf(original), 'song-1')

    expect(cycle).not.toBeNull()
    expect(cycle?.status).toBe('practicing')
    expect(cycle?.entry).toBe(original)
    expect(cycle?.entry.status).toBe('learning')
    expect(cycle?.updated).toEqual({ ...original, status: 'practicing' })
  })

  it('returns null when the song has no repertoire entry', () => {
    expect(cycleSongStatus(new Map(), 'song-1')).toBeNull()
  })
})

describe('withRepertoireEntry', () => {
  it('replaces one repertoire entry and leaves the other entries and the source map untouched', () => {
    const first = entry('song-1', 'learning')
    const second = entry('song-2', 'mastered')
    const source = repertoireOf(first, second)
    const replacement = { ...first, status: 'polishing' as SongStatus }

    const next = withRepertoireEntry(source, 'song-1', replacement)

    expect(next).not.toBe(source)
    expect(next.get('song-1')).toBe(replacement)
    expect(next.get('song-2')).toBe(second)
    expect(source.get('song-1')).toBe(first)
    expect(source.size).toBe(2)
  })
})
