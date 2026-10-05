/**
 * RH-97 — the pure half of "stop discarding song edits silently".
 *
 * `splitCatalogUpdate` is the whole decision `updateSong` used to make inside a
 * `CASE WHEN` and never reported: which shared columns a proposal may fill, and
 * which ones it is refused on. It touches no database, so every rule it carries
 * — emptiness per column type, equality after trimming, the ordered link list,
 * `standard_key`'s exemption from refusal — is testable here rather than only
 * against Postgres.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CATALOG_FIELD_LABELS,
  catalogDraftFromRefusals,
  catalogDraftFromSong,
  changedCatalogFields,
  describeCatalogValue,
  isCatalogFieldEmpty,
  parseDurationInput,
  splitCatalogUpdate,
  type CatalogProposal,
  type CatalogSnapshot,
} from '@/lib/catalogFields'

const EMPTY_SNAPSHOT: CatalogSnapshot = {
  title: null,
  artist: null,
  album: null,
  standard_key: null,
  cover_url: null,
  duration_seconds: null,
  links: null,
}

const PROPOSAL: CatalogProposal = {
  title: 'Smooth Criminal',
  artist: 'Michael Jackson',
  album: 'Bad',
  standard_key: 'Am',
  cover_url: 'https://example.com/bad.jpg',
  duration_seconds: 257,
  links: [{ label: 'YouTube', url: 'https://youtu.be/abc' }],
}

const fillOf = (snapshot: CatalogSnapshot, proposal: CatalogProposal = PROPOSAL) =>
  Object.fromEntries(splitCatalogUpdate(snapshot, proposal).fill.map((f) => [f.column, f.value]))

describe('isCatalogFieldEmpty keeps the catalog\'s per-column definition of empty', () => {
  it('treats NULL and the empty string as empty for every text column', () => {
    for (const column of ['title', 'artist', 'album', 'standard_key', 'cover_url'] as const) {
      expect(isCatalogFieldEmpty({ ...EMPTY_SNAPSHOT }, column)).toBe(true)
      expect(isCatalogFieldEmpty({ ...EMPTY_SNAPSHOT, [column]: '' }, column)).toBe(true)
      expect(isCatalogFieldEmpty({ ...EMPTY_SNAPSHOT, [column]: 'x' }, column)).toBe(false)
    }
  })

  it('treats only NULL as empty for duration_seconds, so 0 counts as a value', () => {
    expect(isCatalogFieldEmpty(EMPTY_SNAPSHOT, 'duration_seconds')).toBe(true)
    expect(isCatalogFieldEmpty({ ...EMPTY_SNAPSHOT, duration_seconds: 0 }, 'duration_seconds')).toBe(false)
  })

  it('treats NULL and the empty array as empty for links', () => {
    expect(isCatalogFieldEmpty(EMPTY_SNAPSHOT, 'links')).toBe(true)
    expect(isCatalogFieldEmpty({ ...EMPTY_SNAPSHOT, links: [] }, 'links')).toBe(true)
    expect(
      isCatalogFieldEmpty(
        { ...EMPTY_SNAPSHOT, links: [{ label: 'a', url: 'https://a.test' }] },
        'links',
      ),
    ).toBe(false)
  })
})

describe('splitCatalogUpdate fills what is empty', () => {
  it('fills every column of a blank catalog row and refuses nothing', () => {
    const { fill, refused } = splitCatalogUpdate(EMPTY_SNAPSHOT, PROPOSAL)

    expect(refused).toEqual([])
    expect(fill.map((f) => f.column)).toEqual([
      'title',
      'artist',
      'album',
      'standard_key',
      'cover_url',
      'duration_seconds',
      'links',
    ])
    expect(fill.find((f) => f.column === 'links')).toEqual({
      column: 'links',
      value: JSON.stringify(PROPOSAL.links),
      cast: '::jsonb',
    })
    expect(fill.find((f) => f.column === 'title')?.cast).toBe('')
  })

  it('trims the value it writes', () => {
    const fill = fillOf(EMPTY_SNAPSHOT, { ...PROPOSAL, artist: '  Michael Jackson  ' })
    expect(fill.artist).toBe('Michael Jackson')
  })

  it('leaves a column alone when the proposal has nothing for it', () => {
    const { fill, refused } = splitCatalogUpdate(EMPTY_SNAPSHOT, {
      ...PROPOSAL,
      album: null,
      cover_url: '   ',
      duration_seconds: null,
      links: [],
    })

    expect(refused).toEqual([])
    expect(fill.map((f) => f.column)).toEqual(['title', 'artist', 'standard_key'])
  })
})

describe('splitCatalogUpdate refuses what is populated and different', () => {
  it('names the column with its current and proposed value', () => {
    const { fill, refused } = splitCatalogUpdate(
      { ...EMPTY_SNAPSHOT, artist: 'Michael Jackson' },
      { ...PROPOSAL, artist: 'Micheal Jackson' },
    )

    expect(refused).toEqual([
      { column: 'artist', current: 'Michael Jackson', proposed: 'Micheal Jackson' },
    ])
    expect(fill.some((f) => f.column === 'artist')).toBe(false)
  })

  it('never refuses standard_key, however different the proposal is', () => {
    const { fill, refused } = splitCatalogUpdate(
      { ...EMPTY_SNAPSHOT, standard_key: 'G' },
      { ...PROPOSAL, standard_key: 'Am' },
    )

    expect(refused).toEqual([])
    expect(fill.some((f) => f.column === 'standard_key')).toBe(false)
  })

  it('compares text after trimming, so an untouched value is not a refusal', () => {
    const { refused } = splitCatalogUpdate(
      { ...EMPTY_SNAPSHOT, title: 'Smooth Criminal', artist: 'Michael Jackson' },
      { ...PROPOSAL, title: '  Smooth Criminal  ', artist: 'Michael Jackson' },
    )

    expect(refused).toEqual([])
  })

  it('compares duration_seconds as an integer', () => {
    expect(
      splitCatalogUpdate({ ...EMPTY_SNAPSHOT, duration_seconds: 257 }, PROPOSAL).refused,
    ).toEqual([])
    expect(
      splitCatalogUpdate(
        { ...EMPTY_SNAPSHOT, duration_seconds: 258 },
        PROPOSAL,
      ).refused,
    ).toEqual([{ column: 'duration_seconds', current: 258, proposed: 257 }])
  })

  it('compares links as an ordered {label,url} list', () => {
    const one = { label: 'YouTube', url: 'https://youtu.be/abc' }
    const two = { label: 'Chords', url: 'https://chords.test/a' }

    expect(splitCatalogUpdate({ ...EMPTY_SNAPSHOT, links: [one] }, PROPOSAL).refused).toEqual([])

    const reordered = splitCatalogUpdate(
      { ...EMPTY_SNAPSHOT, links: [one, two] },
      { ...PROPOSAL, links: [two, one] },
    )
    expect(reordered.refused).toEqual([
      { column: 'links', current: [one, two], proposed: [two, one] },
    ])

    const grown = splitCatalogUpdate(
      { ...EMPTY_SNAPSHOT, links: [one] },
      { ...PROPOSAL, links: [one, two] },
    )
    expect(grown.refused).toEqual([{ column: 'links', current: [one], proposed: [one, two] }])
    expect(grown.fill.some((f) => f.column === 'links')).toBe(false)
  })

  it('reports the refusals in column order, next to the columns it still fills', () => {
    const { fill, refused } = splitCatalogUpdate(
      {
        ...EMPTY_SNAPSHOT,
        title: 'Smooth Criminal',
        artist: 'Michael Jackson',
        duration_seconds: 300,
      },
      { ...PROPOSAL, title: 'Smooth Criminal', artist: 'MJ' },
    )

    expect(refused.map((r) => r.column)).toEqual(['artist', 'duration_seconds'])
    expect(fill.map((f) => f.column)).toEqual(['album', 'standard_key', 'cover_url', 'links'])
  })
})

describe('catalogDraftFromSong renders the catalog row as form text', () => {
  it('turns every absent value into an empty string and keeps the link list', () => {
    expect(catalogDraftFromSong(EMPTY_SNAPSHOT)).toEqual({
      title: '',
      artist: '',
      album: '',
      standard_key: '',
      cover_url: '',
      duration: '',
      links: [],
    })
  })

  it('renders duration_seconds as its own digits, including zero', () => {
    expect(catalogDraftFromSong({ ...EMPTY_SNAPSHOT, duration_seconds: 0 }).duration).toBe('0')
    expect(catalogDraftFromSong({ ...EMPTY_SNAPSHOT, duration_seconds: 257 }).duration).toBe('257')
  })
})

describe('parseDurationInput accepts both shapes the form offers', () => {
  it('reads mm:ss and bare seconds, and rejects anything else', () => {
    expect(parseDurationInput('3:45')).toBe(225)
    expect(parseDurationInput('225')).toBe(225)
    expect(parseDurationInput('  225  ')).toBe(225)
    expect(parseDurationInput('')).toBeNull()
    expect(parseDurationInput('   ')).toBeNull()
    expect(parseDurationInput('abc')).toBeNull()
    expect(parseDurationInput('a:b')).toBeNull()
  })
})

describe('changedCatalogFields emits only what the user actually changed', () => {
  const base = catalogDraftFromSong({
    title: 'Smooth Criminal',
    artist: 'Michael Jackson',
    album: 'Bad',
    standard_key: 'G',
    cover_url: 'https://example.com/bad.jpg',
    duration_seconds: 257,
    links: [{ label: 'YouTube', url: 'https://youtu.be/abc' }],
  })

  it('returns nothing when the draft is the catalog value retyped', () => {
    expect(changedCatalogFields(base, { ...base })).toEqual({})
    expect(changedCatalogFields(base, { ...base, artist: '  Michael Jackson  ' })).toEqual({})
    expect(changedCatalogFields(base, { ...base, duration: '4:17' })).toEqual({})
  })

  it('returns exactly the one field that moved', () => {
    expect(changedCatalogFields(base, { ...base, artist: 'MJ' })).toEqual({ artist: 'MJ' })
    expect(changedCatalogFields(base, { ...base, duration: '3:45' })).toEqual({
      duration_seconds: 225,
    })
  })

  it('normalizes a cleared optional field to null, the way the catalog stores it', () => {
    expect(changedCatalogFields(base, { ...base, album: '' })).toEqual({ album: null })
    expect(changedCatalogFields(base, { ...base, standard_key: '  ' })).toEqual({
      standard_key: null,
    })
    expect(changedCatalogFields(base, { ...base, cover_url: '' })).toEqual({ cover_url: null })
    expect(changedCatalogFields(base, { ...base, duration: '' })).toEqual({
      duration_seconds: null,
    })
  })

  it('emits links only when the ordered list differs, dropping rows with no url', () => {
    const one = { label: 'YouTube', url: 'https://youtu.be/abc' }
    const two = { label: 'Chords', url: 'https://chords.test/a' }

    expect(changedCatalogFields(base, { ...base, links: [{ ...one }] })).toEqual({})
    expect(changedCatalogFields(base, { ...base, links: [one, two] })).toEqual({
      links: [one, two],
    })
    expect(
      changedCatalogFields(base, { ...base, links: [one, { label: 'x', url: '  ' }] }),
    ).toEqual({})
    expect(changedCatalogFields(base, { ...base, links: [] })).toEqual({ links: [] })
  })

  it('never emits a title or artist the catalog could not store', () => {
    expect(changedCatalogFields(base, { ...base, title: '   ' })).toEqual({})
    expect(changedCatalogFields(base, { ...base, artist: '' })).toEqual({})
  })
})

/**
 * RH-97 ER10. The claim is about `src/lib/songs.ts`, not about this module, but
 * it belongs to the same change and a one-line comment is not worth a test file
 * of its own: `updateSong`'s comment used to say the correction mechanism was
 * "not yet built" while `CorrectionModal` sat in the component tree already.
 */
describe('songs.ts no longer claims the correction mechanism is missing (ER10)', () => {
  const source = readFileSync(resolve(__dirname, '..', 'songs.ts'), 'utf8')

  it('has dropped the stale claim', () => {
    expect(source).not.toContain('not yet built')
  })

  it('names CorrectionModal as the route for a refused field', () => {
    expect(source).toContain('CorrectionModal')
  })
})

describe('catalogDraftFromRefusals carries the refused wording into the correction form', () => {
  it('maps every refusable column onto its draft field', () => {
    const links = [{ label: 'YouTube', url: 'https://youtu.be/abc' }]

    expect(
      catalogDraftFromRefusals([
        { column: 'title', current: 'Smooth Criminal', proposed: 'Smooth Criminal (Live)' },
        { column: 'duration_seconds', current: 257, proposed: 300 },
        { column: 'links', current: [], proposed: links },
      ]),
    ).toEqual({
      title: 'Smooth Criminal (Live)',
      duration: '300',
      links,
    })
  })

  it('returns nothing when nothing was refused', () => {
    expect(catalogDraftFromRefusals([])).toEqual({})
  })
})

describe('describeCatalogValue states a value the way the refusal notice reads', () => {
  it('counts links, names nothing for an absent value, and prints the rest', () => {
    expect(describeCatalogValue([])).toBe('0 links')
    expect(describeCatalogValue([{ label: 'a', url: 'https://a.test' }])).toBe('1 link')
    expect(
      describeCatalogValue([
        { label: 'a', url: 'https://a.test' },
        { label: 'b', url: 'https://b.test' },
      ]),
    ).toBe('2 links')
    expect(describeCatalogValue(null)).toBe('nothing')
    expect(describeCatalogValue('')).toBe('nothing')
    expect(describeCatalogValue('Michael Jackson')).toBe('Michael Jackson')
    expect(describeCatalogValue(257)).toBe('257')
  })

  it('labels every refusable column', () => {
    expect(Object.keys(CATALOG_FIELD_LABELS).sort()).toEqual([
      'album',
      'artist',
      'cover_url',
      'duration_seconds',
      'links',
      'title',
    ])
  })
})

describe('catalogDraftFromRefusals is defensive about the shape it is handed', () => {
  it('falls back to an empty draft value for a refusal with no usable proposal', () => {
    expect(
      catalogDraftFromRefusals([
        { column: 'album', current: 'Bad', proposed: null },
        { column: 'duration_seconds', current: 257, proposed: null },
        { column: 'links', current: [], proposed: 'not a list' },
      ]),
    ).toEqual({ album: '', duration: '', links: [] })
  })
})
