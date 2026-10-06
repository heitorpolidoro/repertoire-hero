import { describe, it, expect } from 'vitest'
import {
  playlistIdFromReturnTo,
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
  const nav = computePlaylistNav(ENTRIES, ENTRIES[index].repertoireId!, 'pl-1', 'Gig')
  if (!nav) throw new Error('fixture entry is not in the fixture playlist')
  return nav
}

describe('playlistIdFromReturnTo', () => {
  it('extracts the playlist id from a /playlists/:id returnTo', () => {
    expect(playlistIdFromReturnTo('/playlists/abc-123')).toBe('abc-123')
    expect(playlistIdFromReturnTo('/playlists/9f2c_7')).toBe('9f2c_7')
  })

  it('returns null for null, an empty string and a non-playlist returnTo', () => {
    expect(playlistIdFromReturnTo(null)).toBeNull()
    expect(playlistIdFromReturnTo('')).toBeNull()
    expect(playlistIdFromReturnTo('/songs')).toBeNull()
    expect(playlistIdFromReturnTo('/playlists')).toBeNull()
  })

  it('returns null for a nested path below /playlists/:id', () => {
    expect(playlistIdFromReturnTo('/playlists/abc-123/edit')).toBeNull()
    expect(playlistIdFromReturnTo('/playlists/abc 123')).toBeNull()
  })
})

describe('computePlaylistNav', () => {
  it('reports position, total, previous and next for a middle entry', () => {
    expect(computePlaylistNav(ENTRIES, 'rep-2', 'pl-1', 'Gig')).toEqual({
      prevId: 'rep-1',
      nextId: 'rep-3',
      position: 2,
      total: 3,
      playlistId: 'pl-1',
      playlistName: 'Gig',
    })
  })

  it('reports no previous for the first entry and no next for the last', () => {
    expect(computePlaylistNav(ENTRIES, 'rep-1', 'pl-1', 'Gig')).toMatchObject({
      prevId: null,
      nextId: 'rep-2',
      position: 1,
    })
    expect(computePlaylistNav(ENTRIES, 'rep-3', 'pl-1', 'Gig')).toMatchObject({
      prevId: 'rep-2',
      nextId: null,
      position: 3,
    })
  })

  it('returns null when the entry list is empty', () => {
    expect(computePlaylistNav([], 'rep-1', 'pl-1', 'Gig')).toBeNull()
  })

  it('returns null when the current repertoire id is not in the list', () => {
    expect(computePlaylistNav(ENTRIES, 'rep-99', 'pl-1', 'Gig')).toBeNull()
  })

  it('carries the playlist id and name through unchanged', () => {
    const nav = computePlaylistNav(ENTRIES, 'rep-1', 'pl-42', 'Saturday • set 2')
    expect(nav?.playlistId).toBe('pl-42')
    expect(nav?.playlistName).toBe('Saturday • set 2')
  })
})

describe('fastViewHref', () => {
  it('preserves returnTo and bandId in that order', () => {
    expect(fastViewHref('rep-2', '/playlists/pl-1', 'band-7')).toBe(
      '/songs/rep-2/fast-view?returnTo=%2Fplaylists%2Fpl-1&bandId=band-7',
    )
  })

  it('omits an absent returnTo and an absent bandId', () => {
    expect(fastViewHref('rep-2', null, null)).toBe('/songs/rep-2/fast-view?')
    expect(fastViewHref('rep-2', '', '')).toBe('/songs/rep-2/fast-view?')
    expect(fastViewHref('rep-2', null, 'band-7')).toBe('/songs/rep-2/fast-view?bandId=band-7')
    expect(fastViewHref('rep-2', '/playlists/pl-1', null)).toBe(
      '/songs/rep-2/fast-view?returnTo=%2Fplaylists%2Fpl-1',
    )
  })

  it('percent-encodes the returnTo value', () => {
    expect(fastViewHref('rep-2', '/playlists/a b&c', null)).toBe(
      '/songs/rep-2/fast-view?returnTo=%2Fplaylists%2Fa+b%26c',
    )
  })
})

describe('slideDirection', () => {
  it('slides left when the target is further down the setlist', () => {
    expect(slideDirection(ENTRIES, 'rep-1', 'rep-3')).toBe('left')
  })

  it('slides right when the target is further up the setlist', () => {
    expect(slideDirection(ENTRIES, 'rep-3', 'rep-1')).toBe('right')
    // Neither id in the list: both indexes are -1, so it is not "further down".
    expect(slideDirection(ENTRIES, 'rep-99', 'rep-98')).toBe('right')
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
    expect(swipeTarget(60, navAt(1))).toEqual({ repertoireId: 'rep-3', direction: 'left' })
    expect(swipeTarget(140, navAt(0))).toEqual({ repertoireId: 'rep-2', direction: 'left' })
  })

  it('returns to the previous entry on a rightward swipe', () => {
    expect(swipeTarget(-60, navAt(1))).toEqual({ repertoireId: 'rep-1', direction: 'right' })
    expect(swipeTarget(-140, navAt(2))).toEqual({ repertoireId: 'rep-2', direction: 'right' })
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
    expect(keyboardTarget(press(), navAt(1))).toEqual({ repertoireId: 'rep-3', direction: 'left' })
  })

  it('returns to the previous entry on ArrowLeft', () => {
    expect(keyboardTarget(press({ key: 'ArrowLeft' }), navAt(1))).toEqual({
      repertoireId: 'rep-1',
      direction: 'right',
    })
  })

  it('treats ArrowDown as next and ArrowUp as previous, for page-turner pedals', () => {
    expect(keyboardTarget(press({ key: 'ArrowDown' }), navAt(1))).toEqual({ repertoireId: 'rep-3', direction: 'left' })
    expect(keyboardTarget(press({ key: 'ArrowUp' }), navAt(1))).toEqual({ repertoireId: 'rep-1', direction: 'right' })
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
  it('pushes the returnTo path when there is one, and falls back to history when there is not', () => {
    expect(backTarget('/playlists/pl-1')).toEqual({ kind: 'push', href: '/playlists/pl-1' })
    expect(backTarget(null)).toEqual({ kind: 'back' })
    expect(backTarget('')).toEqual({ kind: 'back' })
  })
})

/**
 * RH-125 ER12 — an entry the owner holds no repertoire row for.
 *
 * The setlist read `LEFT JOIN`s the owner table now, so every entry of the
 * playlist is in the list whether or not the owner holds it, and an entry that
 * carries no `repertoireId` has no Fast View address yet (RH-109 is what gives
 * it one). Three things follow, and all three are asserted: the nav for the
 * current song is still non-null — losing one entry used to collapse the whole
 * setlist — `position` and `total` count **every** entry, and prev/next step
 * over the unaddressable one rather than stopping at it.
 */
describe('computePlaylistNav with an unaddressable entry (RH-125 ER12)', () => {
  /** Second of four has no owner row; the current song is the first. */
  const GAPPED: PlaylistEntry[] = [
    { repertoireId: 'rep-1', versionId: 'v-1', songId: 'song-1', title: 'Black Dog', artist: 'Led Zeppelin' },
    { repertoireId: null, versionId: 'v-2', songId: 'song-2', title: 'Rosanna', artist: 'Toto' },
    { repertoireId: 'rep-3', versionId: 'v-3', songId: 'song-3', title: 'Hold the Line', artist: 'Toto' },
    { repertoireId: null, versionId: 'v-4', songId: 'song-4', title: 'Africa', artist: 'Toto' },
  ]

  it('still answers for the current entry, and counts every entry', () => {
    const nav = computePlaylistNav(GAPPED, 'rep-1', 'pl-1', 'Gig')

    expect(nav).not.toBeNull()
    expect(nav).toMatchObject({ position: 1, total: 4 })
  })

  it('names the nearest neighbour with a non-null repertoireId as next', () => {
    // `v-2` sits between them and is skipped: a gap must not block the rest of
    // the setlist.
    expect(computePlaylistNav(GAPPED, 'rep-1', 'pl-1', 'Gig')?.nextId).toBe('rep-3')
  })

  it('names the nearest addressable neighbour as previous, and null past the end', () => {
    const atThird = computePlaylistNav(GAPPED, 'rep-3', 'pl-1', 'Gig')

    expect(atThird).toMatchObject({ prevId: 'rep-1', position: 3, total: 4 })
    // Only `v-4` is left after it, and it has no address — so there is no next.
    expect(atThird?.nextId).toBeNull()
  })

  it('never matches an unaddressable entry as the current one', () => {
    // The route param is an owner row id, so this cannot happen in the app;
    // asserted so a future `?? ''` cannot make a null match the empty string.
    expect(computePlaylistNav(GAPPED, '', 'pl-1', 'Gig')).toBeNull()
  })
})
