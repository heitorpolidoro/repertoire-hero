/**
 * RH-111 — the requester's outcome notice, against a mocked pool.
 *
 * The live-schema behaviour (what a row of each status maps to, who can see and
 * acknowledge what) is `catalogSuggestionOutcomes.db.test.ts`; this file pins
 * the pure fold and the statement shapes so they are exercised without a
 * database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { query } from '@/lib/db'
import { acknowledgeSuggestionOutcomes, getUnseenSuggestionOutcomes } from '@/lib/moderation'
import {
  ACKNOWLEDGE_SUGGESTION_OUTCOMES_SQL,
  UNSEEN_SUGGESTION_OUTCOMES_SQL,
  groupSuggestionOutcomes,
} from '@/lib/catalogSuggestionSql'
import type { SuggestionOutcomeRow } from '@/lib/dbRows'

vi.mock('@/lib/db', () => ({ query: vi.fn(), withTransaction: vi.fn() }))

function row(overrides: Partial<SuggestionOutcomeRow> = {}): SuggestionOutcomeRow {
  return {
    id: 'row-1',
    group_id: 'group-1',
    song_id: 'song-1',
    target_column: 'title',
    status: 'approved',
    rejection_reason: null,
    title: 'Blackbird',
    artist: 'The Beatles',
    ...overrides,
  }
}

describe('groupSuggestionOutcomes', () => {
  it('maps approved, rejected and superseded to approved, refused and replaced', () => {
    const [group] = groupSuggestionOutcomes([
      row({ id: 'a', target_column: 'title', status: 'approved' }),
      row({ id: 'b', target_column: 'artist', status: 'rejected', rejection_reason: 'Wrong' }),
      row({ id: 'c', target_column: 'album', status: 'superseded' }),
    ])

    expect(group.fields).toEqual([
      { id: 'a', column: 'title', outcome: 'approved', reason: null },
      { id: 'b', column: 'artist', outcome: 'refused', reason: 'Wrong' },
      { id: 'c', column: 'album', outcome: 'replaced', reason: null },
    ])
  })

  it('never carries a reason on a replaced or approved field, even if the row holds one', () => {
    const [group] = groupSuggestionOutcomes([
      row({ id: 'a', status: 'superseded', rejection_reason: 'stale' }),
      row({ id: 'b', status: 'approved', rejection_reason: 'stale' }),
    ])

    expect(group.fields.map((f) => f.reason)).toEqual([null, null])
  })

  it('keeps one entry per submission and the query order', () => {
    const groups = groupSuggestionOutcomes([
      row({ id: 'a', group_id: 'g1', song_id: 's1' }),
      row({ id: 'b', group_id: 'g2', song_id: 's2', title: 'Other' }),
      row({ id: 'c', group_id: 'g1', song_id: 's1', target_column: 'artist' }),
    ])

    expect(groups.map((g) => [g.group_id, g.fields.map((f) => f.id)])).toEqual([
      ['g1', ['a', 'c']],
      ['g2', ['b']],
    ])
    expect(groups[1]).toMatchObject({ title: 'Other', artist: 'The Beatles', song_id: 's2' })
  })

  it('returns nothing for no rows', () => {
    expect(groupSuggestionOutcomes([])).toEqual([])
  })
})

describe('outcome statements', () => {
  it('the read excludes pending and acknowledged rows and is scoped to the requester', () => {
    expect(UNSEEN_SUGGESTION_OUTCOMES_SQL).toContain('c.requested_by = $1')
    expect(UNSEEN_SUGGESTION_OUTCOMES_SQL).toContain("c.status <> 'pending'")
    expect(UNSEEN_SUGGESTION_OUTCOMES_SQL).toContain('c.acknowledged_at IS NULL')
  })

  it('the acknowledge is scoped to the requester inside the statement', () => {
    expect(ACKNOWLEDGE_SUGGESTION_OUTCOMES_SQL).toContain('requested_by = $1')
    expect(ACKNOWLEDGE_SUGGESTION_OUTCOMES_SQL).toContain('id = ANY($2::uuid[])')
    expect(ACKNOWLEDGE_SUGGESTION_OUTCOMES_SQL).toContain('acknowledged_at IS NULL')
  })
})

describe('getUnseenSuggestionOutcomes / acknowledgeSuggestionOutcomes', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset()
  })

  it('reads with the given user id as the only parameter and groups the rows', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 1, rows: [row()] } as never)

    const groups = await getUnseenSuggestionOutcomes('user-1')

    expect(query).toHaveBeenCalledWith(UNSEEN_SUGGESTION_OUTCOMES_SQL, ['user-1'])
    expect(groups).toHaveLength(1)
  })

  it('wraps a read failure in the prefixed message', async () => {
    vi.mocked(query).mockRejectedValueOnce(new Error('boom'))

    await expect(getUnseenSuggestionOutcomes('user-1')).rejects.toThrow(
      'Failed to fetch suggestion outcomes: boom',
    )
  })

  it('acknowledges by user and ids and reports the rows touched', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 2, rows: [] } as never)

    await expect(acknowledgeSuggestionOutcomes('user-1', ['a', 'b'])).resolves.toBe(2)
    expect(query).toHaveBeenCalledWith(ACKNOWLEDGE_SUGGESTION_OUTCOMES_SQL, ['user-1', ['a', 'b']])
  })

  it('issues no statement for an empty id list', async () => {
    await expect(acknowledgeSuggestionOutcomes('user-1', [])).resolves.toBe(0)
    expect(query).not.toHaveBeenCalled()
  })

  it('treats a missing rowCount as zero', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: null, rows: [] } as never)

    await expect(acknowledgeSuggestionOutcomes('user-1', ['a'])).resolves.toBe(0)
  })

  it('wraps an acknowledge failure in the prefixed message', async () => {
    vi.mocked(query).mockRejectedValueOnce(new Error('boom'))

    await expect(acknowledgeSuggestionOutcomes('user-1', ['a'])).rejects.toThrow(
      'Failed to acknowledge suggestion outcomes: boom',
    )
  })
})
