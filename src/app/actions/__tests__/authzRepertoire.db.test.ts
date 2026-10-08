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
import { asUser, countRows, createTestSong, RUN_DB_TESTS } from './authzFixtures'
import {
  OWNER_SONG_FROM,
  SONG_LINKS_CANONICAL_ORDER,
  createTestUser,
  deleteTestUser,
  seedOwnerSong,
} from '@/lib/__tests__/test-helpers'
import { createBand } from '@/lib/bands'
import { query } from '@/lib/db'
import {
  getRepertoireAction,
  addSongAction,
  updateSongStatusAction,
  updateSongTagsAction,
  removeSongAction,
  getResolvedEntryForVersionAction,
  updateSongAction,
  createAndAddSongAction,
  updateLyricsAction,
  updateSongLinksAction,
} from '../repertoire'
import { reviewCatalogSuggestionGroupAction } from '../moderation'
import type { Repertoire, SongLink } from '@/types/database'

const ORIGINAL_LINK: SongLink = { label: 'Chords', url: 'https://tabs.example/rh34-original' }
const ADDED_LINK: SongLink = { label: 'Video', url: 'https://youtu.be/rh34' }

describe.skipIf(!RUN_DB_TESTS)('repertoire actions are band-scoped (real database)', () => {
  const suffix = Date.now()

  let userAId: string
  let userBId: string
  let userCId: string
  let adminUserId: string
  let bandId: string
  let bandEntryId: string
  /** The `song_versions.id` behind `bandEntryId` — Fast View's address (RH-132). */
  let bandVersionId: string
  let personalEntryId: string
  let catalogSongId: string
  const createdSongIds: string[] = []

  /** Every band repertoire row, in the shape ER8 compares before and after. */
  const bandRepertoire = async () => {
    const res = await query(
      `SELECT o.id, v.song_id, o.status, o.tags, o.lyrics FROM ${OWNER_SONG_FROM.band}
       WHERE o.band_id = $1 ORDER BY o.id`,
      [bandId],
    )
    return res.rows
  }

  /** How many `band_songs` rows the band holds for one catalog song. */
  const bandRowsForSong = (songId: string) =>
    countRows(
      `SELECT count(*)::int AS count FROM ${OWNER_SONG_FROM.band}
       WHERE o.band_id = $1 AND v.song_id = $2`,
      [bandId, songId],
    )

  /**
   * The catalog links of song S, as stored — a json text so the comparison
   * stays exact. Since RH-136 a link is a `song_links` row, so this reads the
   * table in the canonical order rather than the retained `songs.links` column,
   * which no writer on this path maintains any more.
   */
  const catalogLinks = async (): Promise<string> => {
    const res = await query<{ links: string }>(
      `SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'url', url)
                ${SONG_LINKS_CANONICAL_ORDER}), '[]'::jsonb)::text AS links
         FROM song_links WHERE song_id = $1`,
      [catalogSongId],
    )
    return res.rows[0].links
  }

  const suggestionCount = () =>
    countRows('SELECT count(*)::int AS count FROM catalog_suggestions WHERE target_id = $1', [
      catalogSongId,
    ])

  /** Inserts a catalog song and remembers it for `afterAll`. */
  const createSong = async (title: string, links: SongLink[] = []): Promise<string> => {
    const id = await createTestSong(title, links)
    createdSongIds.push(id)
    return id
  }

  beforeAll(async () => {
    userAId = await createTestUser({ email: `rh34-rep-a-${suffix}@example.com` })
    userBId = await createTestUser({ email: `rh96-rep-b-${suffix}@example.com` })
    userCId = await createTestUser({ email: `rh34-rep-c-${suffix}@example.com` })
    adminUserId = await createTestUser({ email: `rh34-rep-admin-${suffix}@example.com` })
    await query('UPDATE profiles SET is_system_admin = true WHERE id = $1', [adminUserId])

    bandId = await createBand(userAId, `RH-34 Repertoire Band ${suffix}`, null, null)
    // B joins as a plain member: the RH-96 gate's subject.
    await query("INSERT INTO band_members (band_id, user_id, role) VALUES ($1, $2, 'member')", [
      bandId,
      userBId,
    ])

    const bandSongId = await createSong(`RH-34 Band Song ${suffix}`)
    bandEntryId = await seedOwnerSong({ bandId }, bandSongId)
    bandVersionId = (
      await query<{ version_id: string }>('SELECT version_id FROM band_songs WHERE id = $1', [
        bandEntryId,
      ])
    ).rows[0].version_id

    catalogSongId = await createSong(`RH-34 Catalog Song ${suffix}`, [ORIGINAL_LINK])
    personalEntryId = await seedOwnerSong({ userId: userAId }, catalogSongId)
  })

  afterAll(async () => {
    if (bandId) await query('DELETE FROM bands WHERE id = $1', [bandId])
    for (const user of [userAId, userBId, userCId, adminUserId]) {
      if (user) await deleteTestUser(user)
    }
    for (const song of createdSongIds) {
      await query('DELETE FROM songs WHERE id = $1', [song])
    }
  })

  describe('a non-member is refused on every repertoire action', () => {
    it.each([
      ['getRepertoireAction', () => getRepertoireAction(bandId), false],
      ['addSongAction', () => addSongAction(catalogSongId, bandId), true],
      ['updateSongStatusAction', () => updateSongStatusAction(bandEntryId, 'mastered', bandId), true],
      ['updateSongTagsAction', () => updateSongTagsAction(bandEntryId, ['hijacked'], bandId), true],
      ['removeSongAction', () => removeSongAction(bandEntryId, bandId), true],
      [
        'getResolvedEntryForVersionAction',
        () => getResolvedEntryForVersionAction(bandVersionId, bandId),
        false,
      ],
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

  // User A created the band, so they are its admin — since RH-124 that is what
  // these cases are about.
  describe('a band admin still gets the same behaviour as before', () => {
    it('reads the band repertoire and one entry of it', async () => {
      asUser(userAId)

      const repertoire = await getRepertoireAction(bandId)
      expect(repertoire.map((r) => r.id)).toContain(bandEntryId)

      const entry = await getResolvedEntryForVersionAction(bandVersionId, bandId)
      expect(entry).not.toBeNull()
      expect(entry.ownerRowId).toBe(bandEntryId)
      expect(entry.version_id).toBe(bandVersionId)
      expect(entry.song).toBeDefined()
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
      const entry = (await getRepertoireAction(bandId)).find((row) => row.id === bandEntryId)

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

  /**
   * RH-124 ER18 — **every** write to a band's row requires band admin, not just
   * the two RH-96 gated. `docs/use-cases.md`, *Writing a band's rows*, is
   * unqualified: adding, removing, status, key, tuning, lyrics, map, tags. A
   * member who is not an admin reads the band's repertoire and changes nothing
   * in it, while their own rows are untouched by the gate.
   *
   * All seven mutating actions are covered in both directions. Three of them —
   * `addSongAction`, `updateSongTagsAction`, `updateLyricsAction` — a member
   * could perform before this task; that is the approved behaviour change.
   */
  describe('a band member who is not an admin', () => {
    const intruderTitle = `RH-124 Member Created ${suffix}`

    it.each([
      ['updateSongStatusAction', () => updateSongStatusAction(bandEntryId, 'mastered', bandId)],
      [
        'updateSongAction',
        () =>
          updateSongAction({ id: bandEntryId } as Repertoire, {
            title: 'Member Edit',
            artist: 'Member Edit',
            key: 'C',
            status: 'mastered',
            tags: ['member-edit'],
            links: [],
          }, bandId),
      ],
      ['addSongAction', () => addSongAction(catalogSongId, bandId)],
      ['removeSongAction', () => removeSongAction(bandEntryId, bandId)],
      ['updateSongTagsAction', () => updateSongTagsAction(bandEntryId, ['member-tag'], bandId)],
      ['updateLyricsAction', () => updateLyricsAction(bandEntryId, 'member lyrics', bandId)],
      [
        'createAndAddSongAction',
        () => createAndAddSongAction({ title: intruderTitle, artist: 'RH-124 Nobody' }, bandId),
      ],
    ])('is refused on %s and writes nothing', async (_label, run) => {
      const before = await bandRepertoire()
      asUser(userBId)

      await expect(run()).rejects.toThrow('Access denied: band admin required')

      expect(await bandRepertoire()).toEqual(before)
    })

    /**
     * `createAndAddSongAction` is the one that creates the catalog row *and*
     * the band's hold on it, so "nothing written" has a second half: no
     * `band_songs` row for the song it would have created. The catalog row
     * itself may or may not exist — the gate runs before `createAndAddSong`, so
     * it does not — but the assertion is about the band's repertoire.
     */
    it('leaves no band_songs row for the song createAndAddSongAction would have created', async () => {
      asUser(userBId)

      await expect(
        createAndAddSongAction({ title: intruderTitle, artist: 'RH-124 Nobody' }, bandId),
      ).rejects.toThrow('Access denied: band admin required')

      const catalog = await query<{ id: string }>(
        'SELECT id FROM songs WHERE LOWER(BTRIM(title)) = LOWER(BTRIM($1))',
        [intruderTitle],
      )
      expect(catalog.rows).toHaveLength(0)
    })

    it('still reads the band repertoire and one entry of it', async () => {
      asUser(userBId)

      expect((await getRepertoireAction(bandId)).map((r) => r.id)).toContain(bandEntryId)
      expect((await getResolvedEntryForVersionAction(bandVersionId, bandId)).ownerRowId).toBe(
        bandEntryId,
      )
    })

    it('still sets their own personal status, and their own key and tags', async () => {
      asUser(userBId)
      const personal = await addSongAction(catalogSongId)
      try {
        await updateSongStatusAction(personal.id, 'polishing')
        await updateSongTagsAction(personal.id, ['mine'])
        await updateLyricsAction(personal.id, 'my own words')

        const res = await query('SELECT status, tags, lyrics FROM user_songs WHERE id = $1', [
          personal.id,
        ])
        expect(res.rows[0]).toMatchObject({
          status: 'polishing',
          tags: ['mine'],
          lyrics: 'my own words',
        })
      } finally {
        await query('DELETE FROM user_songs WHERE id = $1', [personal.id])
      }
    })

    it('leaves the band admin able to perform every one of the seven', async () => {
      asUser(userAId)

      await updateSongStatusAction(bandEntryId, 'mastered', bandId)
      await updateSongTagsAction(bandEntryId, ['admin-tag'], bandId)
      await updateLyricsAction(bandEntryId, 'admin lyrics', bandId)

      const added = await addSongAction(catalogSongId, bandId)
      expect(added.band_id).toBe(bandId)
      await removeSongAction(added.id, bandId)

      const created = await createAndAddSongAction(
        { title: `RH-124 Admin Created ${suffix}`, artist: 'RH-124 Artist' },
        bandId,
      )
      createdSongIds.push(created.song_id)
      expect(await bandRowsForSong(created.song_id)).toBe(1)

      const entry = (await getRepertoireAction(bandId)).find((row) => row.id === bandEntryId)
      await updateSongAction(entry!, {
        title: entry!.song!.title,
        artist: entry!.song!.artist,
        key: 'Bm',
        status: 'polishing',
        tags: ['admin-tag'],
        links: [],
      }, bandId)

      const row = (await bandRepertoire()).find((r) => r.id === bandEntryId)
      expect(row).toMatchObject({
        status: 'polishing',
        tags: ['admin-tag'],
        lyrics: 'admin lyrics',
      })
      await removeSongAction(created.id, bandId)
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

    it('no longer accepts a songs id in place of a repertoire id', async () => {
      const before = await catalogLinks()
      asUser(userAId)

      await expect(updateSongLinksAction(catalogSongId, [ORIGINAL_LINK, ADDED_LINK])).rejects.toThrow(
        'Access denied',
      )

      expect(await catalogLinks()).toBe(before)
    })

    it('writes an additive change straight through', async () => {
      const suggestionsBefore = await suggestionCount()
      asUser(userAId)

      const result = await updateSongLinksAction(personalEntryId, [ORIGINAL_LINK, ADDED_LINK])

      expect(result.success).toBe(true)
      expect(result.pending).toBeFalsy()
      expect(await catalogLinks()).toContain(ADDED_LINK.url)
      expect(await suggestionCount()).toBe(suggestionsBefore)
    })

    it('routes a removal to the moderation queue and leaves the catalog untouched', async () => {
      const before = await catalogLinks()
      asUser(userAId)

      const result = await updateSongLinksAction(personalEntryId, [ADDED_LINK])

      expect(result).toEqual({ success: true, pending: true })
      expect(await catalogLinks()).toBe(before)

      const queued = await query(
        `SELECT group_id, status, requested_by, target_column, value
         FROM catalog_suggestions WHERE target_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [catalogSongId],
      )
      expect(queued.rowCount).toBe(1)
      expect(queued.rows[0].status).toBe('pending')
      expect(queued.rows[0].requested_by).toBe(userAId)
      expect(queued.rows[0].target_column).toBe('links')
      expect(queued.rows[0].value).toEqual([ADDED_LINK])
    })

    it('applies the removal once a system admin approves it', async () => {
      const pending = await query(
        `SELECT group_id FROM catalog_suggestions
          WHERE target_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
        [catalogSongId],
      )
      asUser(adminUserId)

      await reviewCatalogSuggestionGroupAction(pending.rows[0].group_id as string, 'approve')

      expect(JSON.parse(await catalogLinks())).toEqual([ADDED_LINK])
    })
  })
})
