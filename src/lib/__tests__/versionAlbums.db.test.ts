/**
 * RH-120 — one recording, many albums, against the real database.
 *
 * The same track ingested from two albums is ONE `song_versions` row linked to
 * both; every read that shows an album per version still shows exactly one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { query } from '@/lib/db'
import { getPersonalEntryForSong, getRepertoire } from '@/lib/ownerSongs'
import { searchSongs } from '@/lib/songs'
import { ensureSongHasVersion, upsertAlbumAndVersion } from '@/lib/songVersions'
import { createTestUser, deleteTestUser, seedOwnerSong } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

describe.skipIf(!RUN_DB_TESTS)('version_albums (RH-120)', () => {
  const sfx = randomUUID().replace(/-/g, '').slice(0, 10)
  const artist = `RH-120 Artist ${sfx}`
  let userId: string

  const newSong = async (title: string): Promise<string> =>
    (
      await query<{ id: string }>('INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id', [
        title,
        artist,
      ])
    ).rows[0].id

  const ingest = (songId: string, album: string | undefined, label: string | null = null) =>
    upsertAlbumAndVersion(
      { id: songId, links: [], created: false, label },
      { title: 'x', artist, album, duration_seconds: 200, standard_key: 'G' },
    )

  const albumRow = async (name: string, type: string, date: string | null) =>
    (
      await query<{ id: string }>(
        `INSERT INTO albums (artist, name, album_type, release_date) VALUES ($1, $2, $3, $4) RETURNING id`,
        [artist, name, type, date],
      )
    ).rows[0].id

  const counts = async (songId: string) => ({
    versions: Number(
      (await query<{ n: string }>('SELECT count(*)::text AS n FROM song_versions WHERE song_id = $1', [songId]))
        .rows[0].n,
    ),
    links: Number(
      (
        await query<{ n: string }>(
          `SELECT count(*)::text AS n FROM version_albums va
             JOIN song_versions v ON v.id = va.version_id WHERE v.song_id = $1`,
          [songId],
        )
      ).rows[0].n,
    ),
  })

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh120-${sfx}@example.com` })
  })

  afterAll(async () => {
    await deleteTestUser(userId)
    await query('DELETE FROM songs WHERE artist = $1', [artist])
    await query('DELETE FROM albums WHERE artist = $1', [artist])
  })

  it('links the same track from two albums to one version, idempotently', async () => {
    const songId = await newSong(`Ingest ${sfx}`)

    const first = await ingest(songId, `Studio ${sfx}`)
    const second = await ingest(songId, `Compilation ${sfx}`)
    expect(second).toBe(first)
    expect(await counts(songId)).toEqual({ versions: 1, links: 2 })

    const repeat = await ingest(songId, `Compilation ${sfx}`)
    expect(repeat).toBe(first)
    expect(await counts(songId)).toEqual({ versions: 1, links: 2 })
  })

  it('does not overwrite duration or key of an existing version on a second ingest', async () => {
    const songId = await newSong(`Keep ${sfx}`)
    const id = await ingest(songId, `First ${sfx}`)
    await upsertAlbumAndVersion(
      { id: songId, links: [], created: false, label: null },
      { title: 'x', artist, album: `Second ${sfx}`, duration_seconds: 999, standard_key: 'C' },
    )
    const row = await query<{ duration_seconds: number; key: string }>(
      'SELECT duration_seconds, key FROM song_versions WHERE id = $1',
      [id],
    )
    expect(row.rows[0]).toEqual({ duration_seconds: 200, key: 'G' })
  })

  it('keeps a distinct label as a distinct version', async () => {
    const songId = await newSong(`Labels ${sfx}`)
    const plain = await ingest(songId, `A ${sfx}`)
    const live = await ingest(songId, `A ${sfx}`, 'Live')
    expect(live).not.toBe(plain)
    expect(await counts(songId)).toEqual({ versions: 2, links: 2 })
  })

  it('creates an album-less version with zero links', async () => {
    const songId = await newSong(`Bare ${sfx}`)
    await ingest(songId, undefined)
    expect(await counts(songId)).toEqual({ versions: 1, links: 0 })
  })

  it('ensureSongHasVersion links the song’s own album, and is a no-op afterwards', async () => {
    const songId = (
      await query<{ id: string }>(
        'INSERT INTO songs (title, artist, album) VALUES ($1, $2, $3) RETURNING id',
        [`Seeded ${sfx}`, artist, `Seed Album ${sfx}`],
      )
    ).rows[0].id
    await albumRow(`Seed Album ${sfx}`, 'album', '2001-01-01')

    await ensureSongHasVersion(songId)
    await ensureSongHasVersion(songId)
    expect(await counts(songId)).toEqual({ versions: 1, links: 1 })
  })

  describe('a version on two albums shows exactly one', () => {
    let songId: string
    let versionId: string
    const title = `Two Albums ${sfx}`

    beforeAll(async () => {
      songId = await newSong(title)
      // The compilation is the older release, but the studio album wins on type.
      const compilation = await albumRow(`Best Of ${sfx}`, 'compilation', '1990-01-01')
      const studio = await albumRow(`Studio Two ${sfx}`, 'album', '2000-01-01')
      versionId = (
        await query<{ id: string }>('INSERT INTO song_versions (song_id) VALUES ($1) RETURNING id', [songId])
      ).rows[0].id
      for (const album of [compilation, studio]) {
        await query('INSERT INTO version_albums (version_id, album_id) VALUES ($1, $2)', [versionId, album])
      }
      await seedOwnerSong({ userId }, songId)
    })

    it('search returns one version carrying the album-type, earliest-dated album', async () => {
      const [song] = await searchSongs(title)
      expect(song.versions).toHaveLength(1)
      expect(song.versions[0].versionId).toBe(versionId)
      expect(song.versions[0].albumName).toBe(`Studio Two ${sfx}`)
      expect(song.versions[0].albumType).toBe('album')
    })

    it('owner reads return one row for the version, not one per album', async () => {
      const mine = (await getRepertoire({ userId })).filter((e) => e.song_id === songId)
      expect(mine).toHaveLength(1)
      expect(mine[0].version_id).toBe(versionId)

      const personal = await getPersonalEntryForSong(songId, userId)
      expect(personal?.version_id).toBe(versionId)
    })

    it('still returns an album-less version in search', async () => {
      const bareTitle = `Bare Search ${sfx}`
      const bareSong = await newSong(bareTitle)
      const bareVersion = await ingest(bareSong, undefined, 'Demo')
      const [song] = await searchSongs(bareTitle)
      expect(song.versions.map((v) => v.versionId)).toEqual([bareVersion])
      expect(song.versions[0].albumName).toBeNull()
    })
  })
})
