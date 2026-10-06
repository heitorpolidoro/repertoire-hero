/**
 * RH-68 — the pure decisions of the `/playlists/[id]` song list.
 *
 * Every function here used to be an inline `useMemo` body, an inline sort or an
 * inline `new Map(prev)` clone inside `PlaylistDetailPage`. They are decisions
 * about data, so they are exercised directly against hand-built fixtures — no
 * React, no DOM, no database. The file needs no `@vitest-environment` line:
 * `src/lib/playlistDetail.ts` touches no DOM API.
 */

import { describe, it, expect } from 'vitest'
import {
  collectPlaylistTags,
  filterPlaylistSongs,
  movePlaylistSong,
  setSongStatus,
  sortPlaylistSongs,
  summarisePlaylistMastery,
  withRepertoireEntry,
} from '@/lib/playlistDetail'
import type { PlaylistSong, Repertoire, SongStatus } from '@/types/database'

/**
 * One playlist entry, keyed by the **version** it names (RH-125). `song.id` is
 * derived from the version id rather than equal to it, so a map keyed by the
 * song id cannot accidentally satisfy a lookup that should be by version — the
 * mix-up the re-key exists to prevent.
 */
function playlistSong(
  versionId: string,
  overrides: {
    position?: number
    title?: string
    artist?: string
    duration?: number | null
  } = {},
): PlaylistSong {
  return {
    id: `ps-${versionId}`,
    playlist_id: 'playlist-1',
    version_id: versionId,
    position: overrides.position ?? 0,
    song: {
      id: `song-of-${versionId}`,
      title: overrides.title ?? 'Kashmir',
      artist: overrides.artist ?? 'Led Zeppelin',
      album: 'Physical Graffiti',
      standard_key: null,
      cover_url: null,
      duration_seconds: overrides.duration === undefined ? null : overrides.duration,
      links: [],
      created_at: '2026-01-01T00:00:00.000Z',
    },
  }
}

function entry(versionId: string, status: SongStatus, tags: string[] = []): Repertoire {
  return {
    id: `rep-${versionId}`,
    user_id: 'user-1',
    band_id: null,
    song_id: `song-of-${versionId}`,
    version_id: versionId,
    key: null,
    tuning: null,
    map: null,
    status,
    tags,
    last_practiced: null,
    lyrics: null,
  }
}

/** Keyed by `version_id`, which is what the three map readers look up (ER11). */
function repertoireOf(...entries: Repertoire[]): Map<string, Repertoire> {
  return new Map(entries.map((rep) => [rep.version_id, rep]))
}

/** The same entries keyed by their **song** id — the wrong key, on purpose. */
function repertoireBySongId(...entries: Repertoire[]): Map<string, Repertoire> {
  return new Map(entries.map((rep) => [rep.song_id, rep]))
}

describe('collectPlaylistTags', () => {
  it('collects every tag of the playlist songs without repeating one', () => {
    const songs = [playlistSong('version-1'), playlistSong('version-2')]
    const repertoire = repertoireOf(
      entry('version-1', 'learning', ['encore', 'rock']),
      entry('version-2', 'mastered', ['rock', 'slow']),
    )

    expect(collectPlaylistTags(songs, repertoire)).toEqual(['encore', 'rock', 'slow'])
  })

  it('sorts the collected tags with localeCompare', () => {
    const songs = [playlistSong('version-1')]
    const repertoire = repertoireOf(entry('version-1', 'unknown', ['Zebra', 'apple', 'Banana']))

    // A plain `.sort()` would order these by code unit — `Banana`, `Zebra`, `apple`.
    expect(collectPlaylistTags(songs, repertoire)).toEqual(['apple', 'Banana', 'Zebra'])
  })

  it('collects nothing when no song has a repertoire entry', () => {
    const songs = [playlistSong('version-1'), playlistSong('version-2')]

    expect(collectPlaylistTags(songs, new Map())).toEqual([])
  })
})

describe('filterPlaylistSongs', () => {
  const songs = [
    playlistSong('version-1', { title: 'Kashmir', artist: 'Led Zeppelin' }),
    playlistSong('version-2', { title: 'Black Dog', artist: 'Led Zeppelin' }),
    playlistSong('version-3', { title: 'Roxanne', artist: 'The Police' }),
  ]
  const repertoire = repertoireOf(
    entry('version-1', 'learning', ['encore']),
    entry('version-2', 'mastered', ['encore', 'fast']),
    entry('version-3', 'unknown', ['fast']),
  )

  it('returns every song when neither a tag nor a query is set', () => {
    const result = filterPlaylistSongs(songs, repertoire, { tag: null, query: '' })

    expect(result.map((ps) => ps.version_id)).toEqual(['version-1', 'version-2', 'version-3'])
  })

  it('keeps only the songs carrying the active tag', () => {
    const result = filterPlaylistSongs(songs, repertoire, { tag: 'encore', query: '' })

    expect(result.map((ps) => ps.version_id)).toEqual(['version-1', 'version-2'])
  })

  it('matches the query against the song title, ignoring case', () => {
    const result = filterPlaylistSongs(songs, repertoire, { tag: null, query: 'ROXA' })

    expect(result.map((ps) => ps.version_id)).toEqual(['version-3'])
  })

  it('matches the query against the song artist, ignoring case', () => {
    const result = filterPlaylistSongs(songs, repertoire, { tag: null, query: 'led zep' })

    expect(result.map((ps) => ps.version_id)).toEqual(['version-1', 'version-2'])
  })

  it('treats a whitespace-only query as no query at all', () => {
    const result = filterPlaylistSongs(songs, repertoire, { tag: null, query: '   ' })

    expect(result.map((ps) => ps.version_id)).toEqual(['version-1', 'version-2', 'version-3'])
  })

  it('applies the tag filter and the text query together', () => {
    const result = filterPlaylistSongs(songs, repertoire, { tag: 'fast', query: 'police' })

    expect(result.map((ps) => ps.version_id)).toEqual(['version-3'])
  })
})

describe('sortPlaylistSongs', () => {
  it('orders the songs by position without mutating the input array', () => {
    const songs = [
      playlistSong('version-1', { position: 2 }),
      playlistSong('version-2', { position: 0 }),
      playlistSong('version-3', { position: 1 }),
    ]

    const sorted = sortPlaylistSongs(songs)

    expect(sorted.map((ps) => ps.version_id)).toEqual(['version-2', 'version-3', 'version-1'])
    expect(songs.map((ps) => ps.version_id)).toEqual(['version-1', 'version-2', 'version-3'])
    expect(sorted).not.toBe(songs)
  })
})

describe('summarisePlaylistMastery', () => {
  it('counts one song per status and reads a song with no repertoire entry as unknown', () => {
    const songs = [playlistSong('version-1'), playlistSong('version-2'), playlistSong('version-3')]
    const repertoire = repertoireOf(entry('version-1', 'polishing'), entry('version-2', 'polishing'))

    const summary = summarisePlaylistMastery(songs, repertoire)

    expect(summary.counts).toEqual({
      unknown: 1,
      learning: 0,
      practicing: 0,
      polishing: 2,
      mastered: 0,
    })
    expect(summary.total).toBe(3)
  })

  it('sums the duration of the songs that carry one and ignores the ones that do not', () => {
    const songs = [
      playlistSong('version-1', { duration: 200 }),
      playlistSong('version-2', { duration: null }),
      playlistSong('version-3', { duration: 415 }),
    ]

    expect(summarisePlaylistMastery(songs, new Map()).totalSeconds).toBe(615)
  })

  it('scores an all-mastered playlist at 100 and an all-unknown playlist at 0', () => {
    const songs = [playlistSong('version-1'), playlistSong('version-2')]

    const mastered = summarisePlaylistMastery(
      songs,
      repertoireOf(entry('version-1', 'mastered'), entry('version-2', 'mastered')),
    )
    expect(mastered.score).toBe(100)
    expect(mastered.scoreStatus).toBe('mastered')

    const unknown = summarisePlaylistMastery(songs, new Map())
    expect(unknown.score).toBe(0)
    expect(unknown.scoreStatus).toBe('unknown')
  })

  it('reports a total of zero for an empty playlist without dividing by zero', () => {
    const summary = summarisePlaylistMastery([], new Map())

    expect(summary.total).toBe(0)
    expect(summary.totalSeconds).toBe(0)
    expect(Number.isFinite(summary.score)).toBe(true)
    expect(summary.score).toBe(0)
    expect(summary.scoreStatus).toBe('unknown')
  })
})

describe('setSongStatus', () => {
  // RH-102: the note control names the status it wants, in either direction, so
  // this helper no longer decides one — it only pairs the asked-for status with
  // the entry as it stands, which is what `usePlaylistDetail` rolls back to.
  it('pairs the asked-for status with the original entry, upwards', () => {
    const original = entry('version-1', 'learning', ['encore'])
    const change = setSongStatus(repertoireOf(original), 'version-1', 'mastered')

    expect(change).not.toBeNull()
    expect(change?.status).toBe('mastered')
    expect(change?.entry).toBe(original)
    expect(change?.entry.status).toBe('learning')
    expect(change?.updated).toEqual({ ...original, status: 'mastered' })
  })

  it('takes a status downwards just as readily, and all the way to unknown', () => {
    const original = entry('version-1', 'polishing')
    const repertoire = repertoireOf(original)

    expect(setSongStatus(repertoire, 'version-1', 'practicing')?.status).toBe('practicing')
    expect(setSongStatus(repertoire, 'version-1', 'unknown')?.updated).toEqual({
      ...original,
      status: 'unknown',
    })
  })

  it('returns null when the song has no repertoire entry', () => {
    expect(setSongStatus(new Map(), 'version-1', 'learning')).toBeNull()
  })
})

describe('withRepertoireEntry', () => {
  it('replaces one repertoire entry and leaves the other entries and the source map untouched', () => {
    const first = entry('version-1', 'learning')
    const second = entry('version-2', 'mastered')
    const source = repertoireOf(first, second)
    const replacement = { ...first, status: 'polishing' as SongStatus }

    const next = withRepertoireEntry(source, 'version-1', replacement)

    expect(next).not.toBe(source)
    expect(next.get('version-1')).toBe(replacement)
    expect(next.get('version-2')).toBe(second)
    expect(source.get('version-1')).toBe(first)
    expect(source.size).toBe(2)
  })
})

describe('movePlaylistSong (RH-103)', () => {
  /**
   * Deliberately handed to the function out of order and with a gap, so a pass
   * can only come from `sortPlaylistSongs` — "the row above" is the row above by
   * `position`, never by array order.
   */
  const threeSongs = [
    playlistSong('song-b', { position: 5 }),
    playlistSong('song-c', { position: 9 }),
    playlistSong('song-a', { position: 1 }),
  ]

  it('moves a middle row up, reporting the whole new row-id order', () => {
    expect(movePlaylistSong(threeSongs, 'song-b', 'up')).toEqual({
      moved: true,
      orderedIds: ['ps-song-b', 'ps-song-a', 'ps-song-c'],
    })
  })

  it('moves the same middle row down', () => {
    expect(movePlaylistSong(threeSongs, 'song-b', 'down')).toEqual({
      moved: true,
      orderedIds: ['ps-song-a', 'ps-song-c', 'ps-song-b'],
    })
  })

  it('reports nothing to do for the first row moving up', () => {
    expect(movePlaylistSong(threeSongs, 'song-a', 'up')).toEqual({ moved: false })
  })

  it('reports nothing to do for the last row moving down', () => {
    expect(movePlaylistSong(threeSongs, 'song-c', 'down')).toEqual({ moved: false })
  })

  it('reports nothing to do for a song that is not in the playlist', () => {
    expect(movePlaylistSong(threeSongs, 'song-z', 'up')).toEqual({ moved: false })
  })

  it('leaves the source array untouched', () => {
    const before = threeSongs.map((ps) => ps.id)
    movePlaylistSong(threeSongs, 'song-b', 'down')
    expect(threeSongs.map((ps) => ps.id)).toEqual(before)
  })
})

/**
 * RH-125 ER11 — the three map readers are keyed by `version_id`.
 *
 * Each case is asserted twice: once against a map keyed the right way, where the
 * entry is found, and once against the *same* entry keyed by its song id, where
 * nothing is found. The second half is what makes the first mean something — a
 * map keyed by either id would pass the positive assertion on its own, and the
 * bug the re-key prevents is exactly two lists keyed by different ids under the
 * same name.
 */
describe('keyed by version id, not song id (RH-125 ER11)', () => {
  const songs = [playlistSong('version-1'), playlistSong('version-2')]
  const held = [
    entry('version-1', 'mastered', ['encore']),
    entry('version-2', 'polishing', ['slow']),
  ]

  it('summarisePlaylistMastery finds the entries through ps.version_id', () => {
    expect(summarisePlaylistMastery(songs, repertoireOf(...held)).counts).toEqual({
      unknown: 0,
      learning: 0,
      practicing: 0,
      polishing: 1,
      mastered: 1,
    })
  })

  it('summarisePlaylistMastery reads every entry as unknown from a song-keyed map', () => {
    expect(summarisePlaylistMastery(songs, repertoireBySongId(...held)).counts).toEqual({
      unknown: 2,
      learning: 0,
      practicing: 0,
      polishing: 0,
      mastered: 0,
    })
  })

  it('collectPlaylistTags finds the tags through ps.version_id, and none from a song-keyed map', () => {
    expect(collectPlaylistTags(songs, repertoireOf(...held))).toEqual(['encore', 'slow'])
    expect(collectPlaylistTags(songs, repertoireBySongId(...held))).toEqual([])
  })

  it('setSongStatus finds the entry by version id, and nothing by song id', () => {
    expect(setSongStatus(repertoireOf(...held), 'version-1', 'learning')?.status).toBe('learning')
    // The same entry, keyed by its song id: the lookup misses and no write is
    // attempted, which is what `usePlaylistDetail` short-circuits on.
    expect(setSongStatus(repertoireBySongId(...held), 'version-1', 'learning')).toBeNull()
  })

  it('filterPlaylistSongs filters on the version-keyed tags', () => {
    const filter = { tag: 'encore', query: '' }
    expect(
      filterPlaylistSongs(songs, repertoireOf(...held), filter).map((ps) => ps.version_id),
    ).toEqual(['version-1'])
    expect(filterPlaylistSongs(songs, repertoireBySongId(...held), filter)).toEqual([])
  })

  it('movePlaylistSong locates the row by version id', () => {
    const ordered = [
      playlistSong('version-1', { position: 1 }),
      playlistSong('version-2', { position: 2 }),
    ]
    expect(movePlaylistSong(ordered, 'version-2', 'up')).toEqual({
      moved: true,
      orderedIds: ['ps-version-2', 'ps-version-1'],
    })
    // A song id names no row: nothing to do rather than a wrong move.
    expect(movePlaylistSong(ordered, 'song-of-version-2', 'up')).toEqual({ moved: false })
  })
})
