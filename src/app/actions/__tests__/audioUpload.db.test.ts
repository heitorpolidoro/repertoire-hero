/**
 * RH-162 ER1/ER6 — an audio upload against the real database. Only the session,
 * Vercel Blob and `revalidatePath` are mocked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@vercel/blob', () => ({ put: vi.fn(), del: vi.fn() }))

import { asUser, countRows, RUN_DB_TESTS } from './authzFixtures'
import { createTestUser, deleteTestUser } from '@/lib/__tests__/test-helpers'
import { createBand } from '@/lib/bands'
import { query } from '@/lib/db'
import { listAudio, listTabs, sumAudioBytes } from '@/lib/tabs'
import { put } from '@vercel/blob'
import { uploadAudioAction } from '../audio'
import { uploadTabAction } from '../tabs'

const MP3 = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.alloc(1000)])
const PDF = Buffer.from('%PDF-1.4 rh162', 'latin1')

const form = (songId: string, bytes: Buffer, name: string) =>
  ({
    get: (key: string) =>
      ({
        songId,
        title: 'Backing track',
        file: { name, type: 'audio/mpeg', size: bytes.length, arrayBuffer: async () => bytes },
      })[key] ?? null,
  }) as unknown as FormData

describe.skipIf(!RUN_DB_TESTS)('audio upload (real database)', () => {
  const suffix = Date.now()
  let userId: string
  let bandId: string
  let songId: string

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh162-${suffix}@example.com` })
    bandId = await createBand(userId, `RH-162 Band ${suffix}`, null, null)
    const song = await query<{ id: string }>(
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [`RH-162 Song ${suffix}`, 'RH-162 Artist'],
    )
    songId = song.rows[0].id
  })

  afterAll(async () => {
    if (bandId) await query('DELETE FROM bands WHERE id = $1', [bandId])
    if (userId) await deleteTestUser(userId)
    if (songId) await query('DELETE FROM songs WHERE id = $1', [songId])
  })

  beforeEach(() => {
    asUser(userId)
    vi.mocked(put).mockReset()
    vi.mocked(put).mockImplementation(
      async (path: string) => ({ url: `https://blob.example/rh162/${path}` }) as never,
    )
  })

  const rows = () =>
    query<{ user_id: string; content_type: string; size_bytes: string }>(
      'SELECT user_id, content_type, size_bytes FROM song_files WHERE user_id = $1 AND song_id = $2',
      [userId, songId],
    )

  it('stores one row owned by the uploader with an audio content_type and size_bytes', async () => {
    const res = await uploadAudioAction(form(songId, MP3, 'backing.mp3'))
    expect(res.error).toBeUndefined()
    const stored = await rows()
    expect(stored.rows).toHaveLength(1)
    expect(stored.rows[0].user_id).toBe(userId)
    expect(stored.rows[0].content_type).toBe('audio/mpeg')
    expect(Number(stored.rows[0].size_bytes)).toBe(MP3.length)
    expect(await sumAudioBytes(userId)).toBe(MP3.length)
  })

  it('in band context lands on the uploader and creates no band row', async () => {
    const bandRowsBefore = await countRows(
      'SELECT count(*)::int AS count FROM band_songs WHERE band_id = $1',
      [bandId],
    )
    // Band context is a client concept: the action takes no band id at all.
    const res = await uploadAudioAction(form(songId, MP3, 'band-ctx.mp3'))
    expect(res.error).toBeUndefined()
    const stored = await rows()
    expect(stored.rows.every((r) => r.user_id === userId)).toBe(true)
    expect(
      await countRows('SELECT count(*)::int AS count FROM band_songs WHERE band_id = $1', [bandId]),
    ).toBe(bandRowsBefore)
    expect(
      await countRows('SELECT count(*)::int AS count FROM song_files WHERE song_id = $1 AND user_id <> $2', [
        songId,
        userId,
      ]),
    ).toBe(0)
  })

  it('refuses a PDF renamed .mp3 with no new row and no put', async () => {
    const before = (await rows()).rows.length
    const res = await uploadAudioAction(form(songId, PDF, 'fake.mp3'))
    expect(res.error).toMatch(/MP3 and M4A/)
    expect((await rows()).rows).toHaveLength(before)
    expect(put).not.toHaveBeenCalled()
  })

  it('keeps audio rows out of the chart list, and charts out of the audio list', async () => {
    await uploadTabAction(form(songId, PDF, 'chart.pdf'))
    const charts = await listTabs(userId, songId)
    expect(charts.length).toBeGreaterThan(0)
    expect(charts.every((c) => !c.content_type?.startsWith('audio/'))).toBe(true)
    const audio = await listAudio(userId, songId)
    expect(audio.length).toBeGreaterThan(0)
    expect(audio.every((a) => a.content_type?.startsWith('audio/'))).toBe(true)
  })
})
