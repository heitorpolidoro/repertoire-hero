/**
 * RH-134 - the song window against a real Postgres, through the real action.
 *
 * Only the session is faked: `getRequiredUserId` answers the fixture user, and
 * everything else - `resolveOwner`, `assertBandMember`, the entry read, the file
 * read - is the production path.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { query } from '@/lib/db'
import { createBand } from '@/lib/bands'
import { createTab } from '@/lib/tabs'
import { createTestUser, deleteTestUser, representativeVersionId } from './test-helpers'

const session = vi.hoisted(() => ({ userId: '' }))

vi.mock('@/lib/auth-session', () => ({
  getRequiredUserId: async () => session.userId,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getSongWindowAction } from '@/app/actions/repertoire'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

describe.skipIf(!RUN_DB_TESTS)('the song window (real database)', () => {
  const suffix = Date.now()
  let userId: string
  let strangerId: string
  let bandId: string
  const songIds: string[] = []
  const versionIds: string[] = []

  async function seedSong(title: string): Promise<string> {
    const res = await query<{ id: string }>(
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [`${title} ${suffix}`, 'RH-134 Artist'],
    )
    songIds.push(res.rows[0].id)
    const versionId = await representativeVersionId(res.rows[0].id)
    versionIds.push(versionId)
    return res.rows[0].id
  }

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh134-user-${suffix}@example.com` })
    strangerId = await createTestUser({ email: `rh134-stranger-${suffix}@example.com` })
    bandId = await createBand(userId, `RH-134 Band ${suffix}`, null, null)
    session.userId = userId
    await seedSong('Window A')
    await seedSong('Window B')
    await seedSong('Window C')
    await seedSong('Window D')
  })

  afterAll(async () => {
    if (bandId) await query('DELETE FROM bands WHERE id = $1', [bandId])
    await query('DELETE FROM song_files WHERE user_id = $1', [userId])
    for (const id of songIds) await query('DELETE FROM songs WHERE id = $1', [id])
    for (const id of [userId, strangerId]) if (id) await deleteTestUser(id)
  })

  it('returns three songs in one call', async () => {
    const result = await getSongWindowAction(versionIds.slice(0, 3))
    expect(result.map((r) => r.versionId)).toEqual(versionIds.slice(0, 3))
    expect(result.every((r) => r.entry !== null)).toBe(true)
    expect(result[0].entry?.song_id).toBe(songIds[0])
  })

  it('returns the image/png content_type of a neighbour file row', async () => {
    await createTab({
      userId,
      songId: songIds[1],
      title: 'Photo',
      fileUrl: 'https://example.com/photo.png',
      contentType: 'image/png',
    })
    const result = await getSongWindowAction(versionIds.slice(0, 3))
    expect(result[1].files).toHaveLength(1)
    expect(result[1].files[0].content_type).toBe('image/png')
  })

  it('returns files: [] for a song with no file row', async () => {
    const result = await getSongWindowAction(versionIds.slice(0, 3))
    expect(result[2].files).toEqual([])
    expect(result[2].entry).not.toBeNull()
  })

  it('a nonexistent version yields entry null without failing the others', async () => {
    const missing = '00000000-0000-4000-8000-000000000134'
    const result = await getSongWindowAction([versionIds[0], missing, versionIds[2]])
    expect(result[0].entry).not.toBeNull()
    expect(result[1]).toEqual({ versionId: missing, entry: null, files: [] })
    expect(result[2].entry).not.toBeNull()
  })

  it('refuses more than three ids', async () => {
    await expect(getSongWindowAction(versionIds.slice(0, 4))).rejects.toThrow(/at most 3/)
  })

  it('refuses a band the caller is not a member of', async () => {
    session.userId = strangerId
    try {
      await expect(getSongWindowAction(versionIds.slice(0, 2), bandId)).rejects.toThrow()
    } finally {
      session.userId = userId
    }
  })

  it('answers a band member for the band owner', async () => {
    const result = await getSongWindowAction(versionIds.slice(0, 2), bandId)
    expect(result).toHaveLength(2)
    expect(result[0].entry?.ownerRowId).toBeNull()
  })
})
