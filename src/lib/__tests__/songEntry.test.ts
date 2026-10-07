import { describe, it, expect } from 'vitest'
import {
  shouldLoadPersonalEntry,
  songIdentity,
  withLyrics,
  withSongLinks,
  withStatus,
} from '@/lib/songEntry'
import type { Song, ResolvedSongEntry } from '@/types/database'

const SONG: Song = {
  id: 'song-1',
  title: 'Black Dog',
  artist: 'Led Zeppelin',
  album: 'IV',
  standard_key: 'A',
  cover_url: null,
  duration_seconds: null,
  links: [{ label: 'Chords', url: 'https://cifraclub.com.br/black-dog' }],
  created_at: '2026-01-01T00:00:00.000Z',
}

/**
 * The route entry is a `ResolvedSongEntry` since RH-132: Fast View addresses a
 * `song_versions.id` and the owner's row may not exist, so `id` / `user_id` /
 * `band_id` are gone and `ownerRowId` is nullable. The four helpers below read
 * only `song`, `key`, `status` and `lyrics`, all present on both shapes.
 */
const ENTRY: ResolvedSongEntry = {
  ownerRowId: 'rep-1',
  song_id: 'song-1',
  version_id: 'version-1',
  key: null,
  tuning: null,
  map: null,
  status: 'learning',
  tags: [],
  last_practiced: null,
  lyrics: 'old words',
  song: SONG,
}

/** A row whose join produced no song, i.e. `entry.song` is undefined. */
const SONGLESS_ENTRY: ResolvedSongEntry = { ...ENTRY, song: undefined }

describe('songEntry', () => {
  it('shouldLoadPersonalEntry is false outside a band', () => {
    expect(shouldLoadPersonalEntry(null, 'song-1')).toBe(false)
  })

  it('shouldLoadPersonalEntry is false when the song id is not known yet', () => {
    expect(shouldLoadPersonalEntry('band-1', null)).toBe(false)
    expect(shouldLoadPersonalEntry('band-1', undefined)).toBe(false)
  })

  it('shouldLoadPersonalEntry is true for a band entry with a song id', () => {
    expect(shouldLoadPersonalEntry('band-1', 'song-1')).toBe(true)
  })

  it('songIdentity falls back to (untitled) when the entry carries no song', () => {
    expect(songIdentity(null)).toEqual({ title: '(untitled)', artist: '', key: null })
    expect(songIdentity(SONGLESS_ENTRY)).toEqual({ title: '(untitled)', artist: '', key: null })
  })

  it('songIdentity reads the title and the artist from the song', () => {
    const identity = songIdentity(ENTRY)

    expect(identity.title).toBe('Black Dog')
    expect(identity.artist).toBe('Led Zeppelin')
  })

  it('songIdentity prefers the owner\'s resolved key over the catalog standard key', () => {
    expect(songIdentity({ ...ENTRY, key: 'C#' }).key).toBe('C#')
  })

  it('songIdentity falls back to the standard key when there is no personal key', () => {
    expect(songIdentity(ENTRY).key).toBe('A')
    expect(songIdentity({ ...ENTRY, song: { ...SONG, standard_key: null } }).key).toBeNull()
  })

  it('withStatus carries a null status through, which Repertoire could not hold', () => {
    // `ResolvedSongEntry.status` is nullable: an owner holding no row at this
    // version has no mastery status, and `unknown` is the page's fallback, not
    // the stored value (RH-132 §3).
    const noRow: ResolvedSongEntry = { ...ENTRY, ownerRowId: null, status: null, tags: [] }

    expect(noRow.status).toBeNull()
    expect(withStatus(noRow, 'mastered')?.status).toBe('mastered')
    expect(withStatus(noRow, 'mastered')?.ownerRowId).toBeNull()
  })

  it('withStatus returns a new entry carrying the new status', () => {
    const patched = withStatus(ENTRY, 'mastered')

    expect(patched?.status).toBe('mastered')
    expect(patched).not.toBe(ENTRY)
    // The input is left alone: the page's `prev => ({ ...prev })` semantics.
    expect(ENTRY.status).toBe('learning')
  })

  it('withStatus returns null for a null entry', () => {
    expect(withStatus(null, 'mastered')).toBeNull()
  })

  it('withSongLinks replaces the song links and leaves the rest of the entry untouched', () => {
    const links = [{ label: 'Video', url: 'https://youtube.com/watch?v=1' }]
    const patched = withSongLinks(ENTRY, links)

    expect(patched?.song?.links).toEqual(links)
    expect(patched?.ownerRowId).toBe('rep-1')
    expect(patched?.status).toBe('learning')
    expect(patched).not.toBe(ENTRY)
    expect(ENTRY.song?.links).toEqual([{ label: 'Chords', url: 'https://cifraclub.com.br/black-dog' }])
  })

  it('withSongLinks returns the entry unchanged when it carries no song', () => {
    expect(withSongLinks(SONGLESS_ENTRY, [])).toBe(SONGLESS_ENTRY)
    expect(withSongLinks(null, [])).toBeNull()
  })

  it('withLyrics returns a new entry carrying the saved lyrics', () => {
    const patched = withLyrics(ENTRY, 'new words')

    expect(patched?.lyrics).toBe('new words')
    expect(patched).not.toBe(ENTRY)
    expect(ENTRY.lyrics).toBe('old words')
  })

  it('withLyrics returns null for a null entry', () => {
    expect(withLyrics(null, 'new words')).toBeNull()
  })
})
