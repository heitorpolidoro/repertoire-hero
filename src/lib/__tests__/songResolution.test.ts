/**
 * RH-124 — the one walk-up, unit-tested at every rule it has.
 *
 * `resolveSongFields` is the only place either cascade is written (ER8), so
 * these cases are the whole specification of what a screen sees: there is no
 * second implementation in SQL to cross-check against, and that is deliberate.
 *
 * The two depths differ on purpose (docs/use-cases.md, *Resolving a value*):
 * words and structure belong to the composition, so `lyrics` and `map` reach
 * `songs`; `key` and `tuning` are properties of a recording and stop at
 * `song_versions`.
 */

import { describe, it, expect } from 'vitest'
import {
  resolveSongFields,
  type OwnerOverrides,
  type SongLevel,
  type VersionLevel,
} from '@/lib/songResolution'

const EMPTY_OWNER: OwnerOverrides = {
  status: null,
  key: null,
  tuning: null,
  lyrics: null,
  map: null,
  tags: [],
  last_practiced: null,
}

const EMPTY_VERSION: VersionLevel = { key: null, tuning: null, lyrics: null, map: null }
const EMPTY_SONG: SongLevel = { lyrics: null, map: null }

describe('resolveSongFields — lyrics and map walk three levels (ER8)', () => {
  it('takes the owner row\'s lyrics and map when it has them', () => {
    const resolved = resolveSongFields({
      owner: { ...EMPTY_OWNER, lyrics: 'owner words', map: { sections: ['owner'] } },
      version: { ...EMPTY_VERSION, lyrics: 'version words', map: { sections: ['version'] } },
      song: { lyrics: 'song words', map: { sections: ['song'] } },
    })

    expect(resolved.lyrics).toBe('owner words')
    expect(resolved.map).toEqual({ sections: ['owner'] })
  })

  it('falls through to the version when the owner row is null at that field', () => {
    const resolved = resolveSongFields({
      owner: EMPTY_OWNER,
      version: { ...EMPTY_VERSION, lyrics: 'version words', map: { sections: ['version'] } },
      song: { lyrics: 'song words', map: { sections: ['song'] } },
    })

    expect(resolved.lyrics).toBe('version words')
    expect(resolved.map).toEqual({ sections: ['version'] })
  })

  it('reaches songs when both the owner row and the version are null', () => {
    const resolved = resolveSongFields({
      owner: EMPTY_OWNER,
      version: EMPTY_VERSION,
      song: { lyrics: 'song words', map: { sections: ['song'] } },
    })

    expect(resolved.lyrics).toBe('song words')
    expect(resolved.map).toEqual({ sections: ['song'] })
  })

  it('takes the first non-null per field independently, not per level', () => {
    const resolved = resolveSongFields({
      owner: { ...EMPTY_OWNER, lyrics: 'owner words' },
      version: EMPTY_VERSION,
      song: { lyrics: 'song words', map: { sections: ['song'] } },
    })

    expect(resolved.lyrics).toBe('owner words')
    expect(resolved.map).toEqual({ sections: ['song'] })
  })

  it('stops the walk on an authored empty string and an empty jsonb object', () => {
    const resolved = resolveSongFields({
      owner: { ...EMPTY_OWNER, lyrics: '', map: {} },
      version: { ...EMPTY_VERSION, lyrics: 'version words', map: { sections: ['version'] } },
      song: { lyrics: 'song words', map: { sections: ['song'] } },
    })

    // "First non-null wins" means null, not falsy: clearing the lyrics to an
    // empty string is an authored value, and re-inheriting the version's words
    // would make clearing them impossible.
    expect(resolved.lyrics).toBe('')
    expect(resolved.map).toEqual({})
  })
})

describe('resolveSongFields — key and tuning walk two levels only (ER9)', () => {
  it('takes the owner row\'s key and tuning over the version\'s', () => {
    const resolved = resolveSongFields({
      owner: { ...EMPTY_OWNER, key: 'C#', tuning: 'Drop D' },
      version: { ...EMPTY_VERSION, key: 'G', tuning: 'Standard' },
      song: EMPTY_SONG,
    })

    expect(resolved.key).toBe('C#')
    expect(resolved.tuning).toBe('Drop D')
  })

  it('falls through to the version', () => {
    const resolved = resolveSongFields({
      owner: EMPTY_OWNER,
      version: { ...EMPTY_VERSION, key: 'G', tuning: 'Standard' },
      song: EMPTY_SONG,
    })

    expect(resolved.key).toBe('G')
    expect(resolved.tuning).toBe('Standard')
  })

  it('resolves null even when songs carries a value for the field', () => {
    const resolved = resolveSongFields({
      owner: EMPTY_OWNER,
      version: EMPTY_VERSION,
      // The song level is given both fields precisely so the assertion means
      // something: they are declared on `SongLevel` and read by nothing.
      song: { lyrics: null, map: null, key: 'E', tuning: 'DADGAD' },
    })

    expect(resolved.key).toBeNull()
    expect(resolved.tuning).toBeNull()
  })
})

describe('resolveSongFields — status, tags and last_practiced are owner-only (ER10)', () => {
  it('resolves status to the owner row\'s value', () => {
    const resolved = resolveSongFields({
      owner: { ...EMPTY_OWNER, status: 'polishing' },
      version: EMPTY_VERSION,
      song: EMPTY_SONG,
    })

    expect(resolved.status).toBe('polishing')
  })

  it('resolves status to null when there is no owner row, inheriting nothing', () => {
    const resolved = resolveSongFields({
      owner: null,
      version: { key: 'G', tuning: 'Standard', lyrics: 'v', map: { a: 1 } },
      song: { lyrics: 's', map: { b: 2 } },
    })

    expect(resolved.status).toBeNull()
    expect(resolved.tags).toEqual([])
    expect(resolved.last_practiced).toBeNull()
  })

  it('carries the owner row\'s tags and last_practiced verbatim', () => {
    const resolved = resolveSongFields({
      owner: { ...EMPTY_OWNER, tags: ['setlist-2026'], last_practiced: '2026-01-02T03:04:05.000Z' },
      version: EMPTY_VERSION,
      song: EMPTY_SONG,
    })

    expect(resolved.tags).toEqual(['setlist-2026'])
    expect(resolved.last_practiced).toBe('2026-01-02T03:04:05.000Z')
  })
})

describe('resolveSongFields — a missing owner row is not an error (ER11)', () => {
  it('resolves `owner: null` to exactly the same object as an all-null owner row', () => {
    const version: VersionLevel = {
      key: 'G',
      tuning: 'Standard',
      lyrics: 'version words',
      map: { sections: ['version'] },
    }
    const song: SongLevel = { lyrics: 'song words', map: { sections: ['song'] } }

    const absent = resolveSongFields({ owner: null, version, song })
    const blank = resolveSongFields({ owner: EMPTY_OWNER, version, song })

    expect(absent).toEqual(blank)
    expect(absent).toEqual({
      status: null,
      key: 'G',
      tuning: 'Standard',
      lyrics: 'version words',
      map: { sections: ['version'] },
      tags: [],
      last_practiced: null,
    })
  })
})
