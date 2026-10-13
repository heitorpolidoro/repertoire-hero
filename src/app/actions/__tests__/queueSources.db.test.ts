/**
 * RH-167 ER8 - `getQueueSourcesAction` against the real database: only the
 * caller's newest audio file, never another user's, plus the song's links.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@vercel/blob', () => ({ put: vi.fn(), del: vi.fn() }))

import { asUser, RUN_DB_TESTS } from './authzFixtures'
import { createTestUser, deleteTestUser } from '@/lib/__tests__/test-helpers'
import { query } from '@/lib/db'
import { getQueueSourcesAction } from '../audio'

describe.skipIf(!RUN_DB_TESTS)('getQueueSourcesAction (real database)', () => {
  const suffix = Date.now()
  let me: string
  let other: string
  let third: string
  let songId: string
  let versionId: string

  const addAudio = (userId: string, title: string, url: string, at: string) =>
    query(
      `INSERT INTO song_files (user_id, song_id, title, file_url, content_type, size_bytes, created_at)
       VALUES ($1, $2, $3, $4, 'audio/mpeg', 10, $5)`,
      [userId, songId, title, url, at],
    )

  beforeAll(async () => {
    me = await createTestUser({ email: `rh167-a-${suffix}@example.com` })
    other = await createTestUser({ email: `rh167-b-${suffix}@example.com` })
    third = await createTestUser({ email: `rh167-c-${suffix}@example.com` })
    const song = await query<{ id: string }>('INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id', [
      `RH-167 Song ${suffix}`,
      'RH-167 Artist',
    ])
    songId = song.rows[0].id
    const version = await query<{ id: string }>(
      'INSERT INTO song_versions (song_id) VALUES ($1) RETURNING id',
      [songId],
    )
    versionId = version.rows[0].id
    await query(
      `INSERT INTO song_links (song_id, url, label, position) VALUES
         ($1, 'https://youtu.be/dQw4w9WgXcQ', 'Video', 1),
         ($1, 'https://open.spotify.com/track/abc123', 'Spotify', 2)`,
      [songId],
    )
    await addAudio(me, 'Old', 'https://blob.example/old.mp3', '2026-01-01T00:00:00Z')
    await addAudio(me, 'New', 'https://blob.example/new.mp3', '2026-02-01T00:00:00Z')
    await addAudio(other, 'Theirs', 'https://blob.example/theirs.mp3', '2026-03-01T00:00:00Z')
  })

  afterAll(async () => {
    if (songId) await query('DELETE FROM songs WHERE id = $1', [songId])
    for (const id of [me, other, third]) if (id) await deleteTestUser(id)
  })

  beforeEach(() => asUser(me))

  it('returns the caller newest audio file and the song links', async () => {
    expect(await getQueueSourcesAction(versionId)).toEqual({
      audio: { fileUrl: 'https://blob.example/new.mp3', title: 'New' },
      spotifyUrl: 'https://open.spotify.com/track/abc123',
      youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
    })
  })

  it('never returns another user audio for the same song', async () => {
    asUser(other)
    expect((await getQueueSourcesAction(versionId)).audio).toEqual({
      fileUrl: 'https://blob.example/theirs.mp3',
      title: 'Theirs',
    })
    asUser(third)
    expect((await getQueueSourcesAction(versionId)).audio).toBeUndefined()
  })

  it('answers an empty object for an unknown version', async () => {
    expect(await getQueueSourcesAction('00000000-0000-0000-0000-000000000000')).toEqual({})
  })
})
