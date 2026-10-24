/**
 * RH-179 — a blank album, cover or album cover on a found catalog row is filled
 * by the next write that carries one, and a set value is never overwritten.
 * Both production write paths (Spotify import, manual add) go through the shared
 * helpers. Real Postgres.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { query } from '@/lib/db'
import { createAndAddSong } from '@/lib/ownerSongs'
import { findOrCreateSong, type SpotifyRawTrack } from '@/lib/spotifyPlaylistSync'
import { createTestUser, deleteTestUser } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

describe.skipIf(!RUN_DB_TESTS)('blank field fill on a found catalog row (real database)', () => {
  const suffix = Date.now()
  const artist = `RH-179 Artist ${suffix}`
  let userId: string
  let secondUserId: string
  const titles: string[] = []

  const newTitle = (name: string) => {
    const title = `${name} ${suffix}`
    titles.push(title)
    return title
  }

  const track = (title: string, album: string | null, albumArt: string | null): SpotifyRawTrack => ({
    spotifyTrackId: `rh179-${title}`,
    title,
    artist,
    album,
    albumArt,
    spotifyUrl: `https://open.spotify.com/track/rh179-${title.replace(/\s+/g, '-')}`,
    durationSeconds: null,
  })

  const songRow = async (songId: string) => {
    const r = await query<{ album: string | null; cover: string | null; u: string }>(
      'SELECT album, cover_url AS cover, updated_at::text AS u FROM songs WHERE id = $1',
      [songId],
    )
    return r.rows[0]
  }

  const albumCover = async (name: string) => {
    const r = await query<{ cover_url: string | null }>(
      'SELECT cover_url FROM albums WHERE LOWER(artist) = LOWER($1) AND LOWER(name) = LOWER($2)',
      [artist, name],
    )
    return r.rows[0]?.cover_url
  }

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh179-a-${suffix}@example.com` })
    secondUserId = await createTestUser({ email: `rh179-b-${suffix}@example.com` })
  })

  afterAll(async () => {
    for (const id of [userId, secondUserId]) if (id) await deleteTestUser(id)
    for (const title of titles) await query('DELETE FROM songs WHERE title = $1 AND artist = $2', [title, artist])
    await query('DELETE FROM albums WHERE artist = $1', [artist])
  })

  it('an import fills a blank song album and cover', async () => {
    const title = newTitle('Fill')
    const seeded = await createAndAddSong({ userId }, { title, artist })
    const out = await findOrCreateSong(track(title, `Album ${suffix}`, 'https://img/x.jpg'))
    expect(out.songId).toBe(seeded.song_id)
    expect(await songRow(out.songId)).toMatchObject({ album: `Album ${suffix}`, cover: 'https://img/x.jpg' })
  })

  it('an empty-string cover counts as blank', async () => {
    const title = newTitle('Empty')
    const seeded = await createAndAddSong({ userId }, { title, artist })
    await query("UPDATE songs SET cover_url = '' WHERE id = $1", [seeded.song_id])
    await findOrCreateSong(track(title, null, 'https://img/e.jpg'))
    expect((await songRow(seeded.song_id)).cover).toBe('https://img/e.jpg')
  })

  it('an import fills a NULL albums.cover_url', async () => {
    const album = `CoverAlbum ${suffix}`
    await findOrCreateSong(track(newTitle('AlbumA'), album, null))
    expect(await albumCover(album)).toBeNull()
    await findOrCreateSong(track(newTitle('AlbumB'), album, 'https://img/a.jpg'))
    expect(await albumCover(album)).toBe('https://img/a.jpg')
  })

  it('an import never overwrites a set value nor moves songs.updated_at', async () => {
    const title = newTitle('Keep')
    const album = `KeepAlbum ${suffix}`
    const first = await findOrCreateSong(track(title, album, 'https://img/X.jpg'))
    const before = await songRow(first.songId)
    const again = await findOrCreateSong(track(title, `Other ${suffix}`, 'https://img/Y.jpg'))
    expect(again.songId).toBe(first.songId)
    const after = await songRow(first.songId)
    expect(after).toEqual(before)
    expect(after).toMatchObject({ album, cover: 'https://img/X.jpg' })
    expect(await albumCover(album)).toBe('https://img/X.jpg')
  })

  it('a blank incoming album and cover fill nothing', async () => {
    const title = newTitle('Null')
    const seeded = await createAndAddSong({ userId }, { title, artist })
    await findOrCreateSong(track(title, null, null))
    expect(await songRow(seeded.song_id)).toMatchObject({ album: null, cover: null })
  })

  it('a manual add fills a blank album and cover', async () => {
    const title = newTitle('Manual')
    const first = await findOrCreateSong(track(title, null, null))
    const added = await createAndAddSong(
      { userId: secondUserId },
      { title, artist, album: `Manual ${suffix}`, cover_url: 'https://img/m.jpg' },
    )
    expect(added.song_id).toBe(first.songId)
    expect(await songRow(first.songId)).toMatchObject({ album: `Manual ${suffix}`, cover: 'https://img/m.jpg' })
  })

  it('rolls the fill back when the add fails later in its transaction', async () => {
    const title = newTitle('Rollback')
    const seeded = await createAndAddSong({ userId }, { title, artist })
    await expect(
      createAndAddSong({ userId }, { title, artist, album: `RB ${suffix}`, cover_url: 'https://img/r.jpg' }),
    ).rejects.toThrow('already in your repertoire')
    expect(await songRow(seeded.song_id)).toMatchObject({ album: null, cover: null })
  })
})
