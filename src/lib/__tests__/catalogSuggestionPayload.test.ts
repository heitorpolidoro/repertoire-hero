/**
 * RH-55 (F17), RH-107 — per-field accept/reject table for a proposed catalog
 * correction, plus the `(target_table, target_column)` refusal.
 *
 * Pure unit tests: no mocks and no database. Every rejection is asserted with
 * `toThrowError(new Error(...))`, which compares the message for equality, so a
 * message that gets wrapped somewhere upstream fails the test instead of
 * matching as a substring.
 *
 * The pair refusal is tested **here** rather than through
 * `submitCatalogSuggestion`, and that is not a convenience: the submit entry
 * point takes no table argument and its payload narrower would silently drop a
 * `created_at` key, so a real-but-forbidden column is not drivable through it
 * at all. `parseCatalogSuggestionValue` takes the table and the column from its
 * caller, which is exactly why it is the one place that has to refuse.
 */
import { describe, it, expect } from 'vitest'
import {
  CATALOG_SUGGESTION_COLUMNS,
  parseCatalogSuggestionPayload,
  parseCatalogSuggestionValue,
} from '@/lib/catalogSuggestionPayload'

describe('parseCatalogSuggestionPayload', () => {
  // RH-122 — the title splits and this path keeps the **left half**. The suffix
  // is dropped rather than routed to a version label because a moderation edit
  // proposes columns of one `songs` row and carries no version context; that
  // routing is the job of the part that turns this queue into
  // `catalog_suggestions`. A parenthesised edition is not a suffix at all and
  // stays in the title, because there is no vocabulary of special words left.
  it('keeps the left half of a split title, and never a title bearing the separator', () => {
    expect(parseCatalogSuggestionPayload({ title: 'Plush - 2017 Remaster' })).toEqual({ title: 'Plush' })
    expect(parseCatalogSuggestionPayload({ title: '  Plush  ' })).toEqual({ title: 'Plush' })
    expect(parseCatalogSuggestionPayload({ title: 'Plush (2017 Remaster)' })).toEqual({
      title: 'Plush (2017 Remaster)',
    })

    // ER9 — no write path may persist a `songs.title` that still carries ' - '.
    expect(parseCatalogSuggestionPayload({ title: 'Plush - Live at Wembley' }).title).not.toContain(' - ')
  })

  it('rejects a title that is not a non-empty string', () => {
    expect(() => parseCatalogSuggestionPayload({ title: 42 })).toThrowError(
      new Error('Invalid catalog suggestion: title must be a non-empty string')
    )
    expect(() => parseCatalogSuggestionPayload({ title: '   ' })).toThrowError(
      new Error('Invalid catalog suggestion: title must be a non-empty string')
    )
  })

  it('accepts an artist and trims it', () => {
    expect(parseCatalogSuggestionPayload({ artist: '  Stone Temple Pilots  ' })).toEqual({
      artist: 'Stone Temple Pilots',
    })
  })

  it('rejects an artist that is not a non-empty string', () => {
    expect(() => parseCatalogSuggestionPayload({ artist: null })).toThrowError(
      new Error('Invalid catalog suggestion: artist must be a non-empty string')
    )
    expect(() => parseCatalogSuggestionPayload({ artist: '' })).toThrowError(
      new Error('Invalid catalog suggestion: artist must be a non-empty string')
    )
  })

  // RH-122 — the album name is trimmed only. The stripper is gone: `albums`
  // keys on `(lower(artist), lower(name))`, so cleaning the edition off a name
  // would merge a genuinely separate release into the standard album.
  it('accepts an album as a string or null, trimming only', () => {
    expect(parseCatalogSuggestionPayload({ album: 'Core (Super Deluxe Edition)' })).toEqual({
      album: 'Core (Super Deluxe Edition)',
    })
    expect(parseCatalogSuggestionPayload({ album: '  Core  ' })).toEqual({ album: 'Core' })
    expect(parseCatalogSuggestionPayload({ album: '   ' })).toEqual({ album: null })
    expect(parseCatalogSuggestionPayload({ album: null })).toEqual({ album: null })
  })

  it('rejects an album that is neither a string nor null', () => {
    expect(() => parseCatalogSuggestionPayload({ album: 7 })).toThrowError(
      new Error('Invalid catalog suggestion: album must be a string or null')
    )
  })

  it('accepts a standard_key as a string or null', () => {
    expect(parseCatalogSuggestionPayload({ standard_key: 'Am' })).toEqual({ standard_key: 'Am' })
    expect(parseCatalogSuggestionPayload({ standard_key: null })).toEqual({ standard_key: null })
  })

  it('rejects a standard_key that is neither a string nor null', () => {
    expect(() => parseCatalogSuggestionPayload({ standard_key: ['A'] })).toThrowError(
      new Error('Invalid catalog suggestion: standard_key must be a string or null')
    )
  })

  it('accepts a cover_url that is an http(s) URL or null', () => {
    expect(parseCatalogSuggestionPayload({ cover_url: 'https://img.example/a.jpg' })).toEqual({
      cover_url: 'https://img.example/a.jpg',
    })
    expect(parseCatalogSuggestionPayload({ cover_url: null })).toEqual({ cover_url: null })
  })

  it('rejects a cover_url that is not an http(s) URL', () => {
    // A `javascript:` scheme, written with `void` because `noBrowserDialogs.test.ts`
    // scans every line of `src/` for a native dialog call, string or not.
    expect(() => parseCatalogSuggestionPayload({ cover_url: 'javascript:void(0)' })).toThrowError(
      new Error('Invalid catalog suggestion: cover_url must be null or an http(s) URL')
    )
    expect(() => parseCatalogSuggestionPayload({ cover_url: 12 })).toThrowError(
      new Error('Invalid catalog suggestion: cover_url must be null or an http(s) URL')
    )
  })

  it('accepts a duration_seconds that is a non-negative integer or null', () => {
    expect(parseCatalogSuggestionPayload({ duration_seconds: 217 })).toEqual({ duration_seconds: 217 })
    expect(parseCatalogSuggestionPayload({ duration_seconds: 0 })).toEqual({ duration_seconds: 0 })
    expect(parseCatalogSuggestionPayload({ duration_seconds: null })).toEqual({ duration_seconds: null })
  })

  it('rejects a duration_seconds that is not a non-negative integer', () => {
    for (const value of ['abc', -1, 3.5]) {
      expect(() => parseCatalogSuggestionPayload({ duration_seconds: value })).toThrowError(
        new Error('Invalid catalog suggestion: duration_seconds must be a non-negative integer or null')
      )
    }
  })

  it('accepts links as an array of label/url objects with http(s) urls', () => {
    const links = [{ label: 'Chords', url: 'https://tabs.example/1' }]
    expect(parseCatalogSuggestionPayload({ links })).toEqual({ links })
    expect(parseCatalogSuggestionPayload({ links: [] })).toEqual({ links: [] })
  })

  it('rejects links that are not an array of label/url objects', () => {
    const invalid: unknown[] = [42, [{ label: 'x' }], [{ label: 'x', url: 'ftp://a/b' }]]
    for (const links of invalid) {
      expect(() => parseCatalogSuggestionPayload({ links })).toThrowError(
        new Error('Invalid catalog suggestion: links must be an array of {label, url} objects with http(s) urls')
      )
    }
  })

  it('ignores keys that are not songs columns', () => {
    // `reason` rides along inside the correction modal's payload and must be
    // dropped rather than rejected (src/components/songs/CorrectionModal.tsx).
    expect(parseCatalogSuggestionPayload({ title: 'Plush', reason: 'typo in the title' })).toEqual({
      title: 'Plush',
    })
  })

  it('rejects a payload with no proposable field', () => {
    const message =
      'Invalid catalog suggestion: at least one of title, artist, album, standard_key, cover_url, duration_seconds, links must be present'
    expect(() => parseCatalogSuggestionPayload({})).toThrowError(new Error(message))
    expect(() => parseCatalogSuggestionPayload({ reason: 'typo' })).toThrowError(new Error(message))
  })

  it('rejects a payload that is not a plain object', () => {
    for (const value of [null, 'x', []]) {
      expect(() => parseCatalogSuggestionPayload(value)).toThrowError(
        new Error('Invalid catalog suggestion: payload must be a plain object')
      )
    }
  })
})

describe('parseCatalogSuggestionValue', () => {
  /**
   * A valid sample for every allowlisted column. The key set is asserted
   * **equal** to the allowlist's below, so admitting a column without adding a
   * sample here fails this suite rather than skipping the column silently.
   */
  const SAMPLES: Record<string, unknown> = {
    title: 'Plush',
    artist: 'Stone Temple Pilots',
    album: 'Core',
    standard_key: 'Am',
    cover_url: 'https://img.example/a.jpg',
    duration_seconds: 217,
    links: [{ label: 'Chords', url: 'https://tabs.example/1' }],
  }

  it('refuses a (target_table, target_column) pair outside the allowlist', () => {
    const pairs: Array<[string, string]> = [
      // Real `songs` columns the catalog owns and a requester may not propose.
      ['songs', 'id'],
      ['songs', 'created_at'],
      ['songs', 'updated_at'],
      // A table the row shape can express but the allowlist does not admit yet.
      ['albums', 'title'],
      ['no_such_table', 'title'],
    ]

    for (const [table, column] of pairs) {
      // The refusal has to name the allowlist, not the "at least one of …"
      // message: that one belongs to a payload proposing nothing, and getting
      // it here would mean the pair was never checked.
      expect(() => parseCatalogSuggestionValue(table, column, 'x')).toThrowError(
        /is not an allowlisted catalog column/,
      )
    }
  })

  it('admits every column the submit payload can propose', () => {
    const columns = Object.keys(CATALOG_SUGGESTION_COLUMNS.songs)

    // Not vacuous: an empty allowlist would satisfy the equality below against
    // an empty sample map while the loop ran zero times.
    expect(columns.length).toBeGreaterThan(0)
    expect(columns).toContain('title')
    expect(columns).toContain('links')
    expect(new Set(Object.keys(SAMPLES))).toEqual(new Set(columns))

    for (const column of columns) {
      expect(() => parseCatalogSuggestionValue('songs', column, SAMPLES[column])).not.toThrow()
    }
  })

  it('refuses an inherited Object.prototype key as a column name', () => {
    // A plain index into the allowlist object would come back truthy for
    // `constructor`, and the caller is about to interpolate the name into an
    // identifier position.
    for (const column of ['constructor', 'toString', '__proto__']) {
      expect(() => parseCatalogSuggestionValue('songs', column, 'x')).toThrowError(
        /is not an allowlisted catalog column/,
      )
    }
  })

  it('returns the value through the same normaliser the payload narrower uses', () => {
    expect(parseCatalogSuggestionValue('songs', 'title', 'Plush - 2017 Remaster')).toBe('Plush')
    expect(parseCatalogSuggestionValue('songs', 'album', '   ')).toBeNull()
    expect(() => parseCatalogSuggestionValue('songs', 'duration_seconds', 'abc')).toThrowError(
      new Error('Invalid catalog suggestion: duration_seconds must be a non-negative integer or null'),
    )
  })
})
