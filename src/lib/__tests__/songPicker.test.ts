/**
 * RH-67 — the pure decisions of the add-song picker.
 *
 * Everything the panel used to decide inline on `src/app/playlists/[id]/page.tsx`
 * — the two-character gate, the playlist filter, the catalog/Spotify dedup, the
 * per-row error map and the two halves of `resolveTrackId`'s catch — lives in
 * `src/lib/songPicker.ts` and is exercised here directly. No DOM, no timers, no
 * fetch: the module imports none, so this file needs no `@vitest-environment`
 * line.
 */

import { describe, it, expect } from 'vitest'
import {
  MIN_PICKER_QUERY_LENGTH,
  shouldSearchPicker,
  visiblePickerCatalog,
  pickerDedupKey,
  pickerCatalogKeys,
  visiblePickerSpotify,
  withPickerRowError,
  withoutPickerRowError,
  isAlreadyInRepertoireError,
  findRepertoireVersionIdByTrack,
  heldPickerVersionId,
} from '@/lib/songPicker'
import type { SpotifyTrack } from '@/lib/spotify'
import type { CatalogSearchResult, Song, Repertoire } from '@/types/database'

function song(overrides: Partial<Song> & Pick<Song, 'id' | 'title' | 'artist'>): Song {
  return {
    album: null,
    standard_key: null,
    cover_url: null,
    duration_seconds: null,
    links: [],
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * A catalog search result (RH-125): the song plus the representative version
 * the search already computed. `version_id` defaults to `v-<song id>`, derived
 * rather than equal, so a filter comparing song ids cannot pass for one
 * comparing versions.
 */
function result(
  overrides: Partial<CatalogSearchResult> & Pick<Song, 'id' | 'title' | 'artist'>,
): CatalogSearchResult {
  return { ...song(overrides), version_id: `v-${overrides.id}`, ...overrides }
}

function track(overrides: Partial<SpotifyTrack> & Pick<SpotifyTrack, 'id' | 'title' | 'artist'>): SpotifyTrack {
  return {
    album: null,
    spotifyUrl: `https://open.spotify.com/track/${overrides.id}`,
    previewUrl: null,
    albumArt: null,
    ...overrides,
  }
}

function entry(overrides: Partial<Repertoire> & Pick<Repertoire, 'id' | 'song_id'>): Repertoire {
  return {
    user_id: 'user-1',
    band_id: null,
    version_id: 'version-1',
    key: null,
    tuning: null,
    map: null,
    status: 'unknown',
    tags: [],
    last_practiced: null,
    lyrics: null,
    ...overrides,
  }
}

describe('songPicker', () => {
  it('treats a blank or one-character query as too short to search', () => {
    expect(MIN_PICKER_QUERY_LENGTH).toBe(2)
    expect(shouldSearchPicker('')).toBe(false)
    expect(shouldSearchPicker('   ')).toBe(false)
    expect(shouldSearchPicker('a')).toBe(false)
    expect(shouldSearchPicker(' a ')).toBe(false)
  })

  it('accepts a two-character query once trimmed', () => {
    expect(shouldSearchPicker('ab')).toBe(true)
    expect(shouldSearchPicker('  ab  ')).toBe(true)
    expect(shouldSearchPicker('abc')).toBe(true)
  })

  it('hides catalog results whose version is already in the playlist (RH-125 ER14)', () => {
    const results = [
      result({ id: 'song-1', title: 'Black Dog', artist: 'Led Zeppelin' }),
      result({ id: 'song-2', title: 'Kashmir', artist: 'Led Zeppelin' }),
    ]

    expect(visiblePickerCatalog(results, new Set(['v-song-1']))).toEqual([results[1]])
    // The filter compares **versions**: the song's own id names nothing in the
    // playlist's set, so a song-id comparison would hide the wrong row.
    expect(visiblePickerCatalog(results, new Set(['song-1']))).toEqual(results)
  })

  it('keeps every catalog result when the playlist holds no songs', () => {
    const results = [
      result({ id: 'song-1', title: 'Black Dog', artist: 'Led Zeppelin' }),
      result({ id: 'song-2', title: 'Kashmir', artist: 'Led Zeppelin' }),
    ]

    expect(visiblePickerCatalog(results, new Set())).toEqual(results)
  })

  it('always offers a catalog row whose song has no version yet', () => {
    const versionless = result({
      id: 'song-3',
      title: 'Seeded',
      artist: 'Catalog',
      version_id: null,
    })

    // It cannot be in any playlist — a playlist entry *is* a version — so no
    // set of version ids can hide it.
    expect(visiblePickerCatalog([versionless], new Set(['v-song-3']))).toEqual([versionless])
  })

  it('builds a dedup key from the lowercased title and artist', () => {
    expect(pickerDedupKey({ title: 'Black Dog', artist: 'Led Zeppelin' })).toBe('black dog|led zeppelin')
    expect(pickerDedupKey({ title: 'BLACK DOG', artist: 'LED ZEPPELIN' })).toBe('black dog|led zeppelin')
  })

  it('collects one dedup key per visible catalog song', () => {
    const keys = pickerCatalogKeys([
      song({ id: 'song-1', title: 'Black Dog', artist: 'Led Zeppelin' }),
      song({ id: 'song-2', title: 'Kashmir', artist: 'Led Zeppelin' }),
    ])

    expect([...keys].sort()).toEqual(['black dog|led zeppelin', 'kashmir|led zeppelin'])
  })

  it('drops a Spotify track the catalog already covers, ignoring case', () => {
    const tracks = [
      track({ id: 'sp-1', title: 'BLACK DOG', artist: 'Led ZEPPELIN' }),
      track({ id: 'sp-2', title: 'Rock and Roll', artist: 'Led Zeppelin' }),
    ]

    expect(visiblePickerSpotify(tracks, new Set(['black dog|led zeppelin']))).toEqual([tracks[1]])
  })

  it('keeps a Spotify track whose artist differs from the catalog result', () => {
    const tracks = [track({ id: 'sp-1', title: 'Black Dog', artist: 'Someone Else' })]

    expect(visiblePickerSpotify(tracks, new Set(['black dog|led zeppelin']))).toEqual(tracks)
  })

  it('records an Error message under the failing row id', () => {
    expect(withPickerRowError({}, 'song-1', new Error('Playlist is full'))).toEqual({
      'song-1': 'Playlist is full',
    })
  })

  it('records the fallback message when the thrown value is not an Error', () => {
    expect(withPickerRowError({}, 'song-1', 'boom')).toEqual({ 'song-1': 'Failed to add' })
    expect(withPickerRowError({}, 'song-1', undefined)).toEqual({ 'song-1': 'Failed to add' })
  })

  it('leaves the other rows untouched when recording an error', () => {
    const before = { 'song-2': 'Older failure' }

    expect(withPickerRowError(before, 'song-1', new Error('Nope'))).toEqual({
      'song-2': 'Older failure',
      'song-1': 'Nope',
    })
    expect(before).toEqual({ 'song-2': 'Older failure' })
  })

  it('clears only the given row id from the error map', () => {
    const before = { 'song-1': 'Nope', 'song-2': 'Older failure' }

    expect(withoutPickerRowError(before, 'song-1')).toEqual({ 'song-2': 'Older failure' })
    expect(withoutPickerRowError(before, 'song-3')).toEqual(before)
    expect(before).toEqual({ 'song-1': 'Nope', 'song-2': 'Older failure' })
  })

  it('recognises the already-in-your-repertoire message', () => {
    expect(isAlreadyInRepertoireError(new Error('Song is already in your repertoire'))).toBe(true)
    expect(isAlreadyInRepertoireError(new Error('Failed to add song'))).toBe(false)
    expect(isAlreadyInRepertoireError('already in your repertoire')).toBe(false)
  })

  it('finds the held version id matching the track title and artist, ignoring case (ER14)', () => {
    const entries = [
      entry({ id: 'rep-1', song_id: 'song-1', version_id: 'v-song-1', song: song({ id: 'song-1', title: 'Kashmir', artist: 'Led Zeppelin' }) }),
      entry({ id: 'rep-2', song_id: 'song-2', version_id: 'v-song-2', song: song({ id: 'song-2', title: 'Black Dog', artist: 'Led Zeppelin' }) }),
    ]

    // The version the owner holds, not the song it belongs to: that id is what
    // the playlist write takes.
    expect(findRepertoireVersionIdByTrack(entries, { title: 'BLACK DOG', artist: 'led zeppelin' })).toBe('v-song-2')
  })

  it('returns null when no repertoire entry matches the track', () => {
    const entries = [
      entry({ id: 'rep-1', song_id: 'song-1', song: song({ id: 'song-1', title: 'Kashmir', artist: 'Led Zeppelin' }) }),
      entry({ id: 'rep-2', song_id: 'song-2' }),
    ]

    expect(findRepertoireVersionIdByTrack(entries, { title: 'Black Dog', artist: 'Led Zeppelin' })).toBeNull()
    expect(findRepertoireVersionIdByTrack([], { title: 'Kashmir', artist: 'Led Zeppelin' })).toBeNull()
  })

  /**
   * RH-125 ER14 — a collapsed card adds the version it names.
   *
   * `heldPickerVersionId` is the one decision between "add this version
   * straight to the playlist" and "let the repertoire write resolve it first",
   * and it answers with a **version** id in the first case.
   */
  describe('heldPickerVersionId', () => {
    const card = result({ id: 'song-1', title: 'Black Dog', artist: 'Led Zeppelin' })
    const held = entry({ id: 'rep-1', song_id: 'song-1', version_id: 'v-song-1' })

    it('answers the card version when the owner already holds it', () => {
      expect(heldPickerVersionId(card, new Map([['v-song-1', held]]))).toBe('v-song-1')
    })

    it('answers null when the owner holds no row for that version', () => {
      expect(heldPickerVersionId(card, new Map())).toBeNull()
      // A map keyed by the song id is not a hit: the key is the version.
      expect(heldPickerVersionId(card, new Map([['song-1', held]]))).toBeNull()
    })

    it('answers null for a card whose song has no version yet', () => {
      const versionless = result({ id: 'song-1', title: 'Black Dog', artist: 'Led Zeppelin', version_id: null })

      expect(heldPickerVersionId(versionless, new Map([['v-song-1', held]]))).toBeNull()
    })
  })
})
