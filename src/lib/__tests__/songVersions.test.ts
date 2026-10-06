/**
 * RH-122 — the album and version upsert that hangs off the identity resolver,
 * with `pg` mocked.
 *
 * What a mock can prove is pinned here: which statements are issued, that the
 * album is keyed case-insensitively on `(artist, name)` and the version on
 * `(song_id, album_id, label)`, that both absorb a duplicate with
 * `ON CONFLICT DO NOTHING` rather than a caught `23505`, and that the album
 * name reaches the catalog **raw** — the album-name stripper is gone, so
 * `"Nevermind (30th Anniversary Super Deluxe Edition)"` is a release of its own
 * and no longer merges onto `"Nevermind"`.
 *
 * What a mock cannot prove — "exactly one `albums` row after two imports" is an
 * assertion about the mock's canned reply, not about Postgres — lives in
 * `catalogVersions.db.test.ts` against real `SELECT count(*)`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/db', () => {
  const query = vi.fn()
  return { query, pool: { query } }
})

import fs from 'node:fs'
import path from 'node:path'
import { query } from '@/lib/db'
import { upsertAlbumAndVersion } from '../songVersions'
import { stripComments } from './test-helpers'

const mockedQuery = query as unknown as Mock

const SONG = { id: 'song-1', links: [], created: true, label: '2011 Remaster' }

const INPUT = {
  title: 'Song X - 2011 Remaster',
  artist: ' Michael Jackson, Akon ',
  album: 'Thriller (25th Anniversary Edition)',
  standard_key: 'Bm',
  cover_url: 'http://art',
  duration_seconds: 294,
}

beforeEach(() => {
  mockedQuery.mockReset()
})

describe('upsertAlbumAndVersion', () => {
  it('upserts the album under the primary artist and the raw album name', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'album-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'version-1' }], rowCount: 1 })

    await upsertAlbumAndVersion(SONG, INPUT)

    const [albumSql, albumValues] = mockedQuery.mock.calls[0]
    expect(albumSql).toContain('INSERT INTO albums')
    expect(albumSql).toContain('ON CONFLICT DO NOTHING')
    // The name is stored exactly as the source reports it: `albums` has a real
    // identity key now, so stripping the edition would merge two releases.
    expect(albumValues).toEqual([
      'Michael Jackson',
      'Thriller (25th Anniversary Edition)',
      'http://art',
    ])
  })

  it('writes the version label from the right half of the one parse (ER9)', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'album-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'version-1' }], rowCount: 1 })

    const versionId = await upsertAlbumAndVersion(SONG, INPUT)

    const [versionSql, versionValues] = mockedQuery.mock.calls[1]
    expect(versionSql).toContain('INSERT INTO song_versions')
    expect(versionSql).toContain('ON CONFLICT DO NOTHING')
    // RH-125: the insert returns the id, because the playlist entry is written
    // with it and no caller may re-derive it from the song.
    expect(versionSql).toContain('RETURNING id')
    expect(versionValues).toEqual(['song-1', 'album-1', '2011 Remaster', 294, 'Bm'])
    expect(versionId).toBe('version-1')
  })

  it('reads back the album a concurrent caller inserted when the insert does nothing', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'album-raced' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'version-1' }], rowCount: 1 })

    await upsertAlbumAndVersion(SONG, INPUT)

    const [lookupSql, lookupValues] = mockedQuery.mock.calls[1]
    expect(lookupSql).toContain('FROM albums')
    expect(lookupSql).toContain('LOWER(artist) = LOWER($1)')
    expect(lookupSql).toContain('LOWER(name) = LOWER($2)')
    expect(lookupValues).toEqual(['Michael Jackson', 'Thriller (25th Anniversary Edition)'])
    expect(mockedQuery.mock.calls[2][1]).toEqual([
      'song-1',
      'album-raced',
      '2011 Remaster',
      294,
      'Bm',
    ])
  })

  it('writes a version with a null album_id when the track carries no album', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'version-1' }], rowCount: 1 })

    await upsertAlbumAndVersion({ ...SONG, label: null }, { title: 'Bare', artist: 'Nobody' })

    expect(mockedQuery).toHaveBeenCalledTimes(1)
    const [versionSql, versionValues] = mockedQuery.mock.calls[0]
    expect(versionSql).toContain('INSERT INTO song_versions')
    expect(versionValues).toEqual(['song-1', null, null, null, null])
  })

  it('treats a blank album name as no album at all', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'version-1' }], rowCount: 1 })

    await upsertAlbumAndVersion(SONG, { ...INPUT, album: '   ' })

    expect(mockedQuery).toHaveBeenCalledTimes(1)
    expect(mockedQuery.mock.calls[0][1][1]).toBeNull()
  })

  it('leaves the version album-less when the album can be neither inserted nor found', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'version-1' }], rowCount: 1 })

    await upsertAlbumAndVersion(SONG, INPUT)

    expect(mockedQuery.mock.calls[2][1][1]).toBeNull()
  })

  /**
   * RH-125 — the version's own read-back, the mirror of the album's above.
   *
   * `ON CONFLICT DO NOTHING` returns no row when the version is already there,
   * which is the common case on a re-import. The id still has to be answered,
   * because `playlist_songs` is written with it — so the lookup runs, and it
   * compares both nullable columns with `IS NOT DISTINCT FROM`, because
   * `uq_song_versions_identity` is declared `NULLS NOT DISTINCT` and plain `=`
   * would never match the common unlabelled, album-less row.
   */
  it('reads the version back when the insert was a no-op, matching nulls as equal', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'album-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'version-existing' }], rowCount: 1 })

    const versionId = await upsertAlbumAndVersion(SONG, INPUT)

    const [lookupSql, lookupValues] = mockedQuery.mock.calls[2]
    expect(lookupSql).toContain('FROM song_versions')
    expect(lookupSql).toContain('album_id IS NOT DISTINCT FROM $2')
    expect(lookupSql).toContain('label IS NOT DISTINCT FROM $3')
    expect(lookupValues).toEqual(['song-1', 'album-1', '2011 Remaster'])
    expect(versionId).toBe('version-existing')
  })

  it('throws rather than answering an id it could not resolve', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'album-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })

    await expect(upsertAlbumAndVersion(SONG, INPUT)).rejects.toThrow(
      'Failed to resolve the song version just written',
    )
  })

  it('runs on the client it is given, so it joins the caller transaction', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'album-1' }], rowCount: 1 }) }
    // Both statements answer a row, so neither read-back runs.

    await upsertAlbumAndVersion(SONG, INPUT, client)

    expect(client.query).toHaveBeenCalledTimes(2)
    expect(mockedQuery).not.toHaveBeenCalled()
  })

  // ER10 — no new `catch` inspects 23505. Comments are stripped first: the
  // module's header explains *why* it does not, which a naive grep would read
  // as the thing it forbids.
  it('never inspects a Postgres error code — the duplicate is absorbed by the conflict clause', () => {
    const source = stripComments(
      fs.readFileSync(path.resolve(__dirname, '..', 'songVersions.ts'), 'utf8'),
    )

    expect(source).not.toContain('23505')
    expect(source).not.toMatch(/catch\s*\(/)
    expect(source).toContain('ON CONFLICT DO NOTHING')
  })
})
