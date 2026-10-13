import { describe, it, expect } from 'vitest'
import {
  FIELD_ALREADY_REVIEWED,
  approvalNotice,
  fieldKey,
  fieldLabel,
  formatFieldValue,
  groupFieldsBySong,
} from '@/lib/pendingFields'
import type { PendingFieldGroup } from '@/types/pendingFieldGroup'

function field(songId: string, column: string): PendingFieldGroup {
  return {
    song_id: songId,
    song_title: `Title ${songId}`,
    song_artist: `Artist ${songId}`,
    target_column: column,
    current_value: null,
    total: 1,
    options: [],
  }
}

describe('pendingFields', () => {
  it('names the songs columns and shows an unknown one as stored', () => {
    expect(fieldLabel('standard_key')).toBe('Key')
    expect(fieldLabel('duration_seconds')).toBe('Duration (s)')
    expect(fieldLabel('something_else')).toBe('something_else')
    // An inherited property name is not a label.
    expect(fieldLabel('constructor')).toBe('constructor')
  })

  it('formats a value, reading null and the empty string as "(empty)"', () => {
    expect(formatFieldValue('Bm')).toBe('Bm')
    expect(formatFieldValue(192)).toBe('192')
    expect(formatFieldValue(0)).toBe('0')
    expect(formatFieldValue(null)).toBe('(empty)')
    expect(formatFieldValue(undefined)).toBe('(empty)')
    expect(formatFieldValue('')).toBe('(empty)')
    expect(formatFieldValue({ a: 1 })).toBe('{"a":1}')
  })

  it('keys a target by song and column', () => {
    expect(fieldKey(field('s1', 'title'))).toBe('s1:title')
  })

  it('folds fields into one card per song, in first-seen order', () => {
    const cards = groupFieldsBySong([field('a', 'title'), field('b', 'album'), field('a', 'artist')])

    expect(cards.map((c) => [c.song_id, c.title, c.artist, c.fields.map((f) => f.target_column)])).toEqual([
      ['a', 'Title a', 'Artist a', ['title', 'artist']],
      ['b', 'Title b', 'Artist b', ['album']],
    ])
    expect(groupFieldsBySong([])).toEqual([])
  })

  it('tells the admin how many options an approval closed', () => {
    expect(approvalNotice(0)).toBe('Approved and applied to the catalog.')
    expect(approvalNotice(1)).toBe('Approved and applied to the catalog. 1 other option closed (superseded).')
    expect(approvalNotice(4)).toBe('Approved and applied to the catalog. 4 other options closed (superseded).')
  })

  it('keeps the stale-decision message the server throws and the island reads in one place', () => {
    expect(FIELD_ALREADY_REVIEWED).toBe('Catalog suggestion is already reviewed')
  })
})
