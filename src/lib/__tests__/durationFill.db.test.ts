/**
 * RH-178 — a blank duration on a found catalog row is filled by the next write
 * that carries one, and a set duration is never overwritten. Both production
 * write paths (Spotify import, manual add) go through the shared helpers.
 * Real Postgres.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { query } from '@/lib/db'
import { createAndAddSong } from '@/lib/ownerSongs'
import { findOrCreateSong, type SpotifyRawTrack } from '@/lib/spotifyPlaylistSync'
import { createTestUser, deleteTestUser } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

describe.skipIf(!RUN_DB_TESTS)('duration fill on a found catalog row (real database)', () => {
  const suffix = Date.now()
  const artist = `RH-178 Artist ${suffix}`
  let userId: string
  let secondUserId: string
  const titles: string[] = []

  const newTitle = (name: string) => {
    const title = `${name} ${suffix}`
    titles.push(title)
    return title
  }

  const track = (title: string, durationSeconds: number | null): SpotifyRawTrack => ({
    spotifyTrackId: `rh178-${title}`,
    title,
    artist,
    album: null,
    albumArt: null,
    spotifyUrl: `https://open.spotify.com/track/rh178-${title.replace(/\s+/g, '-')}`,
    durationSeconds,
  })

  const durations = async (songId: string, versionId: string) => {
    const s = await query<{ d: number | null; u: string }>(
      'SELECT duration_seconds AS d, updated_at::text AS u FROM songs WHERE id = $1',
      [songId],
    )
    const v = await query<{ d: number | null; r: number | null }>(
      `SELECT v.duration_seconds AS d, COALESCE(v.duration_seconds, s.duration_seconds) AS r
         FROM song_versions v JOIN songs s ON s.id = v.song_id WHERE v.id = $1`,
      [versionId],
    )
    return { song: s.rows[0].d, updatedAt: s.rows[0].u, version: v.rows[0].d, read: v.rows[0].r }
  }

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh178-a-${suffix}@example.com` })
    secondUserId = await createTestUser({ email: `rh178-b-${suffix}@example.com` })
  })

  afterAll(async () => {
    for (const id of [userId, secondUserId]) if (id) await deleteTestUser(id)
    for (const title of titles) await query('DELETE FROM songs WHERE title = $1 AND artist = $2', [title, artist])
  })

  it('a Spotify import fills a blank song and version duration', async () => {
    const title = newTitle('Fill')
    const seeded = await createAndAddSong({ userId }, { title, artist })
    const out = await findOrCreateSong(track(title, 331))
    expect(out.songId).toBe(seeded.song_id)
    expect(out.versionId).toBe(seeded.version_id)
    const d = await durations(out.songId, out.versionId)
    expect(d).toMatchObject({ song: 331, version: 331, read: 331 })
  })

  it('an import never overwrites a set duration nor moves songs.updated_at', async () => {
    const title = newTitle('Keep')
    const first = await findOrCreateSong(track(title, 300))
    const before = await durations(first.songId, first.versionId)
    expect(before).toMatchObject({ song: 300, version: 300 })

    const again = await findOrCreateSong(track(title, 331))
    expect(again).toEqual(first)
    const after = await durations(first.songId, first.versionId)
    expect(after).toMatchObject({ song: 300, version: 300 })
    expect(after.updatedAt).toBe(before.updatedAt)
  })

  it('a null incoming duration fills nothing', async () => {
    const title = newTitle('Null')
    const first = await findOrCreateSong(track(title, null))
    await findOrCreateSong(track(title, null))
    const d = await durations(first.songId, first.versionId)
    expect(d).toMatchObject({ song: null, version: null, read: null })
  })

  it('a manual add with a duration fills a blank one', async () => {
    const title = newTitle('Manual')
    const first = await findOrCreateSong(track(title, null))
    const added = await createAndAddSong({ userId: secondUserId }, { title, artist, duration_seconds: 240 })
    expect(added.song_id).toBe(first.songId)
    const d = await durations(first.songId, first.versionId)
    expect(d).toMatchObject({ song: 240, version: 240 })
  })

  it('rolls the fill back when the add fails later in its transaction', async () => {
    const title = newTitle('Rollback')
    const seeded = await createAndAddSong({ userId }, { title, artist })
    await expect(createAndAddSong({ userId }, { title, artist, duration_seconds: 240 })).rejects.toThrow(
      'already in your repertoire',
    )
    const d = await durations(seeded.song_id, seeded.version_id)
    expect(d).toMatchObject({ song: null, version: null })
  })
})
