/**
 * RH-138 — a links correction acts per `song_links` row, against the live
 * schema (ER3-ER6) and over a replayed migration (ER8).
 *
 * Every claim is about what Postgres ends up holding: which rows the submit
 * fan-out wrote, which `song_links` row an approval moved, and what a refusal
 * left behind. A mocked `pg` cannot show the second half, which is the one that
 * matters: the old writer was a replace-set, and a replace-set that only touched
 * one row would pass every statement-shape assertion.
 *
 * Every fixture carries a `Date.now()` suffix because vitest runs files in
 * parallel workers against these shared tables.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { query, withTransaction, type Queryable } from '@/lib/db'
import {
  SONG_LINKS_CANONICAL_ORDER,
  createTestUser,
  deleteTestUser,
  legacyModerationQueueReplayDdl,
  migrationSqlBySuffix,
} from '@/lib/__tests__/test-helpers'
import {
  getPendingCatalogSuggestions,
  reviewCatalogSuggestionGroup,
  submitCatalogSuggestion,
} from '@/lib/moderation'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

const UA = 'https://tabs.example/rh138-a'
const UB = 'https://tabs.example/rh138-b'
const UC = 'https://tabs.example/rh138-c'

interface StoredLink {
  id: string
  url: string
  label: string
  position: number
}

describe.skipIf(!RUN_DB_TESTS)('per-row link suggestions (real database)', () => {
  const suffix = Date.now()
  const createdSongIds = new Set<string>()
  let userId: string
  let adminId: string

  /** A catalog song with links A, B, C at positions 1-3, remembered for cleanup. */
  const seedSong = async (label: string): Promise<{ songId: string; rows: StoredLink[] }> => {
    const song = await query<{ id: string }>(
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [`RH-138 ${label} ${suffix}`, `RH-138 Artist ${label} ${suffix}`],
    )
    const songId = song.rows[0].id
    createdSongIds.add(songId)
    for (const [index, [url, linkLabel]] of [[UA, 'A'], [UB, 'B'], [UC, 'C']].entries()) {
      await query(
        'INSERT INTO song_links (song_id, url, label, position) VALUES ($1, $2, $3, $4)',
        [songId, url, linkLabel, index + 1],
      )
    }
    return { songId, rows: await storedLinks(songId) }
  }

  const storedLinks = async (songId: string): Promise<StoredLink[]> => {
    const res = await query<StoredLink>(
      `SELECT id, url, label, position FROM song_links WHERE song_id = $1 ${SONG_LINKS_CANONICAL_ORDER}`,
      [songId],
    )
    return res.rows
  }

  const suggestionRows = async (groupId: string) => {
    const res = await query<{
      id: string
      target_table: string
      target_id: string
      target_column: string
      value: unknown
      status: string
    }>(
      `SELECT id, target_table, target_id, target_column, value, status
         FROM catalog_suggestions WHERE group_id = $1 ORDER BY target_column`,
      [groupId],
    )
    return res.rows
  }

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh138-user-${suffix}@example.com` })
    adminId = await createTestUser({ email: `rh138-admin-${suffix}@example.com` })
    await query('UPDATE profiles SET is_system_admin = true WHERE id = $1', [adminId])
  })

  afterAll(async () => {
    // The requester's rows go with the user (ON DELETE CASCADE on requested_by).
    for (const user of [userId, adminId]) {
      if (user) await deleteTestUser(user)
    }
    if (createdSongIds.size > 0) {
      await query('DELETE FROM songs WHERE id = ANY($1::uuid[])', [Array.from(createdSongIds)])
    }
  })

  it('stores one song_links row per change, keyed by the link id, in one group (ER3)', async () => {
    const { songId, rows } = await seedSong('Fan Out')

    const submitted = await submitCatalogSuggestion(userId, songId, {
      linkChanges: [
        { linkId: rows[0].id, removed: true },
        { linkId: rows[1].id, url: 'https://tabs.example/rh138-b2', label: 'B2' },
      ],
      reason: 'cleanup',
    })

    expect(submitted).toHaveLength(3)
    expect(new Set(submitted.map((row) => row.group_id)).size).toBe(1)
    const stored = await suggestionRows(submitted[0].group_id)
    expect(stored.map((row) => [row.target_table, row.target_id, row.target_column])).toEqual([
      ['song_links', rows[1].id, 'label'],
      ['song_links', rows[0].id, 'removed'],
      ['song_links', rows[1].id, 'url'],
    ])
    expect(stored.every((row) => row.status === 'pending')).toBe(true)
  })

  it('shares the group with a song-column row of the same submission', async () => {
    const { songId, rows } = await seedSong('Mixed Group')

    const submitted = await submitCatalogSuggestion(userId, songId, {
      artist: `RH-138 Corrected ${suffix}`,
      linkChanges: [{ linkId: rows[2].id, label: 'C!' }],
    })

    expect(new Set(submitted.map((row) => row.group_id)).size).toBe(1)
    expect(submitted.map((row) => row.target_table).sort()).toEqual(['song_links', 'songs'])
  })

  it('refuses a link that belongs to another song, writing nothing', async () => {
    const mine = await seedSong('Mine')
    const theirs = await seedSong('Theirs')

    await expect(
      submitCatalogSuggestion(userId, mine.songId, {
        linkChanges: [{ linkId: theirs.rows[0].id, removed: true }],
      }),
    ).rejects.toThrowError(/^Invalid catalog suggestion: /)

    const leftover = await query(
      'SELECT 1 FROM catalog_suggestions WHERE target_id = $1',
      [theirs.rows[0].id],
    )
    expect(leftover.rowCount).toBe(0)
  })

  describe('approving moves only the named row (ER4)', () => {
    it('a removal deletes that row and leaves every other id, position and value', async () => {
      const { songId, rows } = await seedSong('Approve Removal')
      const [row] = await submitCatalogSuggestion(userId, songId, {
        linkChanges: [{ linkId: rows[1].id, removed: true }],
      })

      await reviewCatalogSuggestionGroup(adminId, row.group_id, 'approve')

      expect(await storedLinks(songId)).toEqual([rows[0], rows[2]])
    })

    it('a url edit rewrites that url in place', async () => {
      const { songId, rows } = await seedSong('Approve Url')
      const [row] = await submitCatalogSuggestion(userId, songId, {
        linkChanges: [{ linkId: rows[1].id, url: 'https://tabs.example/rh138-moved' }],
      })

      await reviewCatalogSuggestionGroup(adminId, row.group_id, 'approve')

      expect(await storedLinks(songId)).toEqual([
        rows[0],
        { ...rows[1], url: 'https://tabs.example/rh138-moved' },
        rows[2],
      ])
    })

    it('a label edit renames that row in place', async () => {
      const { songId, rows } = await seedSong('Approve Label')
      const [row] = await submitCatalogSuggestion(userId, songId, {
        linkChanges: [{ linkId: rows[2].id, label: 'C renamed' }],
      })

      await reviewCatalogSuggestionGroup(adminId, row.group_id, 'approve')

      expect(await storedLinks(songId)).toEqual([rows[0], rows[1], { ...rows[2], label: 'C renamed' }])
    })

    it('advances the song timestamp even though no songs column was proposed', async () => {
      const { songId, rows } = await seedSong('Approve Timestamp')
      const before = await query<{ updated_at: string }>(
        'SELECT updated_at::text AS updated_at FROM songs WHERE id = $1',
        [songId],
      )
      const [row] = await submitCatalogSuggestion(userId, songId, {
        linkChanges: [{ linkId: rows[0].id, label: 'A!' }],
      })

      await reviewCatalogSuggestionGroup(adminId, row.group_id, 'approve')

      const after = await query<{ updated_at: string }>(
        'SELECT updated_at::text AS updated_at FROM songs WHERE id = $1',
        [songId],
      )
      expect(after.rows[0].updated_at > before.rows[0].updated_at).toBe(true)
    })
  })

  it('rejecting one link row approves the rest and leaves that link unchanged (ER5)', async () => {
    const { songId, rows } = await seedSong('Per Row Verdict')
    const submitted = await submitCatalogSuggestion(userId, songId, {
      linkChanges: [
        { linkId: rows[0].id, removed: true },
        { linkId: rows[1].id, label: 'B renamed' },
      ],
    })
    const removal = submitted.find((row) => row.target_column === 'removed')!

    const reviewed = await reviewCatalogSuggestionGroup(adminId, removal.group_id, 'approve', {
      reason: 'keep this one',
      rejectLinkSuggestionIds: [removal.id],
    })

    expect(await storedLinks(songId)).toEqual([rows[0], { ...rows[1], label: 'B renamed' }, rows[2]])
    const byColumn = Object.fromEntries(
      (await suggestionRows(removal.group_id)).map((row) => [row.target_column, row.status]),
    )
    expect(byColumn).toEqual({ removed: 'rejected', label: 'approved' })
    expect(reviewed).toHaveLength(2)
    const reason = await query<{ rejection_reason: string | null }>(
      'SELECT rejection_reason FROM catalog_suggestions WHERE id = $1',
      [removal.id],
    )
    expect(reason.rows[0].rejection_reason).toBe('keep this one')
  })

  it('refuses a colliding url edit before any write and leaves the group pending (ER6)', async () => {
    const { songId, rows } = await seedSong('Collision')
    const submitted = await submitCatalogSuggestion(userId, songId, {
      linkChanges: [
        { linkId: rows[0].id, url: UB },
        { linkId: rows[2].id, label: 'C renamed' },
      ],
    })

    await expect(
      reviewCatalogSuggestionGroup(adminId, submitted[0].group_id, 'approve'),
    ).rejects.toThrowError(/^Invalid catalog suggestion: /)

    // The label edit, which would have landed on its own, did not.
    expect(await storedLinks(songId)).toEqual(rows)
    expect((await suggestionRows(submitted[0].group_id)).map((row) => row.status)).toEqual([
      'pending',
      'pending',
    ])
  })

  it('supersedes the competitors of what it approved, and only those', async () => {
    const { songId, rows } = await seedSong('Supersede')
    const [labelA] = await submitCatalogSuggestion(userId, songId, {
      linkChanges: [{ linkId: rows[0].id, label: 'first' }],
    })
    const [labelB] = await submitCatalogSuggestion(userId, songId, {
      linkChanges: [{ linkId: rows[0].id, label: 'second' }],
    })
    const [urlEdit] = await submitCatalogSuggestion(userId, songId, {
      linkChanges: [{ linkId: rows[0].id, url: 'https://tabs.example/rh138-other' }],
    })

    await reviewCatalogSuggestionGroup(adminId, labelA.group_id, 'approve')

    // Same (link, column): closed. A different column on the same link: left alone.
    expect((await suggestionRows(labelB.group_id))[0].status).toBe('superseded')
    expect((await suggestionRows(urlEdit.group_id))[0].status).toBe('pending')

    const [removal] = await submitCatalogSuggestion(userId, songId, {
      linkChanges: [{ linkId: rows[0].id, removed: true }],
    })
    await reviewCatalogSuggestionGroup(adminId, removal.group_id, 'approve')

    // The row is gone, so every other pending suggestion on it is closed.
    expect((await suggestionRows(urlEdit.group_id))[0].status).toBe('superseded')
  })

  it('projects link rows into the pending queue as a list, with the row as it stands', async () => {
    const { songId, rows } = await seedSong('Queue Read')
    await submitCatalogSuggestion(userId, songId, {
      linkChanges: [
        { linkId: rows[0].id, removed: true },
        { linkId: rows[1].id, url: 'https://tabs.example/rh138-q' },
      ],
    })

    const groups = await getPendingCatalogSuggestions(adminId)
    const card = groups.find((group) => group.song_id === songId)

    expect(card).toBeDefined()
    expect(card!.proposed_data).toEqual({})
    expect(card!.link_changes.map((change) => [change.link_id, change.column, change.current.url])).toEqual(
      expect.arrayContaining([
        [rows[0].id, 'removed', UA],
        [rows[1].id, 'url', UB],
      ]),
    )
    expect(card!.link_changes).toHaveLength(2)
  })
})

/** The stable half of the migration names; their four-digit prefixes may move. */
const QUEUE_MIGRATION_SUFFIX = '_catalog_suggestions.sql'
const LINK_ROWS_MIGRATION_SUFFIX = '_link_row_suggestions.sql'
const ROLLBACK = 'RH-138 migration scenario rollback'

describe.skipIf(!RUN_DB_TESTS)('the link-row migration over a pending (songs, links) row (ER8)', () => {
  it('supersedes the whole-array proposal and admits the song_links pairs', async () => {
    const token = randomUUID().replace(/-/g, '').slice(0, 12)
    const schema = `rh138_${token}`
    let seen: Array<{ target_table: string; target_column: string; status: string }> = []
    let closed: { reviewed_by: string | null; rejection_reason: string | null } | undefined

    await withTransaction(async (client: Queryable) => {
      await client.query(legacyModerationQueueReplayDdl(schema))
      await client.query(`SET LOCAL search_path = ${schema}, public`)
      await client.query(migrationSqlBySuffix(QUEUE_MIGRATION_SUFFIX))

      const requesterId = randomUUID()
      await client.query('INSERT INTO profiles (id, email) VALUES ($1, $2)', [
        requesterId,
        `rh138-requester-${token}@example.com`,
      ])
      const songId = (
        await client.query<{ id: string }>(
          'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
          [`RH-138 Song ${token}`, 'RH-138 Artist'],
        )
      ).rows[0].id
      const insert = `INSERT INTO catalog_suggestions
          (group_id, target_table, target_id, target_column, value, requested_by, status)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`
      // The whole-array proposal this migration retires, and a decided one that
      // must survive as history.
      await client.query(insert, [randomUUID(), 'songs', songId, 'links', '[]', requesterId, 'pending'])
      await client.query(insert, [randomUUID(), 'songs', songId, 'links', '[]', requesterId, 'approved'])
      await client.query(insert, [randomUUID(), 'songs', songId, 'title', '"T"', requesterId, 'pending'])

      await client.query(migrationSqlBySuffix(LINK_ROWS_MIGRATION_SUFFIX))

      // The new pairs are admitted.
      for (const column of ['url', 'label', 'removed']) {
        await client.query(insert, [randomUUID(), 'song_links', randomUUID(), column, 'true', requesterId, 'pending'])
      }

      seen = (
        await client.query<{ target_table: string; target_column: string; status: string }>(
          `SELECT target_table, target_column, status FROM catalog_suggestions
            WHERE target_table = 'songs' ORDER BY target_column, status`,
        )
      ).rows
      closed = (
        await client.query<{ reviewed_by: string | null; rejection_reason: string | null }>(
          `SELECT reviewed_by::text AS reviewed_by, rejection_reason FROM catalog_suggestions
            WHERE target_table = 'songs' AND target_column = 'links' AND status = 'superseded'`,
        )
      ).rows[0]
      throw new Error(ROLLBACK)
    }).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== ROLLBACK) throw error
    })

    expect(seen).toEqual([
      { target_table: 'songs', target_column: 'links', status: 'approved' },
      { target_table: 'songs', target_column: 'links', status: 'superseded' },
      { target_table: 'songs', target_column: 'title', status: 'pending' },
    ])
    expect(closed).toEqual({ reviewed_by: null, rejection_reason: null })
  })
})
