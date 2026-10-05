/**
 * RH-123 ER13 — the file actions are scoped to their row's own `user_id`,
 * against the real database.
 *
 * Same shape as the three RH-34 suites: only the session, Vercel Blob and
 * `revalidatePath` are mocked; every statement really runs.
 *
 * The fixture used to be a band one, because a tab was reached through a
 * repertoire entry and band membership was what granted access to it. That is
 * gone: a file belongs to a musician and a song, `song_files` has no
 * `band_id`, and the only predicate is the row's own owner. So the fixture is
 * **two users**, each holding their own file for the same song, plus a band
 * both of them belong to — present precisely to show that membership grants
 * nothing. A refusal is now indistinguishable from "no such row", which is the
 * right answer to give, so the expected message is `Tab not found` rather than
 * `Access denied`.
 *
 * It also carries the two assertions that need a real database to mean
 * anything: ER12 (a band-context upload creates the uploader's own repertoire
 * row, status `unknown`) and ER11's ledger write.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@vercel/blob', () => ({ put: vi.fn(), del: vi.fn() }))

import { asUser, countRows, createTestSong, RUN_DB_TESTS } from './authzFixtures'
import { createTestUser, deleteTestUser } from '@/lib/__tests__/test-helpers'
import { createBand, joinBandByInviteClient } from '@/lib/bands'
import { query } from '@/lib/db'
import { put, del } from '@vercel/blob'
import {
  uploadTabAction,
  deleteTabAction,
  getTabAnnotationsAction,
  saveTabAnnotationsAction,
  getTabsAction,
} from '../tabs'
import type { Stroke } from '@/types/database'

const A_URL = 'https://blob.example/rh123/user-a.pdf'
const B_URL = 'https://blob.example/rh123/user-b.pdf'
const UPLOADED_URL = 'https://blob.example/rh123/uploaded.pdf'
const PDF_BYTES = Buffer.from('%PDF-1.4 rh123', 'latin1')

const STROKES: Stroke[] = [
  { id: 'stroke-1', color: '#ef4444', width: 0.01, points: [[0.1, 0.1], [0.5, 0.5]] },
]

/** A stand-in `FormData`/`File`: the action reads only these members. */
const uploadForm = (songId: string) =>
  ({
    get: (key: string) =>
      ({
        songId,
        title: 'RH-123 Chart',
        file: {
          name: 'chart.pdf',
          type: 'application/pdf',
          size: PDF_BYTES.length,
          arrayBuffer: async () => PDF_BYTES,
        },
      })[key] ?? null,
  }) as unknown as FormData

describe.skipIf(!RUN_DB_TESTS)('the file actions are scoped to user_id (real database)', () => {
  const suffix = Date.now()

  let userAId: string
  let userBId: string
  let bandId: string
  let songId: string
  /** A second catalog song, used only by the ER12 case below: it needs a song
   *  the uploader demonstrably holds no repertoire row for. */
  let bandOnlySongId: string
  let fileAId: string
  let fileBId: string

  const fileCount = (userId: string) =>
    countRows('SELECT count(*)::int AS count FROM song_files WHERE user_id = $1 AND song_id = $2', [
      userId,
      songId,
    ])

  const storedAnnotations = async (fileId: string) => {
    const res = await query('SELECT annotations FROM song_files WHERE id = $1', [fileId])
    return res.rows[0]?.annotations ?? null
  }

  const seedFile = async (userId: string, title: string, url: string) => {
    const res = await query(
      'INSERT INTO song_files (user_id, song_id, title, file_url) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, songId, title, url],
    )
    return res.rows[0].id as string
  }

  beforeAll(async () => {
    userAId = await createTestUser({ email: `rh123-a-${suffix}@example.com` })
    userBId = await createTestUser({ email: `rh123-b-${suffix}@example.com` })

    // Both users are in one band. Nothing below depends on that, and that is
    // the point of including it.
    bandId = await createBand(userAId, `RH-123 Band ${suffix}`, null, null)
    const invite = await query<{ invite_code: string }>(
      'SELECT invite_code FROM bands WHERE id = $1',
      [bandId],
    )
    await joinBandByInviteClient(userBId, invite.rows[0].invite_code)

    songId = await createTestSong(`RH-123 Song ${suffix}`)
    bandOnlySongId = await createTestSong(`RH-123 Band Song ${suffix}`)
    // On the *band's* row and nobody's own — the band-context starting point.
    await query("INSERT INTO repertoire (band_id, song_id, status) VALUES ($1, $2, 'polishing')", [
      bandId,
      bandOnlySongId,
    ])
    await query("INSERT INTO repertoire (user_id, song_id, status) VALUES ($1, $2, 'learning')", [
      userAId,
      songId,
    ])

    fileAId = await seedFile(userAId, `RH-123 A ${suffix}`, A_URL)
    fileBId = await seedFile(userBId, `RH-123 B ${suffix}`, B_URL)
  })

  afterAll(async () => {
    if (bandId) await query('DELETE FROM bands WHERE id = $1', [bandId])
    for (const user of [userAId, userBId]) {
      if (user) await deleteTestUser(user)
    }
    for (const song of [songId, bandOnlySongId]) {
      if (song) await query('DELETE FROM songs WHERE id = $1', [song])
    }
    await query('DELETE FROM abandoned_blobs WHERE file_url = ANY($1)', [[A_URL, B_URL, UPLOADED_URL]])
  })

  beforeEach(() => {
    vi.mocked(put).mockReset()
    vi.mocked(put).mockResolvedValue({ url: UPLOADED_URL } as never)
    vi.mocked(del).mockReset()
  })

  describe("user B cannot touch user A's file, band membership notwithstanding", () => {
    it.each([
      ['getTabAnnotationsAction', () => getTabAnnotationsAction(fileAId)],
      ['saveTabAnnotationsAction', () => saveTabAnnotationsAction(fileAId, 1, STROKES)],
      ['deleteTabAction', () => deleteTabAction(fileAId)],
    ])('%s is refused and writes nothing', async (_label, run) => {
      const countBefore = await fileCount(userAId)
      const annotationsBefore = await storedAnnotations(fileAId)
      asUser(userBId)

      await expect(run()).resolves.toEqual({ error: 'Tab not found' })

      expect(await fileCount(userAId)).toBe(countBefore)
      expect(await storedAnnotations(fileAId)).toEqual(annotationsBefore)
      // Nothing reached Vercel Blob either: the row read refused first.
      expect(del).not.toHaveBeenCalled()
    })

    it("getTabsAction never lists another user's file for the same song", async () => {
      asUser(userBId)

      const files = await getTabsAction(songId)

      expect(files.map((file) => file.id)).toEqual([fileBId])
      expect(files.every((file) => file.user_id === userBId)).toBe(true)
    })

    it('uploadTabAction writes a row owned by the caller and nobody else', async () => {
      asUser(userBId)

      const result = await uploadTabAction(uploadForm(songId))

      expect(result.error).toBeUndefined()
      expect(result.data).toMatchObject({ user_id: userBId, song_id: songId, file_url: UPLOADED_URL })
      await query('DELETE FROM song_files WHERE id = $1', [result.data!.id])
    })
  })

  describe('a user gets the same behaviour as before the re-key, on their own file', () => {
    it('reads the empty annotations a fresh file starts with', async () => {
      asUser(userAId)

      await expect(getTabAnnotationsAction(fileAId)).resolves.toEqual({ data: {} })
    })

    it('writes one page of annotations and reads it back', async () => {
      asUser(userAId)

      await expect(saveTabAnnotationsAction(fileAId, 2, STROKES)).resolves.toEqual({ success: true })

      await expect(getTabAnnotationsAction(fileAId)).resolves.toEqual({ data: { '2': STROKES } })
      // The other user's file for the same song is untouched.
      expect(await storedAnnotations(fileBId)).toEqual({})
    })

    it("reports 'Tab not found' for a file id that exists nowhere", async () => {
      asUser(userAId)

      await expect(
        getTabAnnotationsAction('00000000-0000-0000-0000-000000000000'),
      ).resolves.toEqual({ error: 'Tab not found' })
    })
  })

  // ER12. The upload happens while the uploader holds no row for the song: the
  // band may, but a band row is not theirs and files no longer hang off one.
  it("an upload creates the uploader's own repertoire row with status unknown", async () => {
    asUser(userBId)
    const before = await countRows(
      'SELECT count(*)::int AS count FROM repertoire WHERE user_id = $1 AND song_id = $2',
      [userBId, bandOnlySongId],
    )
    expect(before).toBe(0)

    const result = await uploadTabAction(uploadForm(bandOnlySongId))

    expect(result.error).toBeUndefined()
    expect(result.entry).toMatchObject({
      user_id: userBId,
      song_id: bandOnlySongId,
      status: 'unknown',
    })
    const row = await query<{ status: string }>(
      'SELECT status::text AS status FROM repertoire WHERE user_id = $1 AND song_id = $2',
      [userBId, bandOnlySongId],
    )
    expect(row.rows.map((r) => r.status)).toEqual(['unknown'])

    await query('DELETE FROM song_files WHERE id = $1', [result.data!.id])
  })

  // ER11. The row goes first, so a failed object delete leaves storage to be
  // swept rather than a row pointing at nothing.
  describe('the delete order and the recovery ledger', () => {
    const ledgerRows = (url: string) =>
      countRows('SELECT count(*)::int AS count FROM abandoned_blobs WHERE file_url = $1', [url])

    it('deletes the row first and reports success when the object delete rejects', async () => {
      asUser(userAId)
      const doomedId = await seedFile(userAId, `RH-123 doomed ${suffix}`, UPLOADED_URL)
      vi.mocked(del).mockRejectedValue(new Error('blob store unreachable'))

      await expect(deleteTabAction(doomedId)).resolves.toEqual({ success: true })

      const left = await countRows('SELECT count(*)::int AS count FROM song_files WHERE id = $1', [
        doomedId,
      ])
      expect(left).toBe(0)
      expect(await ledgerRows(UPLOADED_URL)).toBe(1)

      await query('DELETE FROM abandoned_blobs WHERE file_url = $1', [UPLOADED_URL])
    })

    it('writes no ledger row when the object delete resolves', async () => {
      asUser(userAId)
      const doomedId = await seedFile(userAId, `RH-123 clean ${suffix}`, UPLOADED_URL)
      vi.mocked(del).mockResolvedValue(undefined as never)

      await expect(deleteTabAction(doomedId)).resolves.toEqual({ success: true })

      expect(del).toHaveBeenCalledWith(UPLOADED_URL)
      expect(await ledgerRows(UPLOADED_URL)).toBe(0)
    })
  })
})
