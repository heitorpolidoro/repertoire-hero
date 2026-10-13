/**
 * RH-141 — the grouped correction review against the live schema: identical
 * proposals collapse to one option, approving an option decides the whole field,
 * rejecting a field closes it, and every path refuses a non-admin.
 *
 * Every fixture carries a `Date.now()` suffix because vitest runs files in
 * parallel workers against these shared tables. No transaction-control literal
 * appears here (see `transactionGuard.test.ts`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createTestUser, deleteTestUser } from '@/lib/__tests__/test-helpers'
import { query } from '@/lib/db'
import { reviewCatalogSuggestionGroup, submitCatalogSuggestion } from '@/lib/moderation'
import {
  approveCatalogFieldOption,
  getPendingFieldGroups,
  rejectCatalogField,
} from '@/lib/moderationFields'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

describe.skipIf(!RUN_DB_TESTS)('grouped correction review (real database)', () => {
  const suffix = Date.now()
  const createdSongIds = new Set<string>()
  let requesters: string[]
  let adminId: string
  let plainUserId: string

  const seedSong = async (label: string): Promise<string> => {
    const res = await query<{ id: string }>(
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [`RH-141 ${label} ${suffix}`, `RH-141 Artist ${label} ${suffix}`],
    )
    createdSongIds.add(res.rows[0].id)
    return res.rows[0].id
  }

  /** One pending `songs` suggestion row, each its own submission. */
  const seedSuggestion = async (
    songId: string,
    column: string,
    value: unknown,
    requestedBy: string,
  ): Promise<string> => {
    const res = await query<{ id: string }>(
      `INSERT INTO catalog_suggestions
         (group_id, target_table, target_id, target_column, value, requested_by)
       VALUES ($1, 'songs', $2, $3, $4::jsonb, $5) RETURNING id`,
      [randomUUID(), songId, column, JSON.stringify(value), requestedBy],
    )
    return res.rows[0].id
  }

  /** Five identical `standard_key` proposals, one different, one in another column. */
  const seedContested = async (label: string) => {
    const songId = await seedSong(label)
    const five: string[] = []
    for (let i = 0; i < 5; i++) {
      five.push(await seedSuggestion(songId, 'standard_key', 'Bm', requesters[i]))
    }
    await query("UPDATE catalog_suggestions SET reason = 'it is Bm' WHERE id = $1", [five[0]])
    const other = await seedSuggestion(songId, 'standard_key', 'Am', requesters[5])
    const title = await seedSuggestion(songId, 'title', `RH-141 Retitled ${label} ${suffix}`, requesters[0])
    return { songId, five, other, title }
  }

  const statuses = async (ids: string[]) => {
    const res = await query<{ id: string; status: string; reviewed_by: string | null; rejection_reason: string | null }>(
      'SELECT id, status, reviewed_by, rejection_reason FROM catalog_suggestions WHERE id = ANY($1::uuid[])',
      [ids],
    )
    return new Map(res.rows.map((row) => [row.id, row]))
  }

  const songRow = async (songId: string) => {
    const res = await query<{ title: string; standard_key: string | null; updated_at: string }>(
      'SELECT title, standard_key, updated_at::text AS updated_at FROM songs WHERE id = $1',
      [songId],
    )
    return res.rows[0]
  }

  beforeAll(async () => {
    requesters = []
    for (let i = 0; i < 6; i++) {
      requesters.push(await createTestUser({ email: `rh141-req${i}-${suffix}@example.com` }))
    }
    await query('UPDATE profiles SET full_name = $2 WHERE id = $1', [requesters[0], `Maria ${suffix}`])
    await query("UPDATE profiles SET full_name = '  ' WHERE id = $1", [requesters[2]])
    adminId = await createTestUser({ email: `rh141-admin-${suffix}@example.com` })
    await query('UPDATE profiles SET is_system_admin = true WHERE id = $1', [adminId])
    plainUserId = await createTestUser({ email: `rh141-plain-${suffix}@example.com` })
  })

  afterAll(async () => {
    for (const user of [...requesters, adminId, plainUserId]) {
      if (user) await deleteTestUser(user)
    }
    if (createdSongIds.size > 0) {
      await query('DELETE FROM songs WHERE id = ANY($1::uuid[])', [Array.from(createdSongIds)])
    }
  })

  describe('the grouped read (ER1)', () => {
    it('reads five identical proposals and one different as two options, 5 then 1', async () => {
      const { songId, five, other } = await seedContested('Read')

      const groups = await getPendingFieldGroups(adminId)
      const key = groups.find((g) => g.song_id === songId && g.target_column === 'standard_key')!

      expect(key.options.map((o) => [o.value, o.count])).toEqual([
        ['Bm', 5],
        ['Am', 1],
      ])
      expect(key.total).toBe(6)
      expect(key.current_value).toBeNull()
      expect(key.song_title).toBe(`RH-141 Read ${suffix}`)
      expect([...key.options[0].suggestion_ids].sort()).toEqual([...five].sort())
      expect(key.options[1].suggestion_ids).toEqual([other])
      expect(key.options[0].requesters).toHaveLength(5)
      expect(key.options[0].requesters[0]).toEqual({ id: requesters[0], name: `Maria ${suffix}` })
      expect(key.options[0].requesters[1].id).toBe(requesters[1])
      // A blank full name falls back to the email.
      expect(key.options[0].requesters[2].name).toBe(`rh141-req2-${suffix}@example.com`)
      expect(key.options[0].reasons).toEqual(['it is Bm'])
      expect(key.options[1].reasons).toEqual([])
      // The other column is its own target.
      const title = groups.filter((g) => g.song_id === songId && g.target_column === 'title')
      expect(title).toHaveLength(1)
      expect(title[0].options).toHaveLength(1)
    })

    it('keeps a proposed null as its own option and ignores decided rows', async () => {
      const songId = await seedSong('Null')
      await seedSuggestion(songId, 'album', null, requesters[0])
      await seedSuggestion(songId, 'album', 'Some Album', requesters[1])
      const decided = await seedSuggestion(songId, 'artist', 'Gone', requesters[2])
      await query("UPDATE catalog_suggestions SET status = 'rejected' WHERE id = $1", [decided])

      const groups = (await getPendingFieldGroups(adminId)).filter((g) => g.song_id === songId)

      expect(groups.map((g) => g.target_column)).toEqual(['album'])
      expect(groups[0].options).toHaveLength(2)
      expect(groups[0].options.map((o) => o.value)).toEqual(expect.arrayContaining([null, 'Some Album']))
    })

    it('leaves link-row suggestions out of the field read', async () => {
      const songId = await seedSong('No Links')
      const link = await query<{ id: string }>(
        "INSERT INTO song_links (song_id, url, label, position) VALUES ($1, 'https://tabs.example/rh141-x', 'X', 1) RETURNING id",
        [songId],
      )
      await submitCatalogSuggestion(requesters[0], songId, {
        linkChanges: [{ linkId: link.rows[0].id, label: 'X!' }],
      })

      expect((await getPendingFieldGroups(adminId)).filter((g) => g.song_id === songId)).toEqual([])
    })

    it('refuses a non-admin', async () => {
      await expect(getPendingFieldGroups(plainUserId)).rejects.toThrow(/^Access denied/)
    })
  })

  describe('approving an option (ER2, ER3)', () => {
    it('applies the value, approves its rows, supersedes the rest, spares other columns', async () => {
      const { songId, five, other, title } = await seedContested('Approve')
      const before = await songRow(songId)

      const outcome = await approveCatalogFieldOption(adminId, five)

      expect(outcome).toEqual({ approved: 5, superseded: 1 })
      const after = await songRow(songId)
      expect(after.standard_key).toBe('Bm')
      expect(after.title).toBe(before.title)
      expect(after.updated_at > before.updated_at).toBe(true)
      const rows = await statuses([...five, other, title])
      for (const id of five) {
        expect(rows.get(id)).toMatchObject({ status: 'approved', reviewed_by: adminId })
      }
      expect(rows.get(other)).toMatchObject({ status: 'superseded', reviewed_by: adminId })
      expect(rows.get(title)!.status).toBe('pending')
    })

    it('approves rows of the same value that arrived after the screen loaded', async () => {
      const songId = await seedSong('Late')
      const seen = await seedSuggestion(songId, 'standard_key', 'C', requesters[0])
      const late = await seedSuggestion(songId, 'standard_key', 'C', requesters[1])

      const outcome = await approveCatalogFieldOption(adminId, [seen])

      expect(outcome).toEqual({ approved: 2, superseded: 0 })
      expect((await statuses([late])).get(late)!.status).toBe('approved')
    })

    it('aborts on an invalid value with every row still pending', async () => {
      const songId = await seedSong('Invalid')
      const bad = await seedSuggestion(songId, 'duration_seconds', 'abc', requesters[0])
      const bad2 = await seedSuggestion(songId, 'duration_seconds', 'abc', requesters[1])
      const good = await seedSuggestion(songId, 'duration_seconds', 120, requesters[2])
      const before = await songRow(songId)

      await expect(approveCatalogFieldOption(adminId, [bad, bad2])).rejects.toThrow(
        /^Invalid catalog suggestion: duration_seconds/,
      )

      const rows = await statuses([bad, bad2, good])
      expect([...rows.values()].map((r) => r.status)).toEqual(['pending', 'pending', 'pending'])
      expect(await songRow(songId)).toEqual(before)
    })

    it('says "already reviewed" for an option someone else decided, and writes nothing', async () => {
      const { songId, five, other } = await seedContested('Stale')
      await approveCatalogFieldOption(adminId, five)
      const settled = await songRow(songId)

      await expect(approveCatalogFieldOption(adminId, [other])).rejects.toThrow(
        'Catalog suggestion is already reviewed',
      )

      expect(await songRow(songId)).toEqual(settled)
    })

    it('refuses an unknown id, an empty list and a mixed selection', async () => {
      const { five, other, title } = await seedContested('Refusals')

      await expect(approveCatalogFieldOption(adminId, [randomUUID()])).rejects.toThrow(
        'Catalog suggestion not found',
      )
      await expect(approveCatalogFieldOption(adminId, [])).rejects.toThrow(/^Invalid catalog suggestion/)
      await expect(approveCatalogFieldOption(adminId, [five[0], other])).rejects.toThrow(
        /^Invalid catalog suggestion: the named suggestions are not one option/,
      )
      await expect(approveCatalogFieldOption(adminId, [five[0], title])).rejects.toThrow(
        /not one option/,
      )
      expect((await statuses(five)).get(five[0])!.status).toBe('pending')
    })

    it('refuses a non-admin and changes nothing', async () => {
      const { songId, five } = await seedContested('Plain Approve')

      await expect(approveCatalogFieldOption(plainUserId, five)).rejects.toThrow(/^Access denied/)

      expect((await songRow(songId)).standard_key).toBeNull()
      expect((await statuses(five)).get(five[0])!.status).toBe('pending')
    })

    it('decides a links correction through the link-only review: writes song_links, bumps updated_at', async () => {
      const songId = await seedSong('Links')
      const link = await query<{ id: string }>(
        "INSERT INTO song_links (song_id, url, label, position) VALUES ($1, 'https://tabs.example/rh141-l', 'L', 1) RETURNING id",
        [songId],
      )
      const [column, linkRow] = await submitCatalogSuggestion(requesters[0], songId, {
        standard_key: 'D',
        linkChanges: [{ linkId: link.rows[0].id, label: 'L renamed' }],
      }).then((rows) => [
        rows.find((r) => r.target_table === 'songs')!,
        rows.find((r) => r.target_table === 'song_links')!,
      ])
      const before = await songRow(songId)

      await reviewCatalogSuggestionGroup(adminId, linkRow.group_id, 'approve', { linksOnly: true })

      const label = await query<{ label: string }>('SELECT label FROM song_links WHERE id = $1', [link.rows[0].id])
      expect(label.rows[0].label).toBe('L renamed')
      const after = await songRow(songId)
      expect(after.updated_at > before.updated_at).toBe(true)
      expect(after.standard_key).toBeNull()
      const rows = await statuses([column.id, linkRow.id])
      expect(rows.get(linkRow.id)!.status).toBe('approved')
      expect(rows.get(column.id)!.status).toBe('pending')
    })

    it('rejects only the link rows of a mixed submission in link-only mode', async () => {
      const songId = await seedSong('Links Reject')
      const link = await query<{ id: string }>(
        "INSERT INTO song_links (song_id, url, label, position) VALUES ($1, 'https://tabs.example/rh141-r', 'R', 1) RETURNING id",
        [songId],
      )
      const rows = await submitCatalogSuggestion(requesters[0], songId, {
        standard_key: 'E',
        linkChanges: [{ linkId: link.rows[0].id, removed: true }],
      })
      const column = rows.find((r) => r.target_table === 'songs')!
      const linkRow = rows.find((r) => r.target_table === 'song_links')!

      await reviewCatalogSuggestionGroup(adminId, linkRow.group_id, 'reject', {
        reason: 'keep it',
        linksOnly: true,
      })

      const after = await statuses([column.id, linkRow.id])
      expect(after.get(linkRow.id)).toMatchObject({ status: 'rejected', rejection_reason: 'keep it' })
      expect(after.get(column.id)!.status).toBe('pending')
    })
  })

  describe('rejecting a field (ER4)', () => {
    it('rejects every pending row of the column with the reason and leaves songs unchanged', async () => {
      const { songId, five, other, title } = await seedContested('Reject')
      const before = await songRow(songId)

      const count = await rejectCatalogField(adminId, songId, 'standard_key', '  not the studio key  ')

      expect(count).toBe(6)
      expect(await songRow(songId)).toEqual(before)
      const rows = await statuses([...five, other, title])
      for (const id of [...five, other]) {
        expect(rows.get(id)).toMatchObject({
          status: 'rejected',
          reviewed_by: adminId,
          rejection_reason: 'not the studio key',
        })
      }
      expect(rows.get(title)!.status).toBe('pending')
    })

    it('stores no reason when none is given, and says "already reviewed" the second time', async () => {
      const { songId, other } = await seedContested('Reject Twice')

      await rejectCatalogField(adminId, songId, 'standard_key')

      expect((await statuses([other])).get(other)!.rejection_reason).toBeNull()
      await expect(rejectCatalogField(adminId, songId, 'standard_key')).rejects.toThrow(
        'Catalog suggestion is already reviewed',
      )
    })

    it('refuses a non-admin and changes nothing', async () => {
      const { songId, five } = await seedContested('Plain Reject')

      await expect(rejectCatalogField(plainUserId, songId, 'standard_key')).rejects.toThrow(/^Access denied/)

      expect((await statuses(five)).get(five[0])!.status).toBe('pending')
    })
  })
})
