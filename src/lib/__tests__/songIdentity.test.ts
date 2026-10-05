/**
 * RH-95 — the one song-identity rule, with `pg` mocked.
 *
 * What is pinned here is the *shape* of the rule: what gets normalised, which
 * columns the SQL compares (artist in, album out), that a found row is handed
 * back untouched, and that a lost race is absorbed by `ON CONFLICT DO NOTHING`
 * plus a second lookup rather than by a caught 23505. The behaviour against a
 * live Postgres — two artists, one album, concurrency — is in
 * `songIdentity.db.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// `pool` is the default `Queryable` and is the same mock as `query`, so both
// call shapes land on one recorder.
vi.mock('@/lib/db', () => {
  const query = vi.fn()
  return { query, pool: { query } }
})

import { query } from '@/lib/db'
import {
  primaryArtistName,
  primarySpotifyArtist,
  songIdentityOf,
  resolveOrCreateSongIdentity,
} from '../songIdentity'

const mockedQuery = query as unknown as Mock

beforeEach(() => {
  mockedQuery.mockReset()
})

describe('primarySpotifyArtist', () => {
  it('takes artists[0], not the joined credit list', () => {
    expect(primarySpotifyArtist([{ name: 'Michael Jackson' }, { name: 'Akon' }])).toBe('Michael Jackson')
  })

  it('trims the name and tolerates an empty artists array', () => {
    expect(primarySpotifyArtist([{ name: '  Queen  ' }])).toBe('Queen')
    expect(primarySpotifyArtist([])).toBe('')
  })
})

// ER11 — both ingestion points, not just the one with a behavioural test.
// `src/app/api/spotify/search/route.ts` sits outside the coverage universe
// (route handlers are verified by Playwright), so the only way to pin that it
// uses the shared helper rather than its own `join(', ')` is to read it.
describe('the two Spotify ingestion points (RH-95 ER11)', () => {
  const SRC = path.resolve(__dirname, '..', '..')
  const CALL_SITES = ['lib/spotifyPlaylistSync.ts', 'app/api/spotify/search/route.ts']

  it.each(CALL_SITES)('%s takes the primary artist through the shared helper', (file) => {
    const source = fs.readFileSync(path.join(SRC, file), 'utf8')

    expect(source).toContain("from '@/lib/songIdentity'")
    expect(source).toMatch(/primarySpotifyArtist\(\s*item(\.track)?\.artists\s*\)/)
    // The old shape, which produced "Michael Jackson, Akon" as the artist.
    expect(source).not.toMatch(/artists\s*\.map\(.*\)\s*\.join\(/)
  })
})

describe('primaryArtistName', () => {
  it('reduces a comma-joined credit to its first artist', () => {
    expect(primaryArtistName('Michael Jackson, Akon')).toBe('Michael Jackson')
  })

  it('trims, and leaves an ampersand-joined name alone', () => {
    expect(primaryArtistName('   Queen   ')).toBe('Queen')
    expect(primaryArtistName('Simon & Garfunkel')).toBe('Simon & Garfunkel')
  })

  it('falls back to the trimmed input when the first segment is empty', () => {
    expect(primaryArtistName(' , Akon')).toBe(', Akon')
  })
})

describe('songIdentityOf', () => {
  it('sanitizes the title, reduces the artist and trims both', () => {
    expect(songIdentityOf('  Song X - 2011 Remaster  ', ' Michael Jackson, Akon ')).toEqual({
      title: 'Song X',
      artist: 'Michael Jackson',
    })
  })

  it('preserves a performance version, which is a different song', () => {
    expect(songIdentityOf('Song X - Live', 'Queen').title).toBe('Song X - Live')
  })
})

const INPUT = {
  title: 'Song X - 2011 Remaster',
  artist: ' Michael Jackson, Akon ',
  album: 'Thriller (25th Anniversary Edition)',
  standard_key: 'Bm',
  cover_url: 'http://art',
  duration_seconds: 294,
  links: [{ label: 'YT', url: 'http://yt' }],
  contributorId: 'user-1',
}

describe('resolveOrCreateSongIdentity', () => {
  it('matches on the identity pair, and never mentions album', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'song-1', links: [] }], rowCount: 1 })

    await resolveOrCreateSongIdentity(INPUT)

    const [sql, values] = mockedQuery.mock.calls[0]
    expect(sql).toContain('LOWER(BTRIM(title)) = LOWER(BTRIM($1))')
    expect(sql).toContain('LOWER(BTRIM(artist)) = LOWER(BTRIM($2))')
    expect(sql).not.toMatch(/album/i)
    expect(values).toEqual(['Song X', 'Michael Jackson'])
  })

  it('returns a found row untouched — one statement, no write', async () => {
    const links = [{ label: 'Chords', url: 'http://chords' }]
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'song-1', links }], rowCount: 1 })

    expect(await resolveOrCreateSongIdentity(INPUT)).toEqual({ id: 'song-1', links, created: false })
    expect(mockedQuery).toHaveBeenCalledTimes(1)
  })

  it('treats a null links column on a found row as an empty array', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'song-1', links: null }], rowCount: 1 })

    expect((await resolveOrCreateSongIdentity(INPUT)).links).toEqual([])
  })

  it('inserts the normalised identity, the sanitized album and ON CONFLICT DO NOTHING', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'song-new', links: INPUT.links }], rowCount: 1 })

    expect(await resolveOrCreateSongIdentity(INPUT)).toEqual({
      id: 'song-new',
      links: INPUT.links,
      created: true,
    })

    const [sql, values] = mockedQuery.mock.calls[1]
    expect(sql).toContain('INSERT INTO global_songs')
    expect(sql).toContain('ON CONFLICT DO NOTHING')
    expect(values).toEqual([
      'user-1',
      'Song X',
      'Michael Jackson',
      'Thriller',
      'Bm',
      'http://art',
      294,
      JSON.stringify(INPUT.links),
    ])
  })

  it('defaults the optional seed columns rather than writing undefined', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'song-new', links: null }], rowCount: 1 })

    const resolved = await resolveOrCreateSongIdentity({ title: 'Bare', artist: 'Nobody' })

    expect(resolved).toEqual({ id: 'song-new', links: [], created: true })
    expect(mockedQuery.mock.calls[1][1]).toEqual([null, 'Bare', 'Nobody', null, null, null, null, '[]'])
  })

  it('re-reads the row a concurrent caller inserted when the insert does nothing', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'song-winner', links: [] }], rowCount: 1 })

    expect(await resolveOrCreateSongIdentity(INPUT)).toEqual({
      id: 'song-winner',
      links: [],
      created: false,
    })
    expect(mockedQuery).toHaveBeenCalledTimes(3)
  })

  it('throws when neither the insert nor the follow-up lookup yields a row', async () => {
    mockedQuery.mockResolvedValue({ rows: [], rowCount: 0 })

    await expect(resolveOrCreateSongIdentity(INPUT)).rejects.toThrow(
      'Failed to resolve song identity: the catalog row vanished mid-insert',
    )
  })

  it('runs on the client it is given, so it can join a caller transaction', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'song-1', links: [] }], rowCount: 1 }) }

    await resolveOrCreateSongIdentity(INPUT, client)

    expect(client.query).toHaveBeenCalledTimes(1)
    expect(mockedQuery).not.toHaveBeenCalled()
  })
})
