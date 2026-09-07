/**
 * RH-34 — band repertoire is no longer cross-tenant, and the shared catalog
 * write is authorized. Real database, only the session is mocked.
 *
 * Fixture: band X has A as its only member and one band repertoire entry;
 * user C is not a member. Separately, global song S carries one link and user A
 * holds a personal repertoire entry R for it — the pair the catalog-write cases
 * (ER9) act on. ADMIN is a system admin, for the approval step.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getRequiredUserId } from '@/lib/auth-session'
import { asUser, countRows, createTestSong, SERVICE_ROLE_KEY } from './authzFixtures'
import { createAdminTestClient, createTestUser, deleteTestUser } from '@/lib/__tests__/test-helpers'
import { createBand } from '@/lib/bands'
import { query } from '@/lib/db'
import {
  getRepertoireAction,
  addSongAction,
  updateSongStatusAction,
  updateSongTagsAction,
  removeSongAction,
  getSongEntryAction,
  updateSongAction,
  createAndAddSongAction,
  updateLyricsAction,
  updateSongLinksAction,
} from '../repertoire'
import { reviewGlobalSongEditAction } from '../moderation'
import type { Repertoire, SongLink } from '@/types/database'

const admin = createAdminTestClient()

const ORIGINAL_LINK: SongLink = { label: 'Chords', url: 'https://tabs.example/rh34-original' }
const ADDED_LINK: SongLink = { label: 'Video', url: 'https://youtu.be/rh34' }

describe.skipIf(!SERVICE_ROLE_KEY)('repertoire actions are band-scoped (real database)', () => {
  const suffix = Date.now()

  let userAId: string
  let userCId: string
  let adminUserId: string
  let bandId: string
  let bandEntryId: string
  let personalEntryId: string
  let catalogSongId: string
  const createdSongIds: string[] = []

  /** Every band repertoire row, in the shape ER8 compares before and after. */
  const bandRepertoire = async () => {
    const res = await query(
      'SELECT id, song_id, status, tags, lyrics FROM repertoire WHERE band_id = $1 ORDER BY id',
      [bandId],
    )
    return res.rows
  }

  /** The catalog links of song S, as stored — text so the comparison is exact. */
  const catalogLinks = async (): Promise<string> => {
    const res = await query('SELECT links::text AS links FROM global_songs WHERE id = $1', [catalogSongId])
    return res.rows[0].links as string
  }

  const editCount = () =>
    countRows('SELECT count(*)::int AS count FROM global_song_edits WHERE song_id = $1', [catalogSongId])

  /** Inserts a catalog song and remembers it for `afterAll`. */
  const createSong = async (title: string, links: SongLink[] = []): Promise<string> => {
    const id = await createTestSong(title, links)
    createdSongIds.push(id)
    return id
  }

  beforeAll(async () => {
    userAId = await createTestUser(admin, { email: `rh34-rep-a-${suffix}@example.com` })
    userCId = await createTestUser(admin, { email: `rh34-rep-c-${suffix}@example.com` })
    adminUserId = await createTestUser(admin, { email: `rh34-rep-admin-${suffix}@example.com` })
    await query('UPDATE profiles SET is_system_admin = true WHERE id = $1', [adminUserId])

    bandId = await createBand(userAId, `RH-34 Repertoire Band ${suffix}`, null, null)

    const bandSongId = await createSong(`RH-34 Band Song ${suffix}`)
    const bandEntry = await query(
      "INSERT INTO repertoire (band_id, song_id, status) VALUES ($1, $2, 'unknown') RETURNING id",
      [bandId, bandSongId],
    )
    bandEntryId = bandEntry.rows[0].id as string

    catalogSongId = await createSong(`RH-34 Catalog Song ${suffix}`, [ORIGINAL_LINK])
    const personalEntry = await query(
      "INSERT INTO repertoire (user_id, song_id, status) VALUES ($1, $2, 'unknown') RETURNING id",
      [userAId, catalogSongId],
    )
    personalEntryId = personalEntry.rows[0].id as string
  })

  afterAll(async () => {
    if (bandId) await query('DELETE FROM bands WHERE id = $1', [bandId])
    for (const user of [userAId, userCId, adminUserId]) {
      if (user) await deleteTestUser(admin, user)
    }
    for (const song of createdSongIds) {
      await query('DELETE FROM global_songs WHERE id = $1', [song])
    }
  })

  describe('a non-member is refused on every repertoire action', () => {
    it.each([
      ['getRepertoireAction', () => getRepertoireAction(bandId), false],
      ['addSongAction', () => addSongAction(catalogSongId, bandId), true],
      ['updateSongStatusAction', () => updateSongStatusAction(bandEntryId, 'mastered', bandId), true],
      ['updateSongTagsAction', () => updateSongTagsAction(bandEntryId, ['hijacked'], bandId), true],
      ['removeSongAction', () => removeSongAction(bandEntryId, bandId), true],
      ['getSongEntryAction', () => getSongEntryAction(bandEntryId, bandId), false],
      [
        'updateSongAction',
        () =>
          updateSongAction({ id: bandEntryId } as Repertoire, {
            title: 'Hijacked',
            artist: 'Hijacked',
            key: null,
            status: 'mastered',
            tags: ['hijacked'],
            links: [],
          }, bandId),
        true,
      ],
      [
        'createAndAddSongAction',
        () => createAndAddSongAction({ title: `RH-34 Intruder ${suffix}`, artist: 'Nobody' }, bandId),
        true,
      ],
      ['updateLyricsAction', () => updateLyricsAction(bandEntryId, 'hijacked lyrics', bandId), true],
    ])('%s is refused and writes nothing', async (_label, run, mutating) => {
      const before = await bandRepertoire()
      asUser(userCId)

      await expect(run()).rejects.toThrow('Access denied')

      if (mutating) expect(await bandRepertoire()).toEqual(before)
    })
  })

  describe('a member still gets the same behaviour as before', () => {
    it('reads the band repertoire and one entry of it', async () => {
      asUser(userAId)

      const repertoire = await getRepertoireAction(bandId)
      expect(repertoire.map((r) => r.id)).toContain(bandEntryId)

      const entry = await getSongEntryAction(bandEntryId, bandId)
      expect(entry).not.toBeNull()
      expect(entry!.id).toBe(bandEntryId)
      expect(entry!.song).toBeDefined()
    })

    it('updates status, tags and lyrics on a band entry', async () => {
      asUser(userAId)

      await updateSongStatusAction(bandEntryId, 'learning', bandId)
      await updateSongTagsAction(bandEntryId, ['rock'], bandId)
      await updateLyricsAction(bandEntryId, 'la la la', bandId)

      const rows = await bandRepertoire()
      const entry = rows.find((r) => r.id === bandEntryId)
      expect(entry).toMatchObject({ status: 'learning', tags: ['rock'], lyrics: 'la la la' })
    })

    it('updates the song behind a band entry', async () => {
      asUser(userAId)
      const entry = await getSongEntryAction(bandEntryId, bandId)

      await updateSongAction(entry!, {
        title: entry!.song!.title,
        artist: entry!.song!.artist,
        key: 'Am',
        status: 'practicing',
        tags: ['rock', 'set-a'],
        links: [],
      }, bandId)

      const rows = await bandRepertoire()
      expect(rows.find((r) => r.id === bandEntryId)).toMatchObject({
        status: 'practicing',
        tags: ['rock', 'set-a'],
      })
    })

    it('adds an existing song and removes it again', async () => {
      asUser(userAId)

      const added = await addSongAction(catalogSongId, bandId)
      expect(added.band_id).toBe(bandId)

      await removeSongAction(added.id, bandId)
      expect((await bandRepertoire()).some((r) => r.id === added.id)).toBe(false)
    })

    it('creates a new song and adds it to the band repertoire', async () => {
      asUser(userAId)

      const created = await createAndAddSongAction(
        { title: `RH-34 Created Song ${suffix}`, artist: 'RH-34 Artist' },
        bandId,
      )
      createdSongIds.push(created.song_id)

      expect(created.band_id).toBe(bandId)
      expect((await bandRepertoire()).some((r) => r.id === created.id)).toBe(true)
    })
  })

  describe('the shared catalog write (updateSongLinksAction)', () => {
    it('refuses a caller with no session and leaves the links alone', async () => {
      const before = await catalogLinks()
      vi.mocked(getRequiredUserId).mockRejectedValueOnce(new Error('Not authenticated'))

      await expect(updateSongLinksAction(personalEntryId, [])).rejects.toThrow('Not authenticated')

      expect(await catalogLinks()).toBe(before)
    })

    it('refuses a caller with no repertoire entry for the song', async () => {
      const before = await catalogLinks()
      asUser(userCId)

      await expect(updateSongLinksAction(personalEntryId, [ORIGINAL_LINK, ADDED_LINK])).rejects.toThrow(
        'Access denied',
      )

      expect(await catalogLinks()).toBe(before)
    })

    it('no longer accepts a global_songs id in place of a repertoire id', async () => {
      const before = await catalogLinks()
      asUser(userAId)

      await expect(updateSongLinksAction(catalogSongId, [ORIGINAL_LINK, ADDED_LINK])).rejects.toThrow(
        'Access denied',
      )

      expect(await catalogLinks()).toBe(before)
    })

    it('writes an additive change straight through', async () => {
      const editsBefore = await editCount()
      asUser(userAId)

      const result = await updateSongLinksAction(personalEntryId, [ORIGINAL_LINK, ADDED_LINK])

      expect(result.success).toBe(true)
      expect(result.pending).toBeFalsy()
      expect(await catalogLinks()).toContain(ADDED_LINK.url)
      expect(await editCount()).toBe(editsBefore)
    })

    it('routes a removal to the moderation queue and leaves the catalog untouched', async () => {
      const before = await catalogLinks()
      asUser(userAId)

      const result = await updateSongLinksAction(personalEntryId, [ADDED_LINK])

      expect(result).toEqual({ success: true, pending: true })
      expect(await catalogLinks()).toBe(before)

      const edits = await query(
        `SELECT id, status, requested_by, proposed_data
         FROM global_song_edits WHERE song_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [catalogSongId],
      )
      expect(edits.rowCount).toBe(1)
      expect(edits.rows[0].status).toBe('pending')
      expect(edits.rows[0].requested_by).toBe(userAId)
      expect(edits.rows[0].proposed_data.links).toEqual([ADDED_LINK])
    })

    it('applies the removal once a system admin approves it', async () => {
      const pending = await query(
        "SELECT id FROM global_song_edits WHERE song_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
        [catalogSongId],
      )
      asUser(adminUserId)

      await reviewGlobalSongEditAction(pending.rows[0].id as string, 'approve')

      expect(JSON.parse(await catalogLinks())).toEqual([ADDED_LINK])
    })
  })
})
