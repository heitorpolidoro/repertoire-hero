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
import {
  OWNER_SONG_FROM,
  createTestUser,
  deleteTestUser,
  seedOwnerSong,
} from '@/lib/__tests__/test-helpers'
import { createBand, joinBandByInviteClient } from '@/lib/bands'
import { query } from '@/lib/db'
import { put, del } from '@vercel/blob'
import {
  uploadTabAction,
  deleteTabAction,
  getTabAnnotationsAction,
  saveTabAnnotationsAction,
  getTabsAction,
  setTabPrimaryAction,
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
    await seedOwnerSong({ bandId }, bandOnlySongId, { status: 'polishing' })
    await seedOwnerSong({ userId: userAId }, songId, { status: 'learning' })

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

  // RH-147. The primary file is personal to a (user_id, song_id) pair.
  describe('the primary file of a song (RH-147)', () => {
    let primarySongId: string

    const primaryFlags = async (userId: string) => {
      const res = await query<{ id: string; is_primary: boolean }>(
        'SELECT id, is_primary FROM song_files WHERE user_id = $1 AND song_id = $2 ORDER BY id',
        [userId, primarySongId],
      )
      return res.rows
    }
    /** Inserted with an explicit age so "oldest" is decided by created_at, not insertion order. */
    const insertPrimaryFile = async (userId: string, title: string, ageDays: number, primary = false) => {
      const res = await query<{ id: string }>(
        `INSERT INTO song_files (user_id, song_id, title, file_url, is_primary, created_at)
         VALUES ($1, $2, $3, $4, $5, now() - ($6 || ' days')::interval) RETURNING id`,
        [userId, primarySongId, title, `https://blob.example/rh147/${title}-${suffix}.pdf`, primary, ageDays],
      )
      return res.rows[0].id
    }
    const clearPrimaryRows = () => query('DELETE FROM song_files WHERE song_id = $1', [primarySongId])

    beforeAll(async () => {
      primarySongId = await createTestSong(`RH-147 Song ${suffix}`)
    })
    afterAll(async () => {
      await clearPrimaryRows()
      await query('DELETE FROM songs WHERE id = $1', [primarySongId])
    })
    beforeEach(async () => {
      await clearPrimaryRows()
    })

    it('designating a second file moves the primary off the first, atomically', async () => {
      const first = await insertPrimaryFile(userAId, 'first', 2, true)
      const second = await insertPrimaryFile(userAId, 'second', 1)
      asUser(userAId)

      await expect(setTabPrimaryAction(second)).resolves.toEqual({ success: true })

      const rows = await primaryFlags(userAId)
      expect(rows.find((row) => row.id === second)?.is_primary).toBe(true)
      expect(rows.find((row) => row.id === first)?.is_primary).toBe(false)
      expect(rows.filter((row) => row.is_primary)).toHaveLength(1)
    })

    it('the first file uploaded for a song is its primary', async () => {
      asUser(userAId)
      vi.mocked(put).mockResolvedValueOnce({ url: `${UPLOADED_URL}?1` } as never)

      const firstUpload = await uploadTabAction(uploadForm(primarySongId))

      expect(firstUpload.error).toBeUndefined()
      expect(firstUpload.data!.is_primary).toBe(true)
      expect((await getTabsAction(primarySongId))[0].is_primary).toBe(true)
    })

    it('a second upload keeps the first file primary', async () => {
      asUser(userAId)
      vi.mocked(put).mockResolvedValueOnce({ url: `${UPLOADED_URL}?1` } as never)
      const firstUpload = await uploadTabAction(uploadForm(primarySongId))
      vi.mocked(put).mockResolvedValueOnce({ url: `${UPLOADED_URL}?2` } as never)

      const secondUpload = await uploadTabAction(uploadForm(primarySongId))

      expect(secondUpload.error).toBeUndefined()
      expect(secondUpload.data!.is_primary).toBe(false)
      const rows = await primaryFlags(userAId)
      expect(rows).toHaveLength(2)
      expect(rows.filter((row) => row.is_primary).map((row) => row.id)).toEqual([firstUpload.data!.id])
    })

    it('deleting the primary promotes the oldest remaining file', async () => {
      const oldest = await insertPrimaryFile(userAId, 'oldest', 5)
      await insertPrimaryFile(userAId, 'middle', 3)
      const doomed = await insertPrimaryFile(userAId, 'doomed', 4, true)
      vi.mocked(del).mockResolvedValue(undefined as never)
      asUser(userAId)

      await expect(deleteTabAction(doomed)).resolves.toEqual({ success: true })

      const rows = await primaryFlags(userAId)
      expect(rows).toHaveLength(2)
      expect(rows.filter((row) => row.is_primary).map((row) => row.id)).toEqual([oldest])
    })

    it('deleting a non-primary file leaves the primary alone', async () => {
      const primary = await insertPrimaryFile(userAId, 'primary', 3, true)
      const other = await insertPrimaryFile(userAId, 'other', 1)
      vi.mocked(del).mockResolvedValue(undefined as never)
      asUser(userAId)

      await expect(deleteTabAction(other)).resolves.toEqual({ success: true })

      expect((await primaryFlags(userAId)).map((row) => [row.id, row.is_primary])).toEqual([[primary, true]])
    })

    it("user B cannot set the primary of user A's file and A's rows are unchanged", async () => {
      await insertPrimaryFile(userAId, 'a1', 3, true)
      const a2 = await insertPrimaryFile(userAId, 'a2', 1)
      const before = await query(
        'SELECT * FROM song_files WHERE user_id = $1 AND song_id = $2 ORDER BY id',
        [userAId, primarySongId],
      )
      asUser(userBId)

      await expect(setTabPrimaryAction(a2)).resolves.toEqual({ error: 'Tab not found' })

      const after = await query(
        'SELECT * FROM song_files WHERE user_id = $1 AND song_id = $2 ORDER BY id',
        [userAId, primarySongId],
      )
      expect(after.rows).toEqual(before.rows)
    })

    it('keeps two users on the same song with independent primaries', async () => {
      const a1 = await insertPrimaryFile(userAId, 'a1', 3, true)
      const b1 = await insertPrimaryFile(userBId, 'b1', 3, true)
      const b2 = await insertPrimaryFile(userBId, 'b2', 1)
      asUser(userBId)

      await expect(setTabPrimaryAction(b2)).resolves.toEqual({ success: true })

      expect((await primaryFlags(userAId)).find((row) => row.id === a1)?.is_primary).toBe(true)
      const bRows = await primaryFlags(userBId)
      expect(bRows.find((row) => row.id === b2)?.is_primary).toBe(true)
      expect(bRows.find((row) => row.id === b1)?.is_primary).toBe(false)
    })

    it('never marks an audio row primary, and refuses to designate one', async () => {
      const chart = await insertPrimaryFile(userAId, 'chart', 3, true)
      const audio = await query<{ id: string }>(
        `INSERT INTO song_files (user_id, song_id, title, file_url, content_type, size_bytes)
         VALUES ($1, $2, 'audio', $3, 'audio/mpeg', 10) RETURNING id`,
        [userAId, primarySongId, `https://blob.example/rh147/audio-${suffix}.mp3`],
      )
      asUser(userAId)

      await expect(setTabPrimaryAction(audio.rows[0].id)).resolves.toEqual({ error: 'Tab not found' })

      const rows = await primaryFlags(userAId)
      expect(rows.filter((row) => row.is_primary).map((row) => row.id)).toEqual([chart])
    })
  })

  // ER12. The upload happens while the uploader holds no row for the song: the
  // band may, but a band row is not theirs and files no longer hang off one.
  it("an upload creates the uploader's own repertoire row with status unknown", async () => {
    asUser(userBId)
    const before = await countRows(
      `SELECT count(*)::int AS count FROM ${OWNER_SONG_FROM.user}
       WHERE o.user_id = $1 AND v.song_id = $2`,
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
      `SELECT o.status::text AS status FROM ${OWNER_SONG_FROM.user}
       WHERE o.user_id = $1 AND v.song_id = $2`,
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
