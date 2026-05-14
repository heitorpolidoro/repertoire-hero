import { describe, it, expect } from 'vitest'
import type { UserRepertoire } from '@/types/database'
import { filterSongs } from '../filterSongs'

// ---- fixtures ----

function makeSong(overrides: Partial<UserRepertoire> & {
  title?: string
  artist?: string
}): UserRepertoire {
  const { title = 'Default Title', artist = 'Default Artist', ...rest } = overrides
  return {
    id: rest.id ?? crypto.randomUUID(),
    user_id: 'user-1',
    song_id: rest.song_id ?? crypto.randomUUID(),
    personal_key: null,
    status: rest.status ?? 'unknown',
    tags: rest.tags ?? [],
    last_practiced: null,
    song: {
      id: rest.song_id ?? crypto.randomUUID(),
      title,
      artist,
      album: null,
      standard_key: null,
      cover_url: null,
      links: [],
      created_at: new Date().toISOString(),
    },
  }
}

const beatles    = makeSong({ title: 'Let It Be',        artist: 'The Beatles', status: 'mastered',   tags: ['rock', 'classic'] })
const bossa      = makeSong({ title: 'Garota de Ipanema', artist: 'Tom Jobim',   status: 'learning',   tags: ['bossa nova', 'mpb'] })
const radiohead  = makeSong({ title: 'Creep',             artist: 'Radiohead',   status: 'practicing', tags: ['rock'] })
const johnnyCash = makeSong({ title: 'Ring of Fire',      artist: 'Johnny Cash', status: 'polishing',  tags: ['country'] })

const ALL = [beatles, bossa, radiohead, johnnyCash]

// ---- Search query tests ----

describe('filterSongs — search query', () => {
  it('returns all songs when query is empty', () => {
    expect(filterSongs(ALL, '', null, [])).toHaveLength(4)
  })

  it('matches by title (case-insensitive)', () => {
    const result = filterSongs(ALL, 'let it be', null, [])
    expect(result).toHaveLength(1)
    expect(result[0].song?.title).toBe('Let It Be')
  })

  it('matches by partial title', () => {
    const result = filterSongs(ALL, 'creep', null, [])
    expect(result).toHaveLength(1)
    expect(result[0].song?.title).toBe('Creep')
  })

  it('matches by artist (case-insensitive)', () => {
    const result = filterSongs(ALL, 'tom jobim', null, [])
    expect(result).toHaveLength(1)
    expect(result[0].song?.artist).toBe('Tom Jobim')
  })

  it('matches by partial artist name', () => {
    const result = filterSongs(ALL, 'radio', null, [])
    expect(result).toHaveLength(1)
    expect(result[0].song?.artist).toBe('Radiohead')
  })

  it('returns empty array when no songs match', () => {
    const result = filterSongs(ALL, 'zzznotexist', null, [])
    expect(result).toHaveLength(0)
  })

  it('trims whitespace from query', () => {
    const result = filterSongs(ALL, '  creep  ', null, [])
    expect(result).toHaveLength(1)
  })
})

// ---- Status filter tests ----

describe('filterSongs — status filter', () => {
  it('returns all songs when status is null', () => {
    expect(filterSongs(ALL, '', null, [])).toHaveLength(4)
  })

  it('filters by mastered', () => {
    const result = filterSongs(ALL, '', 'mastered', [])
    expect(result).toHaveLength(1)
    expect(result[0].song?.title).toBe('Let It Be')
  })

  it('filters by learning', () => {
    const result = filterSongs(ALL, '', 'learning', [])
    expect(result).toHaveLength(1)
    expect(result[0].song?.title).toBe('Garota de Ipanema')
  })

  it('filters by practicing', () => {
    const result = filterSongs(ALL, '', 'practicing', [])
    expect(result).toHaveLength(1)
    expect(result[0].song?.title).toBe('Creep')
  })

  it('filters by polishing', () => {
    const result = filterSongs(ALL, '', 'polishing', [])
    expect(result).toHaveLength(1)
    expect(result[0].song?.title).toBe('Ring of Fire')
  })

  it('returns empty array when no songs match the status', () => {
    const result = filterSongs(ALL, '', 'unknown', [])
    expect(result).toHaveLength(0)
  })
})

// ---- Tag filter tests ----

describe('filterSongs — tag filter', () => {
  it('returns all songs when tags array is empty', () => {
    expect(filterSongs(ALL, '', null, [])).toHaveLength(4)
  })

  it('filters by a single tag', () => {
    const result = filterSongs(ALL, '', null, ['rock'])
    expect(result).toHaveLength(2)
    const titles = result.map((s) => s.song?.title)
    expect(titles).toContain('Let It Be')
    expect(titles).toContain('Creep')
  })

  it('requires all selected tags to match (AND logic)', () => {
    const result = filterSongs(ALL, '', null, ['rock', 'classic'])
    expect(result).toHaveLength(1)
    expect(result[0].song?.title).toBe('Let It Be')
  })

  it('returns empty when tag has no matches', () => {
    const result = filterSongs(ALL, '', null, ['jazz'])
    expect(result).toHaveLength(0)
  })
})

// ---- Combined filter tests ----

describe('filterSongs — combined filters', () => {
  it('combines search query + status', () => {
    const result = filterSongs(ALL, 'Beatles', 'mastered', [])
    expect(result).toHaveLength(1)
    expect(result[0].song?.title).toBe('Let It Be')
  })

  it('combines search query + tag', () => {
    const result = filterSongs(ALL, 'creep', null, ['rock'])
    expect(result).toHaveLength(1)
    expect(result[0].song?.title).toBe('Creep')
  })

  it('combines status + tag', () => {
    const result = filterSongs(ALL, '', 'mastered', ['rock'])
    expect(result).toHaveLength(1)
    expect(result[0].song?.title).toBe('Let It Be')
  })

  it('returns empty when combined filters yield no results', () => {
    // "rock" songs exist but none is "learning"
    const result = filterSongs(ALL, '', 'learning', ['rock'])
    expect(result).toHaveLength(0)
  })
})

// ---- Edge cases ----

describe('filterSongs — edge cases', () => {
  it('handles empty songs list', () => {
    expect(filterSongs([], 'anything', 'mastered', ['rock'])).toHaveLength(0)
  })

  it('handles songs with no song metadata gracefully', () => {
    const bare: UserRepertoire = {
      id: 'bare-1',
      user_id: 'user-1',
      song_id: 'song-1',
      personal_key: null,
      status: 'unknown',
      tags: [],
      last_practiced: null,
      song: undefined,
    }
    // Should not throw — returns 0 matches when query is provided (no title/artist to match)
    expect(filterSongs([bare], 'anything', null, [])).toHaveLength(0)
    // Returns the bare song when no filters are active
    expect(filterSongs([bare], '', null, [])).toHaveLength(1)
  })
})
