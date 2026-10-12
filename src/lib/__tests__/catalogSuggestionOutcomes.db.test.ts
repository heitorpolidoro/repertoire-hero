/**
 * RH-111 — the requester's outcome notice against the live schema.
 *
 * Seeds `catalog_suggestions` rows directly in each status (the review path has
 * its own suite in `catalogSuggestions.db.test.ts`) and pins what a requester
 * can read and acknowledge: each status maps to the right outcome, pending is
 * excluded, another user's rows are invisible and cannot be acknowledged,
 * acknowledging is idempotent, and a partly decided group lists mixed outcomes.
 *
 * Every fixture carries a `Date.now()` suffix because vitest runs files in
 * parallel workers against these shared tables.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createTestUser, deleteTestUser } from '@/lib/__tests__/test-helpers'
import { query } from '@/lib/db'
import { acknowledgeSuggestionOutcomes, getUnseenSuggestionOutcomes } from '@/lib/moderation'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

describe.skipIf(!RUN_DB_TESTS)('suggestion outcomes (real database)', () => {
  const suffix = Date.now()
  const createdSongIds = new Set<string>()

  let userId: string
  let otherUserId: string
  let songId: string

  const seedSong = async (label: string): Promise<string> => {
    const res = await query<{ id: string }>(
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [`RH-111 ${label} ${suffix}`, `RH-111 Artist ${label} ${suffix}`],
    )
    createdSongIds.add(res.rows[0].id)
    return res.rows[0].id
  }

  /** One suggestion row in the given status; returns its id. */
  const seedRow = async (opts: {
    requestedBy: string
    column: string
    status: 'pending' | 'approved' | 'rejected' | 'superseded'
    groupId?: string
    target?: string
    rejectionReason?: string | null
  }): Promise<string> => {
    const res = await query<{ id: string }>(
      `INSERT INTO catalog_suggestions
         (group_id, target_table, target_id, target_column, value, requested_by, status, rejection_reason)
       VALUES ($1, 'songs', $2, $3, $4::jsonb, $5, $6, $7)
       RETURNING id`,
      [
        opts.groupId ?? randomUUID(),
        opts.target ?? songId,
        opts.column,
        JSON.stringify('x'),
        opts.requestedBy,
        opts.status,
        opts.rejectionReason ?? null,
      ],
    )
    return res.rows[0].id
  }

  const acknowledgedAt = async (id: string): Promise<string | null> => {
    const res = await query<{ acknowledged_at: string | null }>(
      'SELECT acknowledged_at::text AS acknowledged_at FROM catalog_suggestions WHERE id = $1',
      [id],
    )
    return res.rows[0].acknowledged_at
  }

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh111-a-${suffix}@example.test` })
    otherUserId = await createTestUser({ email: `rh111-b-${suffix}@example.test` })
    songId = await seedSong('main')
  })

  afterAll(async () => {
    for (const id of createdSongIds) {
      await query(`DELETE FROM catalog_suggestions WHERE target_id = $1`, [id])
      await query('DELETE FROM songs WHERE id = $1', [id])
    }
    await deleteTestUser(userId)
    await deleteTestUser(otherUserId)
  })

  it('adds a nullable acknowledged_at column, null on a fresh row', async () => {
    const col = await query<{ is_nullable: string; data_type: string }>(
      `SELECT is_nullable, data_type FROM information_schema.columns
        WHERE table_name = 'catalog_suggestions' AND column_name = 'acknowledged_at'`,
    )
    expect(col.rows[0]).toEqual({ is_nullable: 'YES', data_type: 'timestamp with time zone' })

    const id = await seedRow({ requestedBy: userId, column: 'title', status: 'pending' })
    expect(await acknowledgedAt(id)).toBeNull()
  })

  it('maps approved, rejected and superseded to approved, refused and replaced, and excludes pending', async () => {
    const song = await seedSong('mapping')
    const groupId = randomUUID()
    const approved = await seedRow({ requestedBy: userId, column: 'title', status: 'approved', groupId, target: song })
    const rejected = await seedRow({
      requestedBy: userId,
      column: 'artist',
      status: 'rejected',
      groupId,
      target: song,
      rejectionReason: 'Not the studio take',
    })
    const superseded = await seedRow({
      requestedBy: userId,
      column: 'album',
      status: 'superseded',
      groupId,
      target: song,
      // A stray reason on a superseded row must never reach the notice.
      rejectionReason: 'should not show',
    })
    await seedRow({ requestedBy: userId, column: 'standard_key', status: 'pending', groupId, target: song })

    const groups = await getUnseenSuggestionOutcomes(userId)
    const group = groups.find((g) => g.group_id === groupId)

    expect(group).toMatchObject({ song_id: song, title: `RH-111 mapping ${suffix}` })
    expect(group?.fields.map((f) => [f.id, f.column, f.outcome, f.reason])).toEqual(
      expect.arrayContaining([
        [approved, 'title', 'approved', null],
        [rejected, 'artist', 'refused', 'Not the studio take'],
        [superseded, 'album', 'replaced', null],
      ]),
    )
    // The pending field is part of the same submission but is not a decided outcome.
    expect(group?.fields).toHaveLength(3)
  })

  it('shows a refusal with no reason as refused with a null reason', async () => {
    const song = await seedSong('noreason')
    const id = await seedRow({ requestedBy: userId, column: 'title', status: 'rejected', target: song })

    const groups = await getUnseenSuggestionOutcomes(userId)

    expect(groups.flatMap((g) => g.fields).find((f) => f.id === id)).toMatchObject({
      outcome: 'refused',
      reason: null,
    })
  })

  it("never shows another user's rows, and shows nothing for a user with no decided rows", async () => {
    const song = await seedSong('foreign')
    const foreign = await seedRow({ requestedBy: otherUserId, column: 'title', status: 'approved', target: song })

    const mine = (await getUnseenSuggestionOutcomes(userId)).flatMap((g) => g.fields.map((f) => f.id))
    const theirs = (await getUnseenSuggestionOutcomes(otherUserId)).flatMap((g) => g.fields.map((f) => f.id))

    expect(mine).not.toContain(foreign)
    expect(theirs).toContain(foreign)
  })

  it('acknowledges exactly the listed rows and leaves rows decided afterwards unseen', async () => {
    const song = await seedSong('ack')
    const first = await seedRow({ requestedBy: userId, column: 'title', status: 'approved', target: song })
    const second = await seedRow({ requestedBy: userId, column: 'artist', status: 'rejected', target: song })

    const listed = (await getUnseenSuggestionOutcomes(userId))
      .flatMap((g) => g.fields.map((f) => f.id))
      .filter((id) => id === first || id === second)
    expect(listed).toHaveLength(2)

    // Decided after the banner loaded: not in the listed ids.
    const later = await seedRow({ requestedBy: userId, column: 'album', status: 'approved', target: song })

    expect(await acknowledgeSuggestionOutcomes(userId, listed)).toBe(2)

    const after = (await getUnseenSuggestionOutcomes(userId)).flatMap((g) => g.fields.map((f) => f.id))
    expect(after).not.toContain(first)
    expect(after).not.toContain(second)
    expect(after).toContain(later)
    expect(await acknowledgedAt(later)).toBeNull()
  })

  it('is idempotent: a second acknowledge touches nothing and keeps the first stamp', async () => {
    const song = await seedSong('idem')
    const id = await seedRow({ requestedBy: userId, column: 'title', status: 'approved', target: song })

    expect(await acknowledgeSuggestionOutcomes(userId, [id])).toBe(1)
    const stamp = await acknowledgedAt(id)
    expect(stamp).not.toBeNull()

    expect(await acknowledgeSuggestionOutcomes(userId, [id])).toBe(0)
    expect(await acknowledgedAt(id)).toBe(stamp)
  })

  it("changes no row when the ids belong to another user", async () => {
    const song = await seedSong('theft')
    const victim = await seedRow({ requestedBy: otherUserId, column: 'title', status: 'approved', target: song })

    expect(await acknowledgeSuggestionOutcomes(userId, [victim])).toBe(0)

    expect(await acknowledgedAt(victim)).toBeNull()
    const stillUnseen = (await getUnseenSuggestionOutcomes(otherUserId)).flatMap((g) => g.fields.map((f) => f.id))
    expect(stillUnseen).toContain(victim)
  })

  it('does not acknowledge a pending row even when its id is listed', async () => {
    const song = await seedSong('pending')
    const id = await seedRow({ requestedBy: userId, column: 'title', status: 'pending', target: song })

    expect(await acknowledgeSuggestionOutcomes(userId, [id])).toBe(0)
    expect(await acknowledgedAt(id)).toBeNull()
  })
})
