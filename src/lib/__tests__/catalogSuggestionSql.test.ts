/**
 * RH-138 — the statement text the per-row link model depends on. Pure: nothing
 * here touches a database; the DB-backed behaviour is in
 * `linkRowSuggestions.db.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import {
  PENDING_SUGGESTION_GROUPS_SQL,
  SUPERSEDE_LINK_SUGGESTIONS_SQL,
  suggestionInsert,
} from '@/lib/catalogSuggestionSql'

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

describe('SUPERSEDE_LINK_SUGGESTIONS_SQL', () => {
  it('matches on (link id, column) pairs and only pending rows', () => {
    expect(SUPERSEDE_LINK_SUGGESTIONS_SQL).toContain('unnest($2::uuid[], $3::text[])')
    expect(SUPERSEDE_LINK_SUGGESTIONS_SQL).toContain("c.status = 'pending'")
    expect(SUPERSEDE_LINK_SUGGESTIONS_SQL).toContain("status = 'superseded'")
  })
})
