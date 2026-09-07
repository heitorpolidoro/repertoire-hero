/**
 * RH-45 — the tab actions are band-scoped, against the real database.
 *
 * Same shape as the three RH-34 suites: only the session, Vercel Blob and
 * `revalidatePath` are mocked; every statement really runs. The SQL these
 * actions issue moved into `src/lib/tabs.ts` in this task, so this suite is
 * what proves the move preserved behaviour — `assertRepertoireAccess` still
 * gates all five operations, and a refusal writes nothing.
 *
 * Fixture: band X has A as its only member and one band repertoire entry
 * carrying one seeded tab; user C is not a member.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@vercel/blob', () => ({ put: vi.fn(), del: vi.fn() }))

import { asUser, countRows, createTestSong, SERVICE_ROLE_KEY } from './authzFixtures'
import { createAdminTestClient, createTestUser, deleteTestUser } from '@/lib/__tests__/test-helpers'
import { createBand } from '@/lib/bands'
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

const admin = createAdminTestClient()

const SEEDED_URL = 'https://blob.example/rh45/seeded.pdf'
const UPLOADED_URL = 'https://blob.example/rh45/uploaded.pdf'
const PDF_BYTES = Buffer.from('%PDF-1.4 rh45', 'latin1')

const STROKES: Stroke[] = [
  { id: 'stroke-1', color: '#ef4444', width: 0.01, points: [[0.1, 0.1], [0.5, 0.5]] },
]

/** A stand-in `FormData`/`File`: the action reads only these members. */
const uploadForm = (repertoireId: string) =>
  ({
    get: (key: string) =>
      ({
        repertoireId,
        title: 'RH-45 Chart',
        file: {
          name: 'chart.pdf',
          type: 'application/pdf',
          size: PDF_BYTES.length,
          arrayBuffer: async () => PDF_BYTES,
        },
      })[key] ?? null,
  }) as unknown as FormData

/** The message an action reports, whether it throws or returns an envelope. */
async function refusalMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    const result = (await run()) as { error?: string } | null
    return result?.error ?? 'no refusal: the action resolved'
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

describe.skipIf(!SERVICE_ROLE_KEY)('tab actions are band-scoped (real database)', () => {
  const suffix = Date.now()

  let userAId: string
  let userCId: string
  let bandId: string
  let bandEntryId: string
  let songId: string
  let seededTabId: string

  const tabCount = () =>
    countRows('SELECT count(*)::int AS count FROM repertoire_tabs WHERE repertoire_id = $1', [
      bandEntryId,
    ])

  const storedAnnotations = async (tabId: string) => {
    const res = await query('SELECT annotations FROM repertoire_tabs WHERE id = $1', [tabId])
    return res.rows[0]?.annotations ?? null
  }

  beforeAll(async () => {
    userAId = await createTestUser(admin, { email: `rh45-tabs-a-${suffix}@example.com` })
    userCId = await createTestUser(admin, { email: `rh45-tabs-c-${suffix}@example.com` })

    bandId = await createBand(userAId, `RH-45 Tabs Band ${suffix}`, null, null)

    songId = await createTestSong(`RH-45 Tabs Song ${suffix}`)
    const entry = await query(
      "INSERT INTO repertoire (band_id, song_id, status) VALUES ($1, $2, 'unknown') RETURNING id",
      [bandId, songId],
    )
    bandEntryId = entry.rows[0].id as string

    const seeded = await query(
      'INSERT INTO repertoire_tabs (repertoire_id, title, file_url) VALUES ($1, $2, $3) RETURNING id',
      [bandEntryId, `RH-45 Seeded Tab ${suffix}`, SEEDED_URL],
    )
    seededTabId = seeded.rows[0].id as string
  })

  afterAll(async () => {
    if (bandId) await query('DELETE FROM bands WHERE id = $1', [bandId])
    for (const user of [userAId, userCId]) {
      if (user) await deleteTestUser(admin, user)
    }
    if (songId) await query('DELETE FROM global_songs WHERE id = $1', [songId])
  })

  describe('a non-member is refused on every tab action', () => {
    it.each([
      ['uploadTabAction', () => uploadTabAction(uploadForm(bandEntryId))],
      ['getTabsAction', () => getTabsAction(bandEntryId)],
      ['getTabAnnotationsAction', () => getTabAnnotationsAction(seededTabId, bandEntryId)],
      [
        'saveTabAnnotationsAction',
        () => saveTabAnnotationsAction(seededTabId, bandEntryId, 1, STROKES),
      ],
      ['deleteTabAction', () => deleteTabAction(seededTabId, bandEntryId)],
    ])('%s is refused and writes nothing', async (_label, run) => {
      const countBefore = await tabCount()
      const annotationsBefore = await storedAnnotations(seededTabId)
      vi.mocked(put).mockClear()
      vi.mocked(del).mockClear()
      asUser(userCId)

      expect(await refusalMessage(run)).toContain('Access denied')

      expect(await tabCount()).toBe(countBefore)
      expect(await storedAnnotations(seededTabId)).toEqual(annotationsBefore)
      // Nothing reached Vercel Blob either: the refusal precedes the side effect.
      expect(put).not.toHaveBeenCalled()
      expect(del).not.toHaveBeenCalled()
    })
  })

  describe('a band member gets the same behaviour as before the move', () => {
    let uploadedTabId: string

    it('uploads a tab and gets the inserted row back', async () => {
      asUser(userAId)
      vi.mocked(put).mockResolvedValue({ url: UPLOADED_URL } as never)

      const result = await uploadTabAction(uploadForm(bandEntryId))

      expect(result.error).toBeUndefined()
      expect(result.data).toMatchObject({
        repertoire_id: bandEntryId,
        title: 'RH-45 Chart',
        file_url: UPLOADED_URL,
      })
      expect(result.data!.created_at).toEqual(expect.any(String))

      uploadedTabId = result.data!.id
      expect(await tabCount()).toBe(2)
    })

    it('lists both tabs of the entry', async () => {
      asUser(userAId)

      const tabs = await getTabsAction(bandEntryId)

      expect(tabs.map((t) => t.id).sort()).toEqual([seededTabId, uploadedTabId].sort())
    })

    it('reads the empty annotations a fresh tab starts with', async () => {
      asUser(userAId)

      await expect(getTabAnnotationsAction(uploadedTabId, bandEntryId)).resolves.toEqual({ data: {} })
    })

    it('writes one page of annotations and reads it back', async () => {
      asUser(userAId)

      await expect(
        saveTabAnnotationsAction(uploadedTabId, bandEntryId, 2, STROKES),
      ).resolves.toEqual({ success: true })

      await expect(getTabAnnotationsAction(uploadedTabId, bandEntryId)).resolves.toEqual({
        data: { '2': STROKES },
      })
      // The other tab of the same entry is untouched.
      expect(await storedAnnotations(seededTabId)).toEqual({})
    })

    it("reports 'Tab not found' for a tab id that belongs to no entry of theirs", async () => {
      asUser(userAId)

      await expect(
        getTabAnnotationsAction('00000000-0000-0000-0000-000000000000', bandEntryId),
      ).resolves.toEqual({ error: 'Tab not found' })
    })

    it('deletes the uploaded tab, file first', async () => {
      asUser(userAId)
      vi.mocked(del).mockClear()

      await expect(deleteTabAction(uploadedTabId, bandEntryId)).resolves.toEqual({ success: true })

      expect(del).toHaveBeenCalledWith(UPLOADED_URL)
      expect(await tabCount()).toBe(1)
    })
  })
})
