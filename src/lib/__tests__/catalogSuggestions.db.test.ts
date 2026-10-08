/**
 * RH-107 — the moderation queue's behaviour against the live schema.
 *
 * Everything here needs a real `catalog_suggestions`: the submit fan-out, the
 * per-group approval and its single catalog write, group atomicity, the
 * supersede statement, the three verbatim refusals, and the links-only
 * approval that writes `song_links` while still advancing `songs.updated_at`.
 *
 * Every fixture carries a `Date.now()` suffix because vitest runs files in
 * parallel workers against these shared tables. No transaction-control literal
 * appears here (see `transactionGuard.test.ts`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  SONG_LINKS_CANONICAL_ORDER,
  createTestUser,
  deleteTestUser,
} from '@/lib/__tests__/test-helpers'
import { query } from '@/lib/db'
import {
  getPendingCatalogSuggestions,
  reviewCatalogSuggestionGroup,
  submitCatalogSuggestion,
} from '@/lib/moderation'
import type { SongLink } from '@/types/database'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

const UA = 'https://tabs.example/rh107-a'
const UB = 'https://tabs.example/rh107-b'
const UC = 'https://tabs.example/rh107-c'

describe.skipIf(!RUN_DB_TESTS)('catalog suggestions (real database)', () => {
  const suffix = Date.now()
  const createdSongIds = new Set<string>()

  let userId: string
  let otherUserId: string
  let adminId: string

  const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => {
    const res = await query(sql, params)
    return res.rows[0] as T
  }

  /** A catalog song, remembered for cleanup. */
  const seedSong = async (label: string): Promise<string> => {
    const row = await one<{ id: string }>(
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [`RH-107 ${label} ${suffix}`, `RH-107 Artist ${label} ${suffix}`],
    )
    createdSongIds.add(row.id)
    return row.id
  }

  const songRow = async (songId: string) =>
    one<{
      title: string
      artist: string
      album: string | null
      standard_key: string | null
      duration_seconds: number | null
      created_at: string
      updated_at: string
    }>(
      `SELECT title, artist, album, standard_key, duration_seconds,
              created_at::text AS created_at, updated_at::text AS updated_at
         FROM songs WHERE id = $1`,
      [songId],
    )

  const suggestionRows = async (songId: string) => {
    const res = await query<{
      id: string
      group_id: string
      target_column: string
      value: unknown
      reason: string | null
      status: string
      requested_by: string
      reviewed_by: string | null
      rejection_reason: string | null
    }>(
      `SELECT id, group_id, target_column, value, reason, status, requested_by,
              reviewed_by, rejection_reason
         FROM catalog_suggestions
        WHERE target_table = 'songs' AND target_id = $1
        ORDER BY created_at, target_column`,
      [songId],
    )
    return res.rows
  }

  const storedLinks = async (songId: string) => {
    const res = await query<{ label: string; url: string }>(
      `SELECT label, url FROM song_links WHERE song_id = $1 ${SONG_LINKS_CANONICAL_ORDER}`,
      [songId],
    )
    return res.rows
  }

  /** Seeds one pending suggestion row by hand, for the values a writer refuses. */
  const seedSuggestion = async (
    songId: string,
    column: string,
    value: unknown,
    options: { groupId?: string; requestedBy?: string; reason?: string | null } = {},
  ): Promise<{ id: string; groupId: string }> => {
    const groupId = options.groupId ?? randomUUID()
    const row = await one<{ id: string }>(
      `INSERT INTO catalog_suggestions
         (group_id, target_table, target_id, target_column, value, reason, requested_by)
       VALUES ($1, 'songs', $2, $3, $4::jsonb, $5, $6) RETURNING id`,
      [groupId, songId, column, JSON.stringify(value), options.reason ?? null, options.requestedBy ?? userId],
    )
    return { id: row.id, groupId }
  }

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh107-user-${suffix}@example.com` })
    otherUserId = await createTestUser({ email: `rh107-other-${suffix}@example.com` })
    adminId = await createTestUser({ email: `rh107-admin-${suffix}@example.com` })
    await query('UPDATE profiles SET is_system_admin = true WHERE id = $1', [adminId])
  })

  afterAll(async () => {
    if (createdSongIds.size > 0) {
      await query('DELETE FROM catalog_suggestions WHERE target_id = ANY($1::uuid[])', [
        Array.from(createdSongIds),
      ])
    }
    for (const user of [userId, otherUserId, adminId]) {
      if (user) await deleteTestUser(user)
    }
    if (createdSongIds.size > 0) {
      await query('DELETE FROM songs WHERE id = ANY($1::uuid[])', [Array.from(createdSongIds)])
    }
  })

  it('submits one suggestion row per proposed column, dropping non-column keys', async () => {
    const songId = await seedSong('Fan Out')

    // Three allowlisted columns, a `reason`, and a key that is not a `songs`
    // column at all. The filter is what makes this observable: unfiltered, the
    // INSERT would name `target_column = 'reason'` and `'nonsense'`, the
    // row-wise CHECK would raise 23514 and this call would reject.
    await expect(
      submitCatalogSuggestion(userId, songId, {
        title: `RH-107 Corrected ${suffix}`,
        album: 'Corrected Album',
        standard_key: 'Am',
        reason: 'the album is wrong',
        nonsense: 1,
      }),
    ).resolves.toBeDefined()

    const rows = await suggestionRows(songId)
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map((r) => r.group_id)).size).toBe(1)
    expect(rows.map((r) => r.target_column).sort()).toEqual(['album', 'standard_key', 'title'])
    for (const row of rows) {
      expect(row.reason).toBe('the album is wrong')
      expect(row.status).toBe('pending')
    }
  })

  it('approves a group: the catalog row carries every approved value and songs.updated_at advances', async () => {
    const songId = await seedSong('Approve Group')
    const submitted = await submitCatalogSuggestion(userId, songId, {
      title: `RH-107 Approved Title ${suffix}`,
      album: 'Approved Album',
    })
    const groupId = submitted[0].group_id

    // A second pending group for the **same song**, proposing a column the
    // approved group does not touch. Supersession keys on the target column and
    // is group-agnostic by design, so a bystander proposing `title` would be
    // correctly closed — that case belongs to the supersede test.
    const bystander = await submitCatalogSuggestion(otherUserId, songId, { standard_key: 'G' })

    const reviewed = await reviewCatalogSuggestionGroup(adminId, groupId, 'approve')
    expect(reviewed).toHaveLength(2)

    const song = await songRow(songId)
    expect(song.title).toBe(`RH-107 Approved Title ${suffix}`)
    expect(song.album).toBe('Approved Album')
    expect(song.updated_at > song.created_at).toBe(true)

    const rows = await suggestionRows(songId)
    for (const row of rows.filter((r) => r.group_id === groupId)) {
      expect(row.status).toBe('approved')
      expect(row.reviewed_by).toBe(adminId)
    }
    const other = rows.find((r) => r.group_id === bystander[0].group_id)
    expect(other!.status).toBe('pending')
  })

  it('leaves the catalog and every row of the group untouched when one stored value is invalid', async () => {
    const songId = await seedSong('Atomic')
    const before = await songRow(songId)

    const seeded = await seedSuggestion(songId, 'title', `RH-107 Atomic Title ${suffix}`)
    await seedSuggestion(songId, 'duration_seconds', 'abc', { groupId: seeded.groupId })

    await expect(
      reviewCatalogSuggestionGroup(adminId, seeded.groupId, 'approve'),
    ).rejects.toThrowError(
      new Error('Invalid catalog suggestion: duration_seconds must be a non-negative integer or null'),
    )

    expect(await songRow(songId)).toEqual(before)
    const rows = await suggestionRows(songId)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.status)).toEqual(['pending', 'pending'])
  })

  it('propagates a validation refusal verbatim instead of wrapping it', async () => {
    const songId = await seedSong('Verbatim Validation')
    const seeded = await seedSuggestion(songId, 'duration_seconds', 'abc')

    const error = await reviewCatalogSuggestionGroup(adminId, seeded.groupId, 'approve').catch(
      (err: unknown) => err as Error,
    )

    expect(error.message.startsWith('Invalid catalog suggestion')).toBe(true)
    expect(error.message.startsWith('Failed to')).toBe(false)
  })

  it('propagates a not-found group verbatim instead of wrapping it', async () => {
    const error = await reviewCatalogSuggestionGroup(adminId, randomUUID(), 'approve').catch(
      (err: unknown) => err as Error,
    )

    // Exact equality: changing the thrown literal without the catch filter's
    // equality arm comes back as
    // `Failed to review a catalog suggestion group: …` instead.
    expect(error.message).toBe('Catalog suggestion group not found')
  })

  it('propagates an already-reviewed group verbatim instead of wrapping it', async () => {
    const songId = await seedSong('Already Reviewed')
    const submitted = await submitCatalogSuggestion(userId, songId, { artist: 'Reviewed Artist' })
    const groupId = submitted[0].group_id

    await reviewCatalogSuggestionGroup(adminId, groupId, 'approve')
    const error = await reviewCatalogSuggestionGroup(adminId, groupId, 'approve').catch(
      (err: unknown) => err as Error,
    )

    // This is also what proves the review path reads its group with **no**
    // status filter: a `pending`-only read would answer
    // `Catalog suggestion group not found` here.
    expect(error.message).toBe('Catalog suggestion group is already reviewed')
  })

  it('supersedes the other pending suggestions for the same target column', async () => {
    const songId = await seedSong('Supersede')
    const mine = await submitCatalogSuggestion(userId, songId, { title: `RH-107 Mine ${suffix}` })
    await submitCatalogSuggestion(otherUserId, songId, { title: `RH-107 Theirs ${suffix}` })

    await reviewCatalogSuggestionGroup(adminId, mine[0].group_id, 'approve')

    const rows = await suggestionRows(songId)
    expect(rows).toHaveLength(2)
    expect(rows.filter((r) => r.status === 'approved')).toHaveLength(1)
    expect(rows.filter((r) => r.status === 'superseded')).toHaveLength(1)
    expect(rows.filter((r) => r.status === 'pending')).toHaveLength(0)

    const closed = rows.find((r) => r.status === 'superseded')!
    // `superseded`, not `rejected`, and with no reason: nobody refused the
    // value, and RH-111 has to tell the requester which of the two happened.
    expect(closed.rejection_reason).toBeNull()
  })

  it('rejects a group: records rejection_reason on every row and writes no catalog row', async () => {
    const songId = await seedSong('Reject')
    const submitted = await submitCatalogSuggestion(userId, songId, {
      title: `RH-107 Rejected Title ${suffix}`,
      album: 'Rejected Album',
    })
    const before = await songRow(songId)

    await reviewCatalogSuggestionGroup(
      adminId,
      submitted[0].group_id,
      'reject',
      'Inaccurate information',
    )

    const rows = await suggestionRows(songId)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.status).toBe('rejected')
      expect(row.rejection_reason).toBe('Inaccurate information')
      expect(row.reviewed_by).toBe(adminId)
    }
    expect(await songRow(songId)).toEqual(before)
  })

  it('refuses to read the queue for a non-admin', async () => {
    await expect(getPendingCatalogSuggestions(userId)).rejects.toThrow(/^Access denied/)
  })

  it('projects a multi-field submission back into one pending card', async () => {
    const songId = await seedSong('Grouped Read')
    const submitted = await submitCatalogSuggestion(userId, songId, {
      title: `RH-107 Grouped ${suffix}`,
      album: 'Grouped Album',
      reason: 'two fields at once',
    })

    const groups = await getPendingCatalogSuggestions(adminId)
    const card = groups.find((g) => g.group_id === submitted[0].group_id)

    expect(card).toBeDefined()
    expect(card!.song_id).toBe(songId)
    expect(card!.proposed_data).toEqual({
      title: `RH-107 Grouped ${suffix}`,
      album: 'Grouped Album',
    })
    expect(Object.keys(card!.suggestion_ids).sort()).toEqual(['album', 'title'])
    expect(card!.reason).toBe('two fields at once')
    expect(card!.requested_by).toBe(userId)
    expect(card!.song!.id).toBe(songId)
    expect(card!.requester!.id).toBe(userId)
  })

  it('approves a links-only group: song_links carries the replace-set and songs.updated_at advances', async () => {
    const songId = await seedSong('Links Only')
    const seed: SongLink[] = [
      { label: 'A', url: UA },
      { label: 'B', url: UB },
      { label: 'C', url: UC },
    ]
    for (const [index, link] of seed.entries()) {
      await query(
        'INSERT INTO song_links (song_id, url, label, position) VALUES ($1, $2, $3, $4)',
        [songId, link.url, link.label, index + 1],
      )
    }
    const before = await songRow(songId)

    const seeded = await seedSuggestion(songId, 'links', [
      { label: 'C', url: UC },
      { label: 'A', url: UA },
    ])

    const reviewed = await reviewCatalogSuggestionGroup(adminId, seeded.groupId, 'approve')

    // (a) the replace-set, in canonical read order: the approved array's order,
    // not the pre-approval one.
    expect((await storedLinks(songId)).map((row) => row.url)).toEqual([UC, UA])
    // (b) the group contributes **zero** `SET` clauses and still issues the
    // statement, so the timestamp bump happens. Skipping the statement for an
    // empty clause list leaves this where it was.
    expect((await songRow(songId)).updated_at > before.updated_at).toBe(true)
    // (c) and the row is approved rather than left pending.
    expect(reviewed.map((row) => row.status)).toEqual(['approved'])
    // Nothing wrote `songs.links`: the column is not in the clause list at all.
    const column = await one<{ links: unknown[] }>('SELECT links FROM songs WHERE id = $1', [songId])
    expect(column.links).toEqual([])
  })
})
