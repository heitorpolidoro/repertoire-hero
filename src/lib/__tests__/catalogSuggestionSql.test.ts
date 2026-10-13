/**
 * RH-138 — the statement text the per-row link model depends on. Pure: nothing
 * here touches a database; the DB-backed behaviour is in
 * `linkRowSuggestions.db.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import {
  APPROVE_LINK_ROWS_SQL,
  APPROVE_SUGGESTION_GROUP_SQL,
  PENDING_LINK_GROUPS_SQL,
  PENDING_SUGGESTION_GROUPS_SQL,
  REJECT_LINK_ROWS_SQL,
  REJECT_SUGGESTION_GROUP_SQL,
  SUPERSEDE_LINK_SUGGESTIONS_SQL,
  suggestionInsert,
} from '@/lib/catalogSuggestionSql'
import {
  APPROVE_FIELD_VALUE_SQL,
  PENDING_FIELD_GROUPS_SQL,
  REJECT_FIELD_SQL,
  SUGGESTION_ROWS_FOR_UPDATE_SQL,
} from '@/lib/catalogFieldSql'

describe('suggestionInsert', () => {
  it('binds the table and target per entry, with one group, requester and reason', () => {
    const insert = suggestionInsert({ groupId: 'g', requestedBy: 'u', reason: 'why' }, [
      { table: 'songs', targetId: 'song-1', column: 'title', value: 'T' },
      { table: 'song_links', targetId: 'link-1', column: 'removed', value: true },
      { table: 'song_links', targetId: 'link-2', column: 'label', value: undefined },
    ])
    expect(insert.params).toEqual([
      'g', 'u', 'why',
      'songs', 'song-1', 'title', '"T"',
      'song_links', 'link-1', 'removed', 'true',
      'song_links', 'link-2', 'label', 'null',
    ])
    expect(insert.sql).toContain('($1, $4, $5::uuid, $6, $7::jsonb, $3, $2, \'pending\')')
    expect(insert.sql).toContain('($1, $8, $9::uuid, $10, $11::jsonb, $3, $2, \'pending\')')
    expect(insert.sql).toContain('($1, $12, $13::uuid, $14, $15::jsonb, $3, $2, \'pending\')')
    expect(insert.sql).toContain('RETURNING *')
  })
})

describe('PENDING_SUGGESTION_GROUPS_SQL', () => {
  it('projects link rows as a list, apart from the songs-column aggregate', () => {
    // The columns would collide in `jsonb_object_agg` (two `url` rows), so the
    // object aggregates are restricted to `songs` rows and links are listed.
    expect(PENDING_SUGGESTION_GROUPS_SQL).toContain("FILTER (WHERE c.target_table = 'songs')")
    expect(PENDING_SUGGESTION_GROUPS_SQL).toContain("FILTER (WHERE c.target_table = 'song_links')")
    expect(PENDING_SUGGESTION_GROUPS_SQL).toContain("'suggestion_id', c.id")
    expect(PENDING_SUGGESTION_GROUPS_SQL).toContain('sl.id = cs.target_id')
  })
})

// RH-141 - the link-only variants are derived by text substitution, so each
// test pins that the substitution actually landed (a silent no-op `replace`
// would leave the songs rows in the link screen).
describe('link-rows-only variants (RH-141)', () => {
  it('restricts the per-submission read to song_links rows, and nothing else', () => {
    expect(PENDING_LINK_GROUPS_SQL).not.toBe(PENDING_SUGGESTION_GROUPS_SQL)
    expect(PENDING_LINK_GROUPS_SQL).toContain("WHERE cs.status = 'pending' AND cs.target_table = 'song_links'")
    expect(PENDING_LINK_GROUPS_SQL.replace(" AND cs.target_table = 'song_links'", '')).toBe(
      PENDING_SUGGESTION_GROUPS_SQL,
    )
  })

  it('restricts the group approve and reject to song_links rows', () => {
    for (const [linkSql, groupSql] of [
      [APPROVE_LINK_ROWS_SQL, APPROVE_SUGGESTION_GROUP_SQL],
      [REJECT_LINK_ROWS_SQL, REJECT_SUGGESTION_GROUP_SQL],
    ]) {
      expect(linkSql).toContain("AND status = 'pending' AND target_table = 'song_links'")
      expect(linkSql.replace(" AND target_table = 'song_links'", '')).toBe(groupSql)
    }
  })
})

describe('field statements (RH-141)', () => {
  it('reads only pending songs rows, grouped by value and ordered by count', () => {
    expect(PENDING_FIELD_GROUPS_SQL).toContain("cs.status = 'pending' AND cs.target_table = 'songs'")
    expect(PENDING_FIELD_GROUPS_SQL).toContain('GROUP BY song_id, target_column, current_value, value')
    expect(PENDING_FIELD_GROUPS_SQL).toContain('ORDER BY o.count DESC')
  })

  it('locks the named rows without a status filter', () => {
    expect(SUGGESTION_ROWS_FOR_UPDATE_SQL).toContain('FOR UPDATE')
    expect(SUGGESTION_ROWS_FOR_UPDATE_SQL).not.toContain('status')
  })

  it('approves and rejects by target column, pending rows only', () => {
    expect(APPROVE_FIELD_VALUE_SQL).toContain('IS NOT DISTINCT FROM')
    expect(APPROVE_FIELD_VALUE_SQL).toContain("status = 'pending'")
    expect(REJECT_FIELD_SQL).toContain("status = 'rejected'")
    expect(REJECT_FIELD_SQL).toContain("status = 'pending'")
    expect(REJECT_FIELD_SQL).not.toContain('value')
  })
})

describe('SUPERSEDE_LINK_SUGGESTIONS_SQL', () => {
  it('matches on (link id, column) pairs and only pending rows', () => {
    expect(SUPERSEDE_LINK_SUGGESTIONS_SQL).toContain('unnest($2::uuid[], $3::text[])')
    expect(SUPERSEDE_LINK_SUGGESTIONS_SQL).toContain("c.status = 'pending'")
    expect(SUPERSEDE_LINK_SUGGESTIONS_SQL).toContain("status = 'superseded'")
  })
})
