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
  withPickerRowError,
  withoutPickerRowError,
  isAlreadyInRepertoireError,
  findRepertoireVersionIdByTrack,
  heldPickerVersionId,
} from '@/lib/songPicker'
import type { SearchVersionCandidate, SongSearchRow } from '@/lib/songSearchMerge'
import type { Song, Repertoire } from '@/types/database'

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
 * One merged picker row (RH-108). Its representative candidate defaults to the
 * version `v-<song id>`, derived rather than equal, so an assertion about a
 * version cannot pass for one about a song.
 */
function pickerRow(overrides: Partial<SongSearchRow> = {}): SongSearchRow {
  const songId = overrides.songId ?? 'song-1'
  return {
    id: 'black dog|led zeppelin',
    title: 'Black Dog',
    artist: 'Led Zeppelin',
    coverUrl: null,
    album: null,
    songId,
    versions: [versionCandidate({ versionId: `v-${songId}` })],
    ...overrides,
  }
}

function versionCandidate(
  overrides: Partial<SearchVersionCandidate> = {},
): SearchVersionCandidate {
  return {
    versionId: null,
    spotifyTrackId: null,
    rawTitle: 'Black Dog',
    albumName: null,
    albumType: null,
    releaseDate: null,
    label: null,
    durationSeconds: null,
    createdAt: null,
    coverUrl: null,
    spotifyUrl: null,
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

  it('finds a held entry for a suffixed Spotify title, which returned null at HEAD (ER13)', () => {
    const entries = [
      entry({
        id: 'rep-1',
        song_id: 'song-1',
        version_id: 'v-song-1',
        song: song({ id: 'song-1', title: 'Bad', artist: 'Michael Jackson' }),
      }),
    ]

    // At HEAD the raw-title key compared `"bad - remaster 2012"` against the
    // held entry's `"bad"`, never matched, and the user saw the raw
    // already-in-your-repertoire error instead of the row being added.
    expect(
      findRepertoireVersionIdByTrack(entries, {
        title: 'Bad - Remaster 2012',
        artist: 'Michael Jackson',
      }),
    ).toBe('v-song-1')
  })

  it('returns the lowest version id when the owner holds several, whatever the order (ER13)', () => {
    const held = (versionId: string) =>
      entry({
        id: `rep-${versionId}`,
        song_id: 'song-1',
        version_id: versionId,
        song: song({ id: 'song-1', title: 'Bad', artist: 'Michael Jackson' }),
      })
    const track = { title: 'Bad - Remaster 2012', artist: 'Michael Jackson' }

    // Post-RH-125 an owner may hold several versions of one song, so
    // `entries.find` would answer whichever the array happened to list first.
    expect(findRepertoireVersionIdByTrack([held('v-b'), held('v-a')], track)).toBe('v-a')
    expect(findRepertoireVersionIdByTrack([held('v-a'), held('v-b')], track)).toBe('v-a')
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
    const row = pickerRow()
    const held = entry({ id: 'rep-1', song_id: 'song-1', version_id: 'v-song-1' })

    it("answers the representative candidate's version when the owner holds it", () => {
      expect(heldPickerVersionId(row, new Map([['v-song-1', held]]))).toBe('v-song-1')
    })

    it('answers null when the owner holds no row for that version', () => {
      expect(heldPickerVersionId(row, new Map())).toBeNull()
      // A map keyed by the song id is not a hit: the key is the version.
      expect(heldPickerVersionId(row, new Map([['song-1', held]]))).toBeNull()
    })

    it('answers null for a row whose song has no version yet (RH-108 ER12)', () => {
      const versionless = pickerRow({ songId: 'song-1', versions: [] })

      expect(heldPickerVersionId(versionless, new Map([['v-song-1', held]]))).toBeNull()
    })

    it('answers null for a Spotify-only row — its candidate names no version', () => {
      const spotifyOnly = pickerRow({
        songId: null,
        versions: [versionCandidate({ spotifyTrackId: 'sp-aaa' })],
      })

      expect(heldPickerVersionId(spotifyOnly, new Map([['v-song-1', held]]))).toBeNull()
    })
  })
})
