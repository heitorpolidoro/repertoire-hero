/**
 * RH-23 — The Spotify playlist import/sync helpers, extracted verbatim out of
 * `api/spotify/playlists/[id]/import/route.ts` so import, sync and tracks all
 * share one copy. These tests pin the behaviour the routes relied on:
 * pagination, sanitized find-or-create, the 23505 swallow, and the positional
 * `playlist_songs` insert.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/db', () => ({ query: vi.fn() }))

import { query } from '@/lib/db'
import {
  fetchAllSpotifyTracks,
  findOrCreateGlobalSong,
  ensureInRepertoire,
  buildPlaylistSongsInsert,
} from '../spotifyPlaylistSync'
import type { SpotifyRawTrack } from '../spotifyPlaylistSync'

const mockedQuery = query as unknown as Mock

function trackItem(id: string, name: string, durationMs: number) {
  return {
    track: {
      id,
      name,
      duration_ms: durationMs,
      artists: [{ name: 'Artist A' }, { name: 'Artist B' }],
      album: { name: 'Album', images: [{ url: 'http://art' }] },
      external_urls: { spotify: `https://open.spotify.com/track/${id}` },
    },
  }
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body }
}

beforeEach(() => {
  mockedQuery.mockReset()
  vi.unstubAllGlobals()
})

describe('fetchAllSpotifyTracks', () => {
  it('follows page.next, skips null tracks and converts duration to whole seconds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [trackItem('t1', 'One', 185400), { track: null }],
          next: 'https://api.spotify.com/v1/next-page',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [trackItem('t2', 'Two', 0)], next: null }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const tracks = await fetchAllSpotifyTracks('playlist-1', 'token-1')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.spotify.com/v1/playlists/playlist-1/tracks?limit=100',
    )
    expect(fetchMock.mock.calls[0][1]).toEqual({
      headers: { Authorization: 'Bearer token-1' },
    })
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.spotify.com/v1/next-page')
    expect(tracks).toEqual([
      {
        spotifyTrackId: 't1',
        title: 'One',
        artist: 'Artist A, Artist B',
        album: 'Album',
        albumArt: 'http://art',
        spotifyUrl: 'https://open.spotify.com/track/t1',
        durationSeconds: 185,
      },
      {
        spotifyTrackId: 't2',
        title: 'Two',
        artist: 'Artist A, Artist B',
        album: 'Album',
        albumArt: 'http://art',
        spotifyUrl: 'https://open.spotify.com/track/t2',
        durationSeconds: null,
      },
    ])
  })

  it('throws when a page request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 429)))

    await expect(fetchAllSpotifyTracks('playlist-1', 'token-1')).rejects.toThrow(
      'Spotify tracks fetch failed: 429',
    )
  })
})

const rawTrack: SpotifyRawTrack = {
  spotifyTrackId: 't1',
  title: 'Song Name - 2018 Remaster',
  artist: ' Artist A ',
  album: 'Album (Deluxe Edition)',
  albumArt: 'http://art',
  spotifyUrl: 'https://open.spotify.com/track/t1',
  durationSeconds: 185,
}

describe('findOrCreateGlobalSong', () => {
  it('returns the existing id and appends the Spotify link when it is absent', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'song-1', links: [{ label: 'Chords', url: 'http://chords' }] }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    const songId = await findOrCreateGlobalSong(rawTrack)

    expect(songId).toBe('song-1')
    expect(mockedQuery).toHaveBeenCalledTimes(2)
    const [updateSql, updateValues] = mockedQuery.mock.calls[1]
    expect(updateSql).toBe('UPDATE global_songs SET links = $1 WHERE id = $2')
    expect(JSON.parse(updateValues[0] as string)).toEqual([
      { label: 'Chords', url: 'http://chords' },
      { label: 'Song Name - 2018 Remaster', url: 'https://open.spotify.com/track/t1' },
    ])
    expect(updateValues[1]).toBe('song-1')
  })

  it('does not touch the links when the Spotify url is already there', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { id: 'song-1', links: [{ label: 'x', url: 'https://open.spotify.com/track/t1' }] },
      ],
      rowCount: 1,
    })

    expect(await findOrCreateGlobalSong(rawTrack)).toBe('song-1')
    expect(mockedQuery).toHaveBeenCalledTimes(1)
  })

  it('inserts the sanitized title and trimmed artist for a new song', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'song-new' }], rowCount: 1 })

    expect(await findOrCreateGlobalSong(rawTrack)).toBe('song-new')

    const [lookupSql, lookupValues] = mockedQuery.mock.calls[0]
    expect(lookupSql).toContain('SELECT id, links FROM global_songs')
    expect(lookupValues).toEqual(['Song Name', 'Artist A'])

    const [insertSql, insertValues] = mockedQuery.mock.calls[1]
    expect(insertSql).toContain('INSERT INTO global_songs')
    expect(insertValues[0]).toBe('Song Name')
    expect(insertValues[1]).toBe('Artist A')
    expect(insertValues[2]).toBe('Album')
    expect(insertValues[3]).toBe('http://art')
    expect(insertValues[4]).toBe(185)
    expect(JSON.parse(insertValues[5] as string)).toEqual([
      { label: 'Song Name - 2018 Remaster', url: 'https://open.spotify.com/track/t1' },
    ])
  })
})

describe('ensureInRepertoire', () => {
  it('inserts the band row and one row per band member', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // band repertoire lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // band repertoire insert
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1' }, { user_id: 'u2' }], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // u1 lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // u1 insert
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // u2 lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // u2 insert

    await ensureInRepertoire('song-1', { bandId: 'band-1' })

    const inserts = mockedQuery.mock.calls.filter(([sql]) =>
      String(sql).startsWith('INSERT INTO repertoire (user_id'),
    )
    expect(inserts.map(([, values]) => values)).toEqual([
      ['u1', 'song-1'],
      ['u2', 'song-1'],
    ])
  })

  it('inserts a single personal row for a user owner', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    await ensureInRepertoire('song-1', { userId: 'u1' })

    expect(mockedQuery).toHaveBeenCalledTimes(2)
    expect(mockedQuery.mock.calls[1][1]).toEqual(['u1', 'song-1'])
  })

  it('swallows a 23505 unique violation but re-throws any other Postgres code', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }))

    await expect(ensureInRepertoire('song-1', { userId: 'u1' })).resolves.toBeUndefined()

    mockedQuery.mockReset()
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockRejectedValueOnce(Object.assign(new Error('fk'), { code: '23503' }))

    await expect(ensureInRepertoire('song-1', { userId: 'u1' })).rejects.toThrow('fk')
  })

  it('does nothing when the owner carries neither a band nor a user', async () => {
    await ensureInRepertoire('song-1', {})
    expect(mockedQuery).not.toHaveBeenCalled()
  })
})

describe('buildPlaylistSongsInsert', () => {
  it('numbers placeholders in threes and assigns positions 1..n', () => {
    const { sql, values } = buildPlaylistSongsInsert('pl-1', ['s1', 's2'])

    expect(sql).toContain('INSERT INTO playlist_songs (playlist_id, song_id, position)')
    expect(sql).toContain('($1, $2, $3), ($4, $5, $6)')
    expect(values).toEqual(['pl-1', 's1', 1, 'pl-1', 's2', 2])
  })
})
