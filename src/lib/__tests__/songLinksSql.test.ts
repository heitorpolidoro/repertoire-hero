/**
 * RH-136 — the two pure helpers in `@/lib/songLinksSql`.
 *
 * No database: {@link dedupeLinksByUrl} and {@link songLinkInsertRows} issue no
 * statement, which is the whole reason they are in a library module rather than
 * in one of the four writers. The round trips through real SQL live in
 * `songLinksTable.db.test.ts` and `songLinksBridge.db.test.ts`.
 */

import { describe, it, expect } from 'vitest'
import { dedupeLinksByUrl, songLinkInsertRows, songLinksJson } from '../songLinksSql'
import type { SongLink } from '@/types/database'

describe('dedupeLinksByUrl', () => {
  it('keeps the first occurrence of each url and drops the rest', () => {
    expect(
      dedupeLinksByUrl([
        { label: 'first', url: 'https://a.example/x' },
        { label: 'second', url: 'https://a.example/x' },
        { label: 'other', url: 'https://b.example/y' },
      ]),
    ).toEqual([
      { label: 'first', url: 'https://a.example/x' },
      { label: 'other', url: 'https://b.example/y' },
    ])
  })

  it('compares urls byte for byte, exactly as UNIQUE (song_id, url) does', () => {
    // No trimming, no case folding, no trailing-slash normalisation: all three
    // are distinct rows in the table, so they must stay distinct here.
    const links: SongLink[] = [
      { label: 'a', url: 'https://a.example/x' },
      { label: 'b', url: 'https://A.example/x' },
      { label: 'c', url: 'https://a.example/x/' },
      { label: 'd', url: ' https://a.example/x' },
    ]
    expect(dedupeLinksByUrl(links)).toEqual(links)
  })

  it('leaves an empty array empty', () => {
    expect(dedupeLinksByUrl([])).toEqual([])
  })
})

describe('songLinkInsertRows', () => {
  it('numbers position from 1 over the survivors and binds url then label', () => {
    const rows = songLinkInsertRows('song-1', [
      { label: 'A', url: 'https://a.example/x' },
      { label: 'B', url: 'https://b.example/y' },
    ])

    expect(rows.values).toBe('($1, $2, $3, 1), ($1, $4, $5, 2)')
    expect(rows.params).toEqual([
      'song-1',
      'https://a.example/x',
      'A',
      'https://b.example/y',
      'B',
    ])
    expect(rows.count).toBe(2)
  })

  it('stores a missing label as the empty string, never as null', () => {
    // `song_links.label` is NOT NULL, and the UI already reads an empty label as
    // "show the url". The column is reachable with no label from unvalidated
    // jsonb, which is why the fallback exists rather than relying on the type.
    const rows = songLinkInsertRows('song-1', [
      { url: 'https://a.example/x' } as unknown as SongLink,
    ])

    expect(rows.params).toEqual(['song-1', 'https://a.example/x', ''])
  })

  it('reports a count of zero for an empty array, so the caller issues nothing', () => {
    const rows = songLinkInsertRows('song-1', [])
    expect(rows.count).toBe(0)
    expect(rows.values).toBe('')
    expect(rows.params).toEqual(['song-1'])
  })
})

describe('songLinksJson', () => {
  it('correlates on the given songs alias and reads in the canonical order', () => {
    const sql = songLinksJson('s')
    expect(sql).toContain('WHERE sl.song_id = s.id')
    expect(sql).toContain('ORDER BY sl.position, sl.created_at, sl.id')
    // A link-less song answers an empty array, never null.
    expect(sql).toContain("'[]'::json")
  })
})
