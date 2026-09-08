/**
 * RH-55 (F17) — per-field accept/reject table for the moderation payload.
 *
 * Pure unit tests: no mocks and no database. Every rejection is asserted with
 * `toThrowError(new Error(...))`, which compares the message for equality, so a
 * message that gets wrapped somewhere upstream fails the test instead of
 * matching as a substring.
 */
import { describe, it, expect } from 'vitest'
import { parseGlobalSongEditPayload } from '@/lib/globalSongEditPayload'

describe('parseGlobalSongEditPayload', () => {
  it('accepts a title and sanitizes the remaster suffix', () => {
    expect(parseGlobalSongEditPayload({ title: 'Plush (2017 Remaster)' })).toEqual({ title: 'Plush' })
  })

  it('rejects a title that is not a non-empty string', () => {
    expect(() => parseGlobalSongEditPayload({ title: 42 })).toThrowError(
      new Error('Invalid global song edit: title must be a non-empty string')
    )
    expect(() => parseGlobalSongEditPayload({ title: '   ' })).toThrowError(
      new Error('Invalid global song edit: title must be a non-empty string')
    )
  })

  it('accepts an artist and trims it', () => {
    expect(parseGlobalSongEditPayload({ artist: '  Stone Temple Pilots  ' })).toEqual({
      artist: 'Stone Temple Pilots',
    })
  })

  it('rejects an artist that is not a non-empty string', () => {
    expect(() => parseGlobalSongEditPayload({ artist: null })).toThrowError(
      new Error('Invalid global song edit: artist must be a non-empty string')
    )
    expect(() => parseGlobalSongEditPayload({ artist: '' })).toThrowError(
      new Error('Invalid global song edit: artist must be a non-empty string')
    )
  })

  it('accepts an album as a string or null', () => {
    expect(parseGlobalSongEditPayload({ album: 'Core (Super Deluxe Edition)' })).toEqual({ album: 'Core' })
    expect(parseGlobalSongEditPayload({ album: null })).toEqual({ album: null })
  })

  it('rejects an album that is neither a string nor null', () => {
    expect(() => parseGlobalSongEditPayload({ album: 7 })).toThrowError(
      new Error('Invalid global song edit: album must be a string or null')
    )
  })

  it('accepts a standard_key as a string or null', () => {
    expect(parseGlobalSongEditPayload({ standard_key: 'Am' })).toEqual({ standard_key: 'Am' })
    expect(parseGlobalSongEditPayload({ standard_key: null })).toEqual({ standard_key: null })
  })

  it('rejects a standard_key that is neither a string nor null', () => {
    expect(() => parseGlobalSongEditPayload({ standard_key: ['A'] })).toThrowError(
      new Error('Invalid global song edit: standard_key must be a string or null')
    )
  })

  it('accepts a cover_url that is an http(s) URL or null', () => {
    expect(parseGlobalSongEditPayload({ cover_url: 'https://img.example/a.jpg' })).toEqual({
      cover_url: 'https://img.example/a.jpg',
    })
    expect(parseGlobalSongEditPayload({ cover_url: null })).toEqual({ cover_url: null })
  })

  it('rejects a cover_url that is not an http(s) URL', () => {
    // A `javascript:` scheme, written with `void` because `noBrowserDialogs.test.ts`
    // scans every line of `src/` for a native dialog call, string or not.
    expect(() => parseGlobalSongEditPayload({ cover_url: 'javascript:void(0)' })).toThrowError(
      new Error('Invalid global song edit: cover_url must be null or an http(s) URL')
    )
    expect(() => parseGlobalSongEditPayload({ cover_url: 12 })).toThrowError(
      new Error('Invalid global song edit: cover_url must be null or an http(s) URL')
    )
  })

  it('accepts a duration_seconds that is a non-negative integer or null', () => {
    expect(parseGlobalSongEditPayload({ duration_seconds: 217 })).toEqual({ duration_seconds: 217 })
    expect(parseGlobalSongEditPayload({ duration_seconds: 0 })).toEqual({ duration_seconds: 0 })
    expect(parseGlobalSongEditPayload({ duration_seconds: null })).toEqual({ duration_seconds: null })
  })

  it('rejects a duration_seconds that is not a non-negative integer', () => {
    for (const value of ['abc', -1, 3.5]) {
      expect(() => parseGlobalSongEditPayload({ duration_seconds: value })).toThrowError(
        new Error('Invalid global song edit: duration_seconds must be a non-negative integer or null')
      )
    }
  })

  it('accepts links as an array of label/url objects with http(s) urls', () => {
    const links = [{ label: 'Chords', url: 'https://tabs.example/1' }]
    expect(parseGlobalSongEditPayload({ links })).toEqual({ links })
    expect(parseGlobalSongEditPayload({ links: [] })).toEqual({ links: [] })
  })

  it('rejects links that are not an array of label/url objects', () => {
    const invalid: unknown[] = [42, [{ label: 'x' }], [{ label: 'x', url: 'ftp://a/b' }]]
    for (const links of invalid) {
      expect(() => parseGlobalSongEditPayload({ links })).toThrowError(
        new Error('Invalid global song edit: links must be an array of {label, url} objects with http(s) urls')
      )
    }
  })

  it('ignores keys that are not global_songs columns', () => {
    // `reason` rides along inside the correction modal's payload and must be
    // dropped rather than rejected (src/components/songs/CorrectionModal.tsx).
    expect(parseGlobalSongEditPayload({ title: 'Plush', reason: 'typo in the title' })).toEqual({
      title: 'Plush',
    })
  })

  it('rejects a payload with no proposable field', () => {
    const message =
      'Invalid global song edit: at least one of title, artist, album, standard_key, cover_url, duration_seconds, links must be present'
    expect(() => parseGlobalSongEditPayload({})).toThrowError(new Error(message))
    expect(() => parseGlobalSongEditPayload({ reason: 'typo' })).toThrowError(new Error(message))
  })

  it('rejects a payload that is not a plain object', () => {
    for (const value of [null, 'x', []]) {
      expect(() => parseGlobalSongEditPayload(value)).toThrowError(
        new Error('Invalid global song edit: payload must be a plain object')
      )
    }
  })
})
