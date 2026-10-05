/**
 * RH-122 — the `" - "` split that replaces the deleted title sanitizer.
 *
 * The old sanitizer *stripped* the right-hand half and threw it away, which
 * made `"Bad - Remaster 2012"` indistinguishable from `"Bad"`. The catalog now
 * has somewhere to put it (`song_versions.label`), so the title splits instead:
 * the left half is the song's identity, the right half is the version's label.
 *
 * Every case below is a pinned outcome, not an illustration — the plpgsql
 * halves in the migration have to agree with these exact answers, and
 * `catalogVersions.db.test.ts` replays this table against them.
 */

import { describe, it, expect } from 'vitest'
import { splitSongTitle } from '../songTitle'

describe('splitSongTitle', () => {
  it('splits a remaster suffix into title and label (ER7)', () => {
    expect(splitSongTitle('Still Of The Night - 2018 Remaster')).toEqual({
      title: 'Still Of The Night',
      label: '2018 Remaster',
    })
  })

  it('splits a live suffix the old sanitizer deliberately preserved (ER7)', () => {
    expect(splitSongTitle('Smooth Criminal - Live at Wembley')).toEqual({
      title: 'Smooth Criminal',
      label: 'Live at Wembley',
    })
  })

  it('returns the whole string and a null label when there is no separator (ER7)', () => {
    expect(splitSongTitle('Hotel California')).toEqual({
      title: 'Hotel California',
      label: null,
    })
  })

  it('drops a dangling separator and reports no label for `Song - ` (ER7)', () => {
    const split = splitSongTitle('Song - ')
    expect(split).toEqual({ title: 'Song', label: null })
    expect(split.title).not.toBe('')
  })

  it('keeps a non-empty title and no label for an empty left half (ER7)', () => {
    const split = splitSongTitle(' - Live')
    expect(split.label).toBeNull()
    expect(split.title).not.toBe('')
    expect(split.title).toBe('- Live')
  })

  it('keeps everything after the first separator in one label', () => {
    expect(splitSongTitle('Song - Live - 2012 Remaster')).toEqual({
      title: 'Song',
      label: 'Live - 2012 Remaster',
    })
  })

  it('trims both halves and collapses the whitespace around the separator', () => {
    expect(splitSongTitle('   Black Dog   -   2007 Remaster   ')).toEqual({
      title: 'Black Dog',
      label: '2007 Remaster',
    })
  })

  it('leaves a parenthesised edition inside the title — no vocabulary of special words', () => {
    expect(splitSongTitle("Sweet Child O' Mine (2022 Remastered)")).toEqual({
      title: "Sweet Child O' Mine (2022 Remastered)",
      label: null,
    })
  })

  it('leaves a hyphenated word alone: the separator is spaced', () => {
    expect(splitSongTitle('Jack-in-the-box')).toEqual({ title: 'Jack-in-the-box', label: null })
  })

  it('never strips remaster noise that carries no separator', () => {
    expect(splitSongTitle('2018 Remaster')).toEqual({ title: '2018 Remaster', label: null })
  })

  it('returns an empty title only for empty input', () => {
    expect(splitSongTitle('   ')).toEqual({ title: '', label: null })
  })

  it('keeps a bare separator as its own title rather than emptying it', () => {
    expect(splitSongTitle('-')).toEqual({ title: '-', label: null })
  })
})
