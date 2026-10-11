import { describe, it, expect } from 'vitest'
import {
  computePlaylistNav,
  fastViewHref,
  slideDirection,
  swipeTarget,
  keyboardTarget,
  slideOutClassName,
  backTarget,
  SWIPE_THRESHOLD_PX,
  type NavKeyPress,
  type PlaylistEntry,
  type PlaylistNav,
} from '../playlistNav'

const ENTRIES: PlaylistEntry[] = [
  { repertoireId: 'rep-1', versionId: 'v-1', songId: 'song-1', title: 'Black Dog', artist: 'Led Zeppelin' },
  { repertoireId: 'rep-2', versionId: 'v-2', songId: 'song-2', title: 'Rosanna', artist: 'Toto' },
  { repertoireId: 'rep-3', versionId: 'v-3', songId: 'song-3', title: 'Untitled', artist: null },
]

const MAIN_CLASSES =
  'min-h-screen px-6 py-8 flex flex-col gap-6 max-w-xl mx-auto transition-transform duration-200 ease-in-out '

function navAt(index: number): PlaylistNav {
  const nav = computePlaylistNav(ENTRIES, ENTRIES[index].versionId, 'Gig')
  if (!nav) throw new Error('fixture entry is not in the fixture playlist')
  return nav
}

describe('computePlaylistNav', () => {
  it('reports position, total, previous and next for a middle entry', () => {
    expect(computePlaylistNav(ENTRIES, 'v-2', 'Gig')).toEqual({
      prevId: 'v-1',
      nextId: 'v-3',
      position: 2,
      total: 3,
      queueLabel: 'Gig',
    })
  })

  /** RH-133 ER5 — the ends are absent, and neither end sees the other. */
  it('reports no previous for the first entry and no next for the last, with no wraparound', () => {
    expect(computePlaylistNav(ENTRIES, 'v-1', 'Gig')).toMatchObject({
      prevId: null,
      nextId: 'v-2',
      position: 1,
    })
    expect(computePlaylistNav(ENTRIES, 'v-3', 'Gig')).toMatchObject({
      prevId: 'v-2',
      nextId: null,
      position: 3,
    })
    // Stated as its own assertion: a wrapping implementation would name the
    // opposite end here rather than nothing.
    expect(computePlaylistNav(ENTRIES, 'v-1', 'Gig')?.prevId).not.toBe('v-3')
    expect(computePlaylistNav(ENTRIES, 'v-3', 'Gig')?.nextId).not.toBe('v-1')
  })

  it('returns null when the entry list is empty', () => {
    expect(computePlaylistNav([], 'v-1', 'Gig')).toBeNull()
  })

  it('returns null when the current version id is not in the list', () => {
    expect(computePlaylistNav(ENTRIES, 'v-99', 'Gig')).toBeNull()
  })

  it('matches on the version id, never on the owner row id', () => {
    // The route param is a `song_versions.id` since RH-132; an owner row id is
    // not an address any more and must not resolve to a position.
    expect(computePlaylistNav(ENTRIES, 'rep-2', 'Gig')).toBeNull()
  })

  it('carries the queue label through unchanged', () => {
    const nav = computePlaylistNav(ENTRIES, 'v-1', 'Saturday • set 2')
    expect(nav?.queueLabel).toBe('Saturday • set 2')
  })

  it('labels a queue that is not a playlist at all', () => {
    // RH-133: the field is the *queue's* label, so a practice session or a
    // hand-picked selection can name itself without pretending to be a
    // playlist.
    expect(computePlaylistNav(ENTRIES, 'v-2', 'Practice session')?.queueLabel).toBe(
      'Practice session',
    )
  })
})

describe('fastViewHref', () => {
  it('carries the band id and nothing else', () => {
    expect(fastViewHref('v-2', 'band-7')).toBe('/songs/v-2/fast-view?bandId=band-7')
  })

  it('keeps the bare trailing ? when there is no band id', () => {
    // Byte-for-byte deliberate (RH-48): the `?` survives so a bookmark made by
    // either version of the page stays comparable.
    expect(fastViewHref('v-2', null)).toBe('/songs/v-2/fast-view?')
    expect(fastViewHref('v-2', '')).toBe('/songs/v-2/fast-view?')
  })

  it('percent-encodes the band id', () => {
    expect(fastViewHref('v-2', 'band 7&8')).toBe('/songs/v-2/fast-view?bandId=band+7%268')
  })
})

describe('slideDirection', () => {
  it('slides left when the target is further down the setlist', () => {
    expect(slideDirection(ENTRIES, 'v-1', 'v-3')).toBe('left')
  })

  it('slides right when the target is further up the setlist', () => {
    expect(slideDirection(ENTRIES, 'v-3', 'v-1')).toBe('right')
    // Neither id in the list: both indexes are -1, so it is not "further down".
    expect(slideDirection(ENTRIES, 'v-99', 'v-98')).toBe('right')
  })
})

describe('swipeTarget', () => {
  it('ignores a horizontal movement below the 60 pixel threshold', () => {
    expect(SWIPE_THRESHOLD_PX).toBe(60)
    expect(swipeTarget(59, navAt(1))).toBeNull()
    expect(swipeTarget(-59, navAt(1))).toBeNull()
    expect(swipeTarget(0, navAt(1))).toBeNull()
    expect(swipeTarget(120, null)).toBeNull()
  })

  it('advances to the next entry on a leftward swipe', () => {
    expect(swipeTarget(60, navAt(1))).toEqual({ versionId: 'v-3', direction: 'left' })
    expect(swipeTarget(140, navAt(0))).toEqual({ versionId: 'v-2', direction: 'left' })
  })

  it('returns to the previous entry on a rightward swipe', () => {
    expect(swipeTarget(-60, navAt(1))).toEqual({ versionId: 'v-1', direction: 'right' })
    expect(swipeTarget(-140, navAt(2))).toEqual({ versionId: 'v-2', direction: 'right' })
  })

  it('returns null when the requested direction has no neighbour', () => {
    expect(swipeTarget(140, navAt(2))).toBeNull()
    expect(swipeTarget(-140, navAt(0))).toBeNull()
  })
})

describe('keyboardTarget', () => {
  const press = (overrides: Partial<NavKeyPress> = {}): NavKeyPress => ({
    key: 'ArrowRight',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    editableTarget: false,
    ...overrides,
  })

  it('advances to the next entry on ArrowRight', () => {
    expect(keyboardTarget(press(), navAt(1))).toEqual({ versionId: 'v-3', direction: 'left' })
  })

  it('returns to the previous entry on ArrowLeft', () => {
    expect(keyboardTarget(press({ key: 'ArrowLeft' }), navAt(1))).toEqual({
      versionId: 'v-1',
      direction: 'right',
    })
  })

  it('treats ArrowDown as next and ArrowUp as previous, for page-turner pedals', () => {
    expect(keyboardTarget(press({ key: 'ArrowDown' }), navAt(1))).toEqual({ versionId: 'v-3', direction: 'left' })
    expect(keyboardTarget(press({ key: 'ArrowUp' }), navAt(1))).toEqual({ versionId: 'v-1', direction: 'right' })
    expect(keyboardTarget(press({ key: 'ArrowDown' }), navAt(2))).toBeNull()
    expect(keyboardTarget(press({ key: 'ArrowUp' }), navAt(0))).toBeNull()
  })

  it('returns null at either end of the setlist', () => {
    expect(keyboardTarget(press(), navAt(2))).toBeNull()
    expect(keyboardTarget(press({ key: 'ArrowLeft' }), navAt(0))).toBeNull()
  })

  it('returns null without a nav and for any other key', () => {
    expect(keyboardTarget(press(), null)).toBeNull()
    expect(keyboardTarget(press({ key: 'Enter' }), navAt(1))).toBeNull()
  })

  it('returns null for a modified key, so browser shortcuts like Alt+Left keep working', () => {
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
      expect(keyboardTarget(press({ [modifier]: true }), navAt(1))).toBeNull()
    }
  })

  it('returns null while typing or when the event was already handled', () => {
    expect(keyboardTarget(press({ editableTarget: true }), navAt(1))).toBeNull()
    expect(keyboardTarget(press({ defaultPrevented: true }), navAt(1))).toBeNull()
  })
})

describe('slideOutClassName', () => {
  it('returns the untranslated classes when no slide is in progress', () => {
    expect(slideOutClassName(null)).toBe(`${MAIN_CLASSES}translate-x-0`)
  })

  it('translates the page fully left and fully right', () => {
    expect(slideOutClassName('left')).toBe(`${MAIN_CLASSES}-translate-x-full`)
    expect(slideOutClassName('right')).toBe(`${MAIN_CLASSES}translate-x-full`)
  })
})

describe('backTarget', () => {
  it('pushes the recorded origin when there is one, and falls back to history when there is not', () => {
    expect(backTarget('/playlists/pl-1')).toEqual({ kind: 'push', href: '/playlists/pl-1' })
    expect(backTarget(null)).toEqual({ kind: 'back' })
    expect(backTarget('')).toEqual({ kind: 'back' })
  })

  it('pushes a non-playlist origin exactly as recorded, with no route-shape special case', () => {
    // RH-133: the origin is part of the queue, so the band screen a practice
    // session started from is pushed verbatim — nothing infers a playlist.
    expect(backTarget('/bands/band-7')).toEqual({ kind: 'push', href: '/bands/band-7' })
    expect(backTarget('/songs/v-9/fast-view?bandId=band-7')).toEqual({
      kind: 'push',
      href: '/songs/v-9/fast-view?bandId=band-7',
    })
  })
})

/**
 * RH-132 ER3 — an entry the owner holds no repertoire row for is addressable.
 *
 * The Fast View route carries a `song_versions.id` now and the owner comes from
 * the page's `?bandId=`, so *every* entry of the setlist has an address whether
 * or not the owner holds a row. `nearestAddressable` is gone with the state it
 * existed for: prev/next are the plain neighbours, including when those
 * neighbours carry `repertoireId: null`. `position` and `total` still count
 * every entry, as they already did.
 */
describe('computePlaylistNav with entries the owner holds no row for (RH-132 ER3)', () => {
  /** The second and the fourth of four have no owner row. */
  const GAPPED: PlaylistEntry[] = [
    { repertoireId: 'rep-1', versionId: 'v-1', songId: 'song-1', title: 'Black Dog', artist: 'Led Zeppelin' },
    { repertoireId: null, versionId: 'v-2', songId: 'song-2', title: 'Rosanna', artist: 'Toto' },
    { repertoireId: 'rep-3', versionId: 'v-3', songId: 'song-3', title: 'Hold the Line', artist: 'Toto' },
    { repertoireId: null, versionId: 'v-4', songId: 'song-4', title: 'Africa', artist: 'Toto' },
  ]

  it('answers for a current entry carrying repertoireId: null, counting every entry', () => {
    const nav = computePlaylistNav(GAPPED, 'v-2', 'Gig')

    expect(nav).not.toBeNull()
    expect(nav).toMatchObject({ position: 2, total: GAPPED.length })
  })

  it('names the immediately adjacent entries, even when they hold no owner row', () => {
    // `v-2` is no longer stepped over: it has an address of its own.
    expect(computePlaylistNav(GAPPED, 'v-1', 'Gig')).toMatchObject({
      prevId: null,
      nextId: 'v-2',
    })
    expect(computePlaylistNav(GAPPED, 'v-3', 'Gig')).toMatchObject({
      prevId: 'v-2',
      nextId: 'v-4',
    })
    // The last entry holds no row either, and is still a position in the list.
    expect(computePlaylistNav(GAPPED, 'v-4', 'Gig')).toMatchObject({
      prevId: 'v-3',
      nextId: null,
      position: 4,
    })
  })

  it('never matches the empty string against an entry', () => {
    expect(computePlaylistNav(GAPPED, '', 'Gig')).toBeNull()
  })
})
