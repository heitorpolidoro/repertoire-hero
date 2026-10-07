/**
 * RH-23 — The Spotify playlist import/sync helpers, extracted verbatim out of
 * `api/spotify/playlists/[id]/import/route.ts` so import, sync and tracks all
 * share one copy. These tests pin the behaviour the routes relied on:
 * pagination, sanitized find-or-create, the set-based repertoire seeding
 * (RH-36 replaced the per-member check-then-insert and its 23505 swallow with
 * `ON CONFLICT DO NOTHING`), and the positional `playlist_songs` insert.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

// `pool` is the default `Queryable` of `ensureInRepertoire`, and it is the same
// mock as the `query` export, so both call shapes land on one recorder.
// `withTransaction` runs its callback with a client backed by that same
// recorder: `findOrCreateSong` is one transaction (RH-122 ER10), and the
// statement-order assertions below are about what it issues inside it, not
// about the `BEGIN`/`COMMIT` pair, which is `withTransaction`'s own and is
// exercised for real in `catalogVersions.db.test.ts`.
vi.mock('@/lib/db', () => {
  const query = vi.fn()
  const withTransaction = (fn: (client: { query: typeof query }) => unknown) => fn({ query })
  return { query, pool: { query }, withTransaction }
})

import { query } from '@/lib/db'
import {
  fetchAllSpotifyTracks,
  findOrCreateSong,
  ensureInRepertoire,
  buildPlaylistSongsInsert,
  dedupeVersionIds,
} from '../spotifyPlaylistSync'
import type { SpotifyRawTrack } from '../spotifyPlaylistSync'

const mockedQuery = query as unknown as Mock

function trackItem(id: string, name: string, durationMs: number) {
  return {
    track: {
      id,
      name,
      duration_ms: durationMs,
      // Two credited artists: RH-95 ingests the first one, not the join.
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
        artist: 'Artist A',
        album: 'Album',
        albumArt: 'http://art',
        spotifyUrl: 'https://open.spotify.com/track/t1',
        durationSeconds: 185,
      },
      {
        spotifyTrackId: 't2',
        title: 'Two',
        artist: 'Artist A',
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

describe('findOrCreateSong', () => {
  it('returns the existing id and appends the Spotify link when it is absent', async () => {
    mockedQuery
      // 1 — the identity lookup finds the row
      .mockResolvedValueOnce({
        rows: [{ id: 'song-1', links: [{ label: 'Chords', url: 'http://chords' }] }],
        rowCount: 1,
      })
      // 2 — the album upsert, 3 — the version upsert (RH-122), which answers
      // its own id since RH-125
      .mockResolvedValueOnce({ rows: [{ id: 'album-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'version-1' }], rowCount: 1 })
      // 4 — the link append
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    const resolved = await findOrCreateSong(rawTrack)

    expect(resolved).toEqual({ songId: 'song-1', versionId: 'version-1' })
    expect(mockedQuery).toHaveBeenCalledTimes(4)
    const [updateSql, updateValues] = mockedQuery.mock.calls[3]
    expect(updateSql).toBe('UPDATE songs SET links = $1, updated_at = now() WHERE id = $2')
    expect(JSON.parse(updateValues[0] as string)).toEqual([
      { label: 'Chords', url: 'http://chords' },
      { label: 'Song Name - 2018 Remaster', url: 'https://open.spotify.com/track/t1' },
    ])
    expect(updateValues[1]).toBe('song-1')
  })

  it('does not touch the links when the Spotify url is already there', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 'song-1', links: [{ label: 'x', url: 'https://open.spotify.com/track/t1' }] },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ id: 'album-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'version-1' }], rowCount: 1 })

    expect(await findOrCreateSong(rawTrack)).toEqual({
      songId: 'song-1',
      versionId: 'version-1',
    })
    // The lookup plus the two upserts, and no `UPDATE songs`.
    expect(mockedQuery).toHaveBeenCalledTimes(3)
    const statements = mockedQuery.mock.calls.map(([sql]) => String(sql))
    expect(statements.some((sql) => /UPDATE\s+songs/i.test(sql))).toBe(false)
  })

  it('inserts the split title and trimmed artist for a new song', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'song-new' }], rowCount: 1 })
      // RH-136 — the create path's links are `song_links` rows now, written by
      // `resolveOrCreateSongIdentity` right after the `songs` insert returns.
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'album-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'version-1' }], rowCount: 1 })

    expect(await findOrCreateSong(rawTrack)).toEqual({
      songId: 'song-new',
      versionId: 'version-1',
    })

    // Both statements come from `@/lib/songIdentity` now (RH-95): the lookup
    // carries the artist predicate and no album one, and the insert seeds the
    // row rather than this module doing it itself.
    const [lookupSql, lookupValues] = mockedQuery.mock.calls[0]
    expect(lookupSql).toContain('FROM songs s')
    expect(lookupSql).toContain('FROM song_links sl')
    expect(lookupValues).toEqual(['Song Name', 'Artist A'])

    // The bind list starts at the title: RH-121 dropped the catalog's
    // contributor column, which used to take $1.
    const [insertSql, insertValues] = mockedQuery.mock.calls[1]
    expect(insertSql).toContain('INSERT INTO songs')
    expect(insertValues[0]).toBe('Song Name')
    expect(insertValues[1]).toBe('Artist A')
    // RH-122: the album name is stored raw, edition and all.
    expect(insertValues[2]).toBe('Album (Deluxe Edition)')
    expect(insertValues[5]).toBe(185)
    expect(insertValues[4]).toBe('http://art')
    // RH-136 — `links` left the `songs` column list; the Spotify link is a
    // `song_links` row, inserted by the next statement. This pins the
    // single-source design, not a regression: the retained `songs.links`
    // column is kept current by the reverse bridge trigger in
    // `migrations/0019_song_links.sql`, which fires off that row insert, so the
    // Spotify push still finds the url. Nothing here needs deleting to make
    // the push work.
    expect(insertValues).toHaveLength(6)

    const [linksSql, linksValues] = mockedQuery.mock.calls[2]
    expect(linksSql).toContain('INSERT INTO song_links')
    expect(linksSql).toContain('ON CONFLICT (song_id, url) DO NOTHING')
    expect(linksValues).toEqual([
      'song-new',
      'https://open.spotify.com/track/t1',
      'Song Name - 2018 Remaster',
    ])

    // ER9 — the two halves of the one parse reach the two different keys: the
    // left half is the `songs` title above, the right half this version label.
    const [albumSql, albumValues] = mockedQuery.mock.calls[3]
    expect(albumSql).toContain('INSERT INTO albums')
    expect(albumValues).toEqual(['Artist A', 'Album (Deluxe Edition)', 'http://art'])

    const [versionSql, versionValues] = mockedQuery.mock.calls[4]
    expect(versionSql).toContain('INSERT INTO song_versions')
    expect(versionValues).toEqual(['song-new', 'album-1', '2018 Remaster', 185, null])
  })

  it('does not append the Spotify link to a row it just created', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'song-new' }], rowCount: 1 })
      // RH-136 — the create path's links are `song_links` rows now, written by
      // `resolveOrCreateSongIdentity` right after the `songs` insert returns.
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'album-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'version-1' }], rowCount: 1 })

    await findOrCreateSong(rawTrack)

    // The lookup, the `songs` insert, the `song_links` insert and the two
    // upserts — no link `UPDATE songs`.
    expect(mockedQuery).toHaveBeenCalledTimes(5)
    const statements = mockedQuery.mock.calls.map(([sql]) => String(sql))
    expect(statements.some((sql) => /UPDATE\s+songs/i.test(sql))).toBe(false)
  })

  it('never persists a songs title that still carries the separator (ER9)', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'song-new' }], rowCount: 1 })
      // RH-136 — the create path's links are `song_links` rows now, written by
      // `resolveOrCreateSongIdentity` right after the `songs` insert returns.
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'album-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'version-1' }], rowCount: 1 })

    await findOrCreateSong(rawTrack)

    const [, insertValues] = mockedQuery.mock.calls[1]
    expect(String(insertValues[0])).not.toContain(' - ')
  })
})

describe('ensureInRepertoire', () => {
  it('issues exactly one statement for a band owner', async () => {
    // RH-126: one write reaches one owner. The band's row is the whole of a
    // band-context seed — no member row for the acting admin, none for anyone
    // else, and therefore no `band_members` read of any shape.
    mockedQuery.mockResolvedValue({ rows: [], rowCount: 0 })

    await ensureInRepertoire('version-1', { bandId: 'band-1' })

    expect(mockedQuery).toHaveBeenCalledTimes(1)

    const [bandSql, bandValues] = mockedQuery.mock.calls[0]
    expect(String(bandSql)).toContain('INSERT INTO band_songs (band_id, version_id, status)')
    // RH-125: the caller resolved the version, so there is no
    // representative-version pick left here — and therefore no `albums` join.
    expect(String(bandSql)).not.toContain('albums')
    expect(String(bandSql)).not.toContain('band_members')
    expect(String(bandSql).trim().endsWith('ON CONFLICT DO NOTHING')).toBe(true)
    expect(bandValues).toEqual(['band-1', 'version-1'])
  })

  it('issues exactly one statement for a personal owner', async () => {
    mockedQuery.mockResolvedValue({ rows: [], rowCount: 0 })

    await ensureInRepertoire('version-1', { userId: 'u1' })

    expect(mockedQuery).toHaveBeenCalledTimes(1)
    const [sql, values] = mockedQuery.mock.calls[0]
    expect(String(sql)).toContain('INSERT INTO user_songs (user_id, version_id, status)')
    expect(String(sql).trim().endsWith('ON CONFLICT DO NOTHING')).toBe(true)
    expect(values).toEqual(['u1', 'version-1'])
  })

  it('runs on the client it is handed so it can join a caller transaction', async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })

    await ensureInRepertoire('version-1', { userId: 'u1' }, { query: clientQuery })

    expect(clientQuery).toHaveBeenCalledTimes(1)
    expect(mockedQuery).not.toHaveBeenCalled()
  })

  it('does nothing when the owner carries neither a band nor a user', async () => {
    await ensureInRepertoire('version-1', {})
    expect(mockedQuery).not.toHaveBeenCalled()
  })
})

describe('buildPlaylistSongsInsert', () => {
  it('numbers placeholders in threes and assigns positions 1..n', () => {
    const { sql, values } = buildPlaylistSongsInsert('pl-1', ['v1', 'v2'])

    // RH-125 ER15: the column is `version_id`.
    expect(sql).toContain('INSERT INTO playlist_songs (playlist_id, version_id, position)')
    expect(sql).toContain('($1, $2, $3), ($4, $5, $6)')
    expect(values).toEqual(['pl-1', 'v1', 1, 'pl-1', 'v2', 2])
  })

  /**
   * RH-125 ER15 / §2 — **no `ON CONFLICT` clause**, asserted rather than
   * described.
   *
   * The insert is positional: an arbiter that skipped a duplicate version would
   * leave a `position` gap behind the skipped row, and a duplicate add would
   * stop raising. Neither failure is visible to any other assertion in this
   * task, which is why it is pinned here.
   */
  it('carries no ON CONFLICT clause', () => {
    const { sql } = buildPlaylistSongsInsert('pl-1', ['v1', 'v2', 'v3'])

    expect(sql).not.toMatch(/ON\s+CONFLICT/i)
    expect(sql).not.toMatch(/song_id/)
  })

  /**
   * RH-125 ER15 — two versions of **one** song both reach the playlist, in
   * order.
   *
   * This is what the re-key buys: the old `uq_playlist_song (playlist_id,
   * song_id)` refused the second one outright, so importing a Spotify playlist
   * holding the album take and the remaster of a song used to fail the whole
   * import. The two tracks resolve to two versions under RH-122's
   * `(song_id, album_id, label)` identity, and both get a row.
   */
  it('keeps two versions of one song, in playlist order (ER15)', () => {
    const { sql, values } = buildPlaylistSongsInsert('pl-1', ['v-studio', 'v-remaster'])

    expect(sql).toContain('($1, $2, $3), ($4, $5, $6)')
    expect(values).toEqual(['pl-1', 'v-studio', 1, 'pl-1', 'v-remaster', 2])
  })

  /** Re-syncing the same track resolves to one version, so one row is written. */
  it('writes one row for a single version, whatever resolved to it', () => {
    const { values } = buildPlaylistSongsInsert('pl-1', ['v-studio'])

    expect(values).toEqual(['pl-1', 'v-studio', 1])
  })
})

/**
 * RH-125 ER15 — the pull's dedup compares **versions**.
 *
 * `dedupeVersionIds` is the dedup the sync route runs, imported rather than
 * re-implemented. It used to be a local copy of the route's loop commented
 * "exactly the route's loop", which asserted only itself: deleting the route's
 * dedup entirely left this suite green, so ER15's first two clauses were
 * unasserted. The route now has no loop of its own to drift from this.
 */
describe('the pull dedup, by version (dedupeVersionIds)', () => {
  it('keeps both takes of one song, in order', () => {
    // Two tracks of one song resolving to two versions: both entries survive,
    // and they survive in the order the playlist gave them.
    expect(dedupeVersionIds(['v-studio', 'v-remaster'])).toEqual(['v-studio', 'v-remaster'])
  })

  it('adds nothing for the same track twice', () => {
    expect(dedupeVersionIds(['v-studio', 'v-studio'])).toEqual(['v-studio'])
  })

  it('keeps the first occurrence, not the last', () => {
    // What makes the dedup order-preserving rather than a bare `new Set()`
    // round trip: a repeat later in the playlist must not move the entry.
    expect(dedupeVersionIds(['v-a', 'v-b', 'v-a', 'v-c', 'v-b'])).toEqual(['v-a', 'v-b', 'v-c'])
  })

  it('answers an empty list for no tracks', () => {
    expect(dedupeVersionIds([])).toEqual([])
  })
})
