import { describe, it, expect } from 'vitest'
import {
  shouldLoadPersonalEntry,
  songIdentity,
  withLyrics,
  withSongLinks,
  withStatus,
} from '@/lib/songEntry'
import type { GlobalSong, Repertoire } from '@/types/database'

const SONG: GlobalSong = {
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

const ENTRY: Repertoire = {
  id: 'rep-1',
  user_id: 'user-1',
  band_id: null,
  song_id: 'song-1',
  personal_key: null,
  status: 'learning',
  tags: [],
  last_practiced: null,
  lyrics: 'old words',
  song: SONG,
}

/** A row whose join produced no song, i.e. `entry.song` is undefined. */
const SONGLESS_ENTRY: Repertoire = { ...ENTRY, song: undefined }

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

  it('songIdentity prefers the personal key over the standard key', () => {
    expect(songIdentity({ ...ENTRY, personal_key: 'C#' }).key).toBe('C#')
  })

  it('songIdentity falls back to the standard key when there is no personal key', () => {
    expect(songIdentity(ENTRY).key).toBe('A')
    expect(songIdentity({ ...ENTRY, song: { ...SONG, standard_key: null } }).key).toBeNull()
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
    expect(patched?.id).toBe('rep-1')
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
