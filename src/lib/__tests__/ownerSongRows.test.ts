/**
 * RH-124 — the fold between the SQL and the screens.
 *
 * `@/lib/ownerSongRows` is where a row of the three-level projection becomes
 * either a `Repertoire` (a located owner row) or a `ResolvedSongEntry` (an
 * `(owner, version)` pair, held or not). The cascade itself is
 * `songResolution.test.ts`'s subject; what is pinned here is the mapping, plus
 * the two nullish fallbacks that exist because the projection's row type has to
 * admit a `LEFT JOIN` that matched nothing.
 *
 * Pure, so no mock and no database: the module issues no statement.
 */

import { describe, it, expect } from 'vitest'
import { entryFrom, ownerColumn, ownerId, ownerTable, toEntry, toResolvedEntry } from '@/lib/ownerSongRows'
import type { OwnerSongLevelsRow } from '@/lib/dbRows'
import type { Song } from '@/types/database'

const SONG: Song = {
  id: 'song-1',
  title: 'Tempo Perdido',
  artist: 'Legião Urbana',
  album: 'Dois',
  standard_key: 'Em',
  cover_url: null,
  duration_seconds: 302,
  links: [],
  created_at: '2026-01-01T00:00:00.000Z',
}

/** A row with an owner-row half, as every located read projects it. */
function heldRow(overrides: Partial<OwnerSongLevelsRow> = {}): OwnerSongLevelsRow {
  return {
    owner_row_id: 'owner-1',
    owner_status: 'polishing',
    owner_key: null,
    owner_tuning: null,
    owner_lyrics: null,
    owner_map: null,
    owner_tags: ['setlist'],
    owner_last_practiced: '2026-02-02T00:00:00.000Z',
    version_id: 'version-1',
    song_id: 'song-1',
    version_key: 'G',
    version_tuning: 'Standard',
    version_lyrics: null,
    version_map: null,
    song_lyrics: 'the composition words',
    song_map: { sections: ['verse'] },
    song: SONG,
    ...overrides,
  }
}

describe('owner / table resolution', () => {
  it('routes a user owner to user_songs and a band owner to band_songs', () => {
    expect(ownerTable({ userId: 'u1' })).toBe('user_songs')
    expect(ownerTable({ bandId: 'b1' })).toBe('band_songs')
    expect(ownerColumn({ userId: 'u1' })).toBe('user_id')
    expect(ownerColumn({ bandId: 'b1' })).toBe('band_id')
    expect(ownerId({ userId: 'u1' })).toBe('u1')
    expect(ownerId({ bandId: 'b1' })).toBe('b1')
  })

  it('joins the owner table through the version to the song, never straight to it', () => {
    const from = entryFrom({ bandId: 'b1' })

    expect(from).toContain('FROM band_songs o')
    expect(from).toContain('JOIN song_versions v ON v.id = o.version_id')
    expect(from).toContain('JOIN songs s ON s.id = v.song_id')
    // The owner row carries no `song_id`: the version is the only way across.
    expect(from).not.toMatch(/o\.song_id/)
  })
})

describe('toEntry — a located owner row', () => {
  it('carries the owner id, the version and the resolved fields, under the owner given', () => {
    const entry = toEntry(heldRow(), { bandId: 'band-9' })

    expect(entry).toMatchObject({
      id: 'owner-1',
      user_id: null,
      band_id: 'band-9',
      song_id: 'song-1',
      version_id: 'version-1',
      status: 'polishing',
      tags: ['setlist'],
      last_practiced: '2026-02-02T00:00:00.000Z',
      // Two levels for the key, three for the lyrics and the map.
      key: 'G',
      tuning: 'Standard',
      lyrics: 'the composition words',
      map: { sections: ['verse'] },
    })
    expect(entry.song).toBe(SONG)
  })

  it('stamps the user half instead when the owner is a user', () => {
    const entry = toEntry(heldRow(), { userId: 'user-9' })

    expect(entry.user_id).toBe('user-9')
    expect(entry.band_id).toBeNull()
  })

  /**
   * `status` is `NOT NULL DEFAULT 'unknown'` and `tags` is `NOT NULL DEFAULT
   * '{}'`, so neither fallback can fire for a row that exists. They are there
   * because the projection's row type has to admit the `LEFT JOIN` form, and a
   * `Repertoire` must carry a status either way — `unknown` is the column's own
   * default, not an invention.
   */
  it('falls back to unknown and [] rather than handing a screen a null', () => {
    const entry = toEntry(heldRow({ owner_status: null, owner_tags: null }), { userId: 'u1' })

    expect(entry.status).toBe('unknown')
    expect(entry.tags).toEqual([])
  })
})

describe('toResolvedEntry — held or not', () => {
  it('reports the owner row when there is one', () => {
    const resolved = toResolvedEntry(heldRow())

    expect(resolved.ownerRowId).toBe('owner-1')
    expect(resolved.status).toBe('polishing')
    expect(resolved.version_id).toBe('version-1')
  })

  it('reports an absent owner row as absent, not as an error or a default', () => {
    const resolved = toResolvedEntry(
      heldRow({
        owner_row_id: null,
        owner_status: null,
        owner_tags: null,
        owner_last_practiced: null,
      }),
    )

    expect(resolved.ownerRowId).toBeNull()
    // No fallback for `status` here, unlike `toEntry`: "not in my repertoire
    // yet" is legitimate information, and `unknown` would be a different claim.
    expect(resolved.status).toBeNull()
    expect(resolved.tags).toEqual([])
    expect(resolved.last_practiced).toBeNull()
    // The two levels above still resolve exactly as they do for a held row.
    expect(resolved.key).toBe('G')
    expect(resolved.lyrics).toBe('the composition words')
  })
})
