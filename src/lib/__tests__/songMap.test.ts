import { describe, it, expect } from 'vitest'
import {
  addDraftSection,
  draftToMap,
  moveDraftSection,
  mapToDraft,
  mapSavedMessage,
  normalizeSongMap,
  parseSongMap,
  removeDraftSection,
  renameDraftSection,
  validateSongMapPayload,
  withMap,
} from '@/lib/songMap'
import type { ResolvedSongEntry } from '@/types/database'

const MAP = {
  sections: [
    { name: 'Intro', bars: 4, note: null },
    { name: 'Verse', bars: null, note: 'palm mute' },
  ],
}

describe('parseSongMap', () => {
  it('round-trips a valid blob', () => {
    expect(parseSongMap(JSON.parse(JSON.stringify(MAP)))).toEqual(MAP)
  })

  it('fills absent bars and note with null', () => {
    expect(parseSongMap({ sections: [{ name: 'Solo' }] })).toEqual({
      sections: [{ name: 'Solo', bars: null, note: null }],
    })
  })

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['an array', []],
    ['an empty object', {}],
    ['a legacy shape', { intro: 4 }],
    ['sections not an array', { sections: 'x' }],
    ['a section that is not an object', { sections: ['x'] }],
    ['a null section', { sections: [null] }],
    ['a nameless section', { sections: [{ bars: 4 }] }],
    ['a non-string note', { sections: [{ name: 'a', note: 3 }] }],
    ['a non-numeric bars', { sections: [{ name: 'a', bars: '4' }] }],
  ])('returns null for %s', (_label, blob) => {
    expect(parseSongMap(blob)).toBeNull()
  })
})

describe('normalizeSongMap', () => {
  it('trims names and notes and drops blank-named sections', () => {
    expect(
      normalizeSongMap({
        sections: [
          { name: '  Chorus ', bars: 8, note: '  big  ' },
          { name: '   ', bars: 2, note: null },
          { name: 'Bridge', bars: null, note: '   ' },
        ],
      }),
    ).toEqual({
      sections: [
        { name: 'Chorus', bars: 8, note: 'big' },
        { name: 'Bridge', bars: null, note: null },
      ],
    })
  })

  it.each([
    [0, null],
    [-3, null],
    [2.5, null],
    [Number.NaN, null],
    [Infinity, null],
    [16, 16],
  ])('coerces bars %s to %s', (bars, expected) => {
    expect(normalizeSongMap({ sections: [{ name: 'A', bars, note: null }] })?.sections[0].bars).toBe(expected)
  })

  it('turns an empty list or null into null', () => {
    expect(normalizeSongMap({ sections: [] })).toBeNull()
    expect(normalizeSongMap({ sections: [{ name: ' ', bars: 1, note: null }] })).toBeNull()
    expect(normalizeSongMap(null)).toBeNull()
  })
})

describe('validateSongMapPayload', () => {
  it('returns the normalised map for a valid payload and null for null', () => {
    expect(validateSongMapPayload({ sections: [{ name: ' A ', bars: 0, note: null }] })).toEqual({
      sections: [{ name: 'A', bars: null, note: null }],
    })
    expect(validateSongMapPayload(null)).toBeNull()
  })

  it('throws for a payload that is not a song map', () => {
    expect(() => validateSongMapPayload({ sections: 'nope' })).toThrow('Invalid song map')
    expect(() => validateSongMapPayload('x')).toThrow('Invalid song map')
  })
})

describe('draft helpers', () => {
  it('converts a map to a draft and back', () => {
    const draft = mapToDraft(MAP)
    expect(draft.map((s) => [s.name, s.bars, s.note])).toEqual([
      ['Intro', '4', ''],
      ['Verse', '', 'palm mute'],
    ])
    expect(draftToMap(draft)).toEqual(MAP)
  })

  it('starts from an empty draft for no map', () => {
    expect(mapToDraft(null)).toEqual([])
    expect(draftToMap([])).toBeNull()
  })

  it('reads bars text as a positive integer, otherwise null', () => {
    const draft = [
      { id: 'a', name: 'A', bars: ' 8 ', note: '' },
      { id: 'b', name: 'B', bars: 'x', note: '' },
      { id: 'c', name: 'C', bars: '0', note: '' },
    ]
    expect(draftToMap(draft)?.sections.map((s) => s.bars)).toEqual([8, null, null])
  })

  it('adds a section with a fresh id, removes, renames and moves', () => {
    let draft = mapToDraft(MAP)
    draft = addDraftSection(draft)
    expect(draft).toHaveLength(3)
    expect(new Set(draft.map((s) => s.id)).size).toBe(3)

    draft = renameDraftSection(draft, 2, { name: 'Outro' })
    expect(draft[2].name).toBe('Outro')

    draft = moveDraftSection(draft, 2, -1)
    expect(draft.map((s) => s.name)).toEqual(['Intro', 'Outro', 'Verse'])
    draft = moveDraftSection(draft, 0, -1)
    expect(draft.map((s) => s.name)).toEqual(['Intro', 'Outro', 'Verse'])
    draft = moveDraftSection(draft, 2, 1)
    expect(draft.map((s) => s.name)).toEqual(['Intro', 'Outro', 'Verse'])
    draft = moveDraftSection(draft, 0, 1)
    expect(draft.map((s) => s.name)).toEqual(['Outro', 'Intro', 'Verse'])

    draft = removeDraftSection(draft, 1)
    expect(draft.map((s) => s.name)).toEqual(['Outro', 'Verse'])
  })
})

describe('withMap and mapSavedMessage', () => {
  const entry = { map: null, mapOverridden: false } as ResolvedSongEntry

  it('patches the map and the override marker; a null entry stays null', () => {
    expect(withMap(entry, MAP)).toMatchObject({ map: MAP, mapOverridden: true })
    expect(withMap({ ...entry, map: MAP, mapOverridden: true }, null)).toMatchObject({ map: null, mapOverridden: false })
    expect(withMap(null, MAP)).toBeNull()
  })

  it('words the Toast', () => {
    expect(mapSavedMessage(MAP)).toBe('Map saved')
    expect(mapSavedMessage(null)).toBe('Map cleared')
  })
})
