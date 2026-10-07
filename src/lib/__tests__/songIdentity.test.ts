/**
 * RH-95 — the one song-identity rule, with `pg` mocked.
 *
 * What is pinned here is the *shape* of the rule: what gets normalised, which
 * columns the SQL compares (artist in, album out), that a found row is handed
 * back untouched, and that a lost race is absorbed by `ON CONFLICT DO NOTHING`
 * plus a second lookup rather than by a caught 23505.
 *
 * RH-122 changed exactly one thing in the rule: the title is **split** at its
 * first `" - "` instead of being stripped, and the right half comes back as
 * `label` for `src/lib/songVersions.ts` to write. Every assertion about the
 * identity pair, the album-less key and the primary artist is unchanged. The behaviour against a
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
  it('splits the title, reduces the artist, and keeps the right half as the label', () => {
    expect(songIdentityOf('  Song X - 2011 Remaster  ', ' Michael Jackson, Akon ')).toEqual({
      title: 'Song X',
      artist: 'Michael Jackson',
      label: '2011 Remaster',
    })
  })

  // RH-122: the old sanitizer *preserved* a performance suffix inside the
  // title, which gave the live take a catalog row of its own. It is now the
  // version's label — the same song, a different recording.
  it('splits a performance suffix off instead of preserving it in the title', () => {
    expect(songIdentityOf('Song X - Live', 'Queen')).toEqual({
      title: 'Song X',
      artist: 'Queen',
      label: 'Live',
    })
  })

  it('reports no label for a title that carries no suffix', () => {
    expect(songIdentityOf('Song X', 'Queen').label).toBeNull()
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
}

describe('resolveOrCreateSongIdentity', () => {
  it('matches on the identity pair, and never mentions album', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'song-1', links: [] }], rowCount: 1 })

    await resolveOrCreateSongIdentity(INPUT)

    const [sql, values] = mockedQuery.mock.calls[0]
    expect(sql).toContain('LOWER(BTRIM(title)) = LOWER(BTRIM($1))')
    // RH-136 — the row's links come from the correlated `song_links` aggregate.
    expect(sql).toContain('FROM song_links sl')
    expect(sql).toContain('LOWER(BTRIM(artist)) = LOWER(BTRIM($2))')
    expect(sql).not.toMatch(/album/i)
    expect(values).toEqual(['Song X', 'Michael Jackson'])
  })

  it('returns a found row untouched — one statement, no write', async () => {
    const links = [{ label: 'Chords', url: 'http://chords' }]
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'song-1', links }], rowCount: 1 })

    expect(await resolveOrCreateSongIdentity(INPUT)).toEqual({
      id: 'song-1',
      links,
      created: false,
      label: '2011 Remaster',
    })
    expect(mockedQuery).toHaveBeenCalledTimes(1)
  })

  it('treats a null links column on a found row as an empty array', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'song-1', links: null }], rowCount: 1 })

    expect((await resolveOrCreateSongIdentity(INPUT)).links).toEqual([])
  })

  it('inserts the normalised identity, the raw album and ON CONFLICT DO NOTHING', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'song-new' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    expect(await resolveOrCreateSongIdentity(INPUT)).toEqual({
      id: 'song-new',
      links: INPUT.links,
      created: true,
      label: '2011 Remaster',
    })

    const [sql, values] = mockedQuery.mock.calls[1]
    expect(sql).toContain('INSERT INTO songs')
    expect(sql).toContain('ON CONFLICT DO NOTHING')
    // Six columns, six placeholders: RH-121 dropped the catalog's contributor
    // column, so the bind list starts at the title, and RH-136 took `links`
    // out of it — a link is a `song_links` row now.
    expect(sql).toContain('VALUES ($1, $2, $3, $4, $5, $6)')
    // Not a pinned regression: the retained `songs.links` column is written by
    // the reverse bridge trigger (`migrations/0019_song_links.sql`) off the
    // `song_links` insert this statement is followed by, so the Spotify push —
    // which still reads the column — keeps working without a dual write here.
    expect(sql).not.toMatch(/\blinks\b/)
    // The album name arrives raw (RH-122): `albums` has a real identity key, so
    // stripping the edition would merge two genuinely separate releases.
    expect(values).toEqual([
      'Song X',
      'Michael Jackson',
      'Thriller (25th Anniversary Edition)',
      'Bm',
      'http://art',
      294,
    ])
  })

  it('writes the created row links to song_links, with a conflict policy (RH-136)', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'song-new' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    await resolveOrCreateSongIdentity(INPUT)

    const [sql, values] = mockedQuery.mock.calls[2]
    expect(sql).toContain('INSERT INTO song_links (song_id, url, label, position)')
    // A create has nothing to overwrite, so the policy is `DO NOTHING` and no
    // `position = EXCLUDED.position` belongs here.
    expect(sql).toContain('ON CONFLICT (song_id, url) DO NOTHING')
    expect(sql).not.toContain('EXCLUDED')
    expect(values).toEqual(['song-new', 'http://yt', 'YT'])
  })

  it('keeps the first label when the input array holds the same url twice (RH-136)', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'song-new' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    const resolved = await resolveOrCreateSongIdentity({
      title: 'Dup',
      artist: 'Nobody',
      links: [
        { label: 'first', url: 'http://same' },
        { label: 'second', url: 'http://same' },
      ],
    })

    // One row, not two: a duplicate would raise 23505 and abort the caller's
    // transaction.
    expect(resolved.links).toEqual([{ label: 'first', url: 'http://same' }])
    expect(mockedQuery.mock.calls[2][1]).toEqual(['song-new', 'http://same', 'first'])
  })

  it('defaults the optional seed columns rather than writing undefined', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'song-new' }], rowCount: 1 })

    const resolved = await resolveOrCreateSongIdentity({ title: 'Bare', artist: 'Nobody' })

    expect(resolved).toEqual({ id: 'song-new', links: [], created: true, label: null })
    expect(mockedQuery.mock.calls[1][1]).toEqual(['Bare', 'Nobody', null, null, null, null])
    // No links to write, so no second statement at all.
    expect(mockedQuery).toHaveBeenCalledTimes(2)
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
      label: '2011 Remaster',
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
