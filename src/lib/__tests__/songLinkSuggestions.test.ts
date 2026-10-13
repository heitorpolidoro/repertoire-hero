/**
 * RH-138 — the pure and statement-shaping halves of applying an approved
 * link-row suggestion. No database: the client is a recording stub.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  applyApprovedLinkChanges,
  findUrlCollision,
  supersededLinkPairs,
} from '@/lib/songLinkSuggestions'
import type { Queryable } from '@/lib/db'

const SIBLINGS = [
  { id: 'a', song_id: 's1', url: 'https://x.example/a' },
  { id: 'b', song_id: 's1', url: 'https://x.example/b' },
  { id: 'c', song_id: 's2', url: 'https://x.example/a' },
]

function clientWith(siblings = SIBLINGS) {
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes('SELECT id, song_id, url') ? siblings : [],
    rowCount: 0,
  }))
  return { client: { query } as unknown as Queryable, query }
}

describe('findUrlCollision', () => {
  it('flags a url another row of the same song holds', () => {
    expect(
      findUrlCollision(SIBLINGS, [{ linkId: 'a', column: 'url', value: 'https://x.example/b' }]),
    ).toMatch(/^Invalid catalog suggestion: /)
  })

  it('flags a url held by a sibling, lets an unchanged url or another song stand', () => {
    expect(
      findUrlCollision(SIBLINGS, [{ linkId: 'b', column: 'url', value: 'https://x.example/a' }]),
    ).toMatch(/^Invalid/)
    expect(
      findUrlCollision(SIBLINGS, [{ linkId: 'c', column: 'url', value: 'https://x.example/zzz' }]),
    ).toBeUndefined()
    expect(
      findUrlCollision(SIBLINGS, [{ linkId: 'a', column: 'url', value: 'https://x.example/a' }]),
    ).toBeUndefined()
  })

  it('does not count a row removed by the same approval', () => {
    expect(
      findUrlCollision(SIBLINGS, [
        { linkId: 'a', column: 'url', value: 'https://x.example/b' },
        { linkId: 'b', column: 'removed', value: true },
      ]),
    ).toBeUndefined()
  })

  it('flags two edits landing on one url, and ignores a vanished link', () => {
    expect(
      findUrlCollision(SIBLINGS, [
        { linkId: 'a', column: 'url', value: 'https://x.example/new' },
        { linkId: 'b', column: 'url', value: 'https://x.example/new' },
      ]),
    ).toMatch(/^Invalid/)
    expect(
      findUrlCollision(SIBLINGS, [{ linkId: 'gone', column: 'url', value: 'https://x.example/b' }]),
    ).toBeUndefined()
    expect(findUrlCollision(SIBLINGS, [{ linkId: 'a', column: 'label', value: 'x' }])).toBeUndefined()
  })
})

describe('applyApprovedLinkChanges', () => {
  it('issues nothing for no changes', async () => {
    const { client, query } = clientWith()
    await applyApprovedLinkChanges(client, [])
    expect(query).not.toHaveBeenCalled()
  })

  it('writes one statement per change, keyed by id, removals first and never position', async () => {
    const { client, query } = clientWith()
    const songIds = await applyApprovedLinkChanges(client, [
      { linkId: 'a', column: 'label', value: 'New' },
      { linkId: 'b', column: 'removed', value: true },
    ])
    expect(songIds).toEqual(['s1'])
    const writes = query.mock.calls.slice(1)
    expect(writes).toEqual([
      ['DELETE FROM song_links WHERE id = $1', ['b']],
      ['UPDATE song_links SET label = $2 WHERE id = $1', ['a', 'New']],
    ])
    expect(JSON.stringify(query.mock.calls)).not.toContain('position')
  })

  it('refuses a colliding url before any write', async () => {
    const { client, query } = clientWith()
    await expect(
      applyApprovedLinkChanges(client, [{ linkId: 'a', column: 'url', value: 'https://x.example/b' }]),
    ).rejects.toThrowError(/^Invalid catalog suggestion: /)
    expect(query).toHaveBeenCalledTimes(1) // the sibling read only
  })

  it('refuses a column outside the closed map without issuing a statement', async () => {
    const { client, query } = clientWith()
    await expect(
      applyApprovedLinkChanges(client, [{ linkId: 'a', column: 'position', value: 1 }]),
    ).rejects.toThrowError(/^Invalid catalog suggestion: /)
    expect(query).not.toHaveBeenCalled()
  })
})

describe('supersededLinkPairs', () => {
  it('closes every column of a removed link and only its own column otherwise', () => {
    expect(
      supersededLinkPairs([
        { linkId: 'a', column: 'removed', value: true },
        { linkId: 'b', column: 'url', value: 'https://x.example/q' },
      ]),
    ).toEqual({
      linkIds: ['a', 'a', 'a', 'b'],
      columns: ['url', 'label', 'removed', 'url'],
    })
  })
})
