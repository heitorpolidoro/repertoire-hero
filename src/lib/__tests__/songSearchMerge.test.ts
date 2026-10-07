/**
 * RH-108 — the merge that collapses the add-song picker's duplicate rows.
 *
 * The defect this covers is narrow and was easy to see: a search for `bad`
 * returned the catalog's `"Bad"` and Spotify's `"Bad - Remaster 2012"` as two
 * adjacent, near-identical rows with nothing saying which to press, because the
 * dedup key it replaced lowercased the **raw** title. One row per song is the
 * deliverable; carrying every version both sources offered on that row is what
 * RH-112 expands.
 *
 * Hand-built inputs and no mocks: the module imports `@/lib/songTitle` and
 * types, nothing else, so there is no DOM, no timer and no `pg` to stand in
 * for. What a hook test proves instead — that the two searches actually reach
 * this function — is in `src/hooks/__tests__/useSongPicker.test.tsx`.
 */

import { describe, it, expect } from 'vitest'
import {
  mergeSongSearchResults,
  withoutHeldVersions,
  type SearchVersionCandidate,
  type SongSearchRow,
} from '@/lib/songSearchMerge'
import type { SpotifyTrack } from '@/lib/spotify'
import type { CatalogSearchResult, CatalogVersionOption } from '@/types/database'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function version(
  overrides: Partial<CatalogVersionOption> & Pick<CatalogVersionOption, 'versionId'>,
): CatalogVersionOption {
  return {
    label: null,
    durationSeconds: null,
    createdAt: null,
    albumName: null,
    albumType: null,
    albumCoverUrl: null,
    releaseDate: null,
    ...overrides,
  }
}

function catalogSong(
  overrides: Partial<CatalogSearchResult> & Pick<CatalogSearchResult, 'id' | 'title' | 'artist'>,
): CatalogSearchResult {
  return {
    album: null,
    standard_key: null,
    cover_url: null,
    duration_seconds: null,
    links: [],
    created_at: '2026-01-01T00:00:00.000Z',
    version_id: null,
    versions: [],
    ...overrides,
  }
}

function spotifyTrack(
  overrides: Partial<SpotifyTrack> & Pick<SpotifyTrack, 'id' | 'title' | 'artist'>,
): SpotifyTrack {
  return {
    album: null,
    spotifyUrl: `https://open.spotify.com/track/${overrides.id}`,
    previewUrl: null,
    albumArt: null,
    albumType: null,
    releaseDate: null,
    ...overrides,
  }
}

function candidate(
  overrides: Partial<SearchVersionCandidate> = {},
): SearchVersionCandidate {
  return {
    versionId: null,
    spotifyTrackId: null,
    rawTitle: 'Bad',
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

function row(overrides: Partial<SongSearchRow> = {}): SongSearchRow {
  return {
    id: 'bad|michael jackson',
    title: 'Bad',
    artist: 'Michael Jackson',
    coverUrl: null,
    album: null,
    songId: 'song-1',
    versions: [],
    ...overrides,
  }
}

/** The ER2 catalog hit: one song, one unlabelled version on album `Bad`. */
function badCatalogHit(): CatalogSearchResult {
  return catalogSong({
    id: 'song-1',
    title: 'Bad',
    artist: 'Michael Jackson',
    version_id: 'v-1',
    versions: [version({ versionId: 'v-1', albumName: 'Bad', label: null })],
  })
}

/** The ER3/ER6 Spotify hit: the 2012 remaster of `Bad`, on album `Bad`. */
function remaster2012(): Pick<SpotifyTrack, 'id' | 'title' | 'artist' | 'album'> {
  return { id: 'sp-aaa', title: 'Bad - Remaster 2012', artist: 'Michael Jackson', album: 'Bad' }
}

// ---------------------------------------------------------------------------
// ER2, ER3, ER6, ER7, ER8 — the collapse itself
// ---------------------------------------------------------------------------

describe('mergeSongSearchResults — the collapse (ER2, ER3)', () => {
  it('returns one row with one candidate carrying both provider ids (ER2)', () => {
    const rows = mergeSongSearchResults(
      [badCatalogHit()],
      [spotifyTrack({ id: 'sp-aaa', title: 'Bad', artist: 'Michael Jackson', album: 'Bad' })],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('Bad')
    expect(rows[0].artist).toBe('Michael Jackson')
    expect(rows[0].songId).toBe('song-1')
    expect(rows[0].versions).toHaveLength(1)
    // Both sources described one recording, so one candidate carries both ids.
    expect(rows[0].versions[0].versionId).toBe('v-1')
    expect(rows[0].versions[0].spotifyTrackId).toBe('sp-aaa')
  })

  it("keeps the catalog's spelling as the row title, not Spotify's (ER3)", () => {
    const rows = mergeSongSearchResults(
      [badCatalogHit()],
      [spotifyTrack(remaster2012())],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('Bad')
  })

  it("derives a Spotify candidate's label from the right half of the same split", () => {
    const rows = mergeSongSearchResults(
      [],
      [spotifyTrack(remaster2012())],
    )

    expect(rows[0].id).toBe('bad|michael jackson')
    expect(rows[0].versions[0].label).toBe('Remaster 2012')
    // The unsplit title survives on the candidate: it is what the add path
    // feeds `createAndAddSong`, and what becomes `song_versions.label`.
    expect(rows[0].versions[0].rawTitle).toBe('Bad - Remaster 2012')
  })

  it('collapses a suffixed Spotify title onto the catalog version it labels', () => {
    const rows = mergeSongSearchResults(
      [
        catalogSong({
          id: 'song-1',
          title: 'Bad',
          artist: 'Michael Jackson',
          versions: [version({ versionId: 'v-2', albumName: 'Bad', label: 'Remaster 2012' })],
        }),
      ],
      [spotifyTrack(remaster2012())],
    )

    expect(rows[0].versions).toHaveLength(1)
    expect(rows[0].versions[0]).toMatchObject({ versionId: 'v-2', spotifyTrackId: 'sp-aaa' })
  })

  it('does not re-reduce the artist half, so a credit-list mismatch stays two rows', () => {
    const rows = mergeSongSearchResults(
      [catalogSong({ id: 'song-1', title: 'September', artist: 'Earth, Wind & Fire' })],
      [spotifyTrack({ id: 'sp-aaa', title: 'September', artist: 'Earth' })],
    )

    // The missed merge is the chosen error: the duplicate row survives rather
    // than two different artists being collapsed irreversibly.
    expect(rows).toHaveLength(2)
  })
})

describe('mergeSongSearchResults — a row names a song (ER6, ER7, ER8)', () => {
  it('lists every recording both sources offered, with four distinct keys (ER6)', () => {
    const rows = mergeSongSearchResults(
      [
        catalogSong({
          id: 'song-1',
          title: 'Bad',
          artist: 'Michael Jackson',
          versions: [
            version({ versionId: 'v-1', albumName: 'Bad', label: null }),
            version({ versionId: 'v-2', albumName: 'Live At Wembley', label: 'Live' }),
          ],
        }),
      ],
      [
        spotifyTrack({
          id: 'sp-aaa',
          title: 'Bad - Remaster 2012',
          artist: 'Michael Jackson',
          album: 'Bad',
        }),
        spotifyTrack({
          id: 'sp-bbb',
          title: 'Bad - Remaster 2025',
          artist: 'Michael Jackson',
          album: 'Bad',
        }),
      ],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].versions).toHaveLength(4)
  })

  it('keeps both candidates when the album names differ, losing nothing (ER7)', () => {
    const rows = mergeSongSearchResults(
      [
        catalogSong({
          id: 'song-1',
          title: 'Bad',
          artist: 'Michael Jackson',
          versions: [version({ versionId: 'v-2', albumName: 'Bad', label: 'Remaster 2012' })],
        }),
      ],
      [
        spotifyTrack({
          id: 'sp-aaa',
          title: 'Bad - Remaster 2012',
          artist: 'Michael Jackson',
          album: 'Bad (Remastered)',
        }),
      ],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].versions).toHaveLength(2)
    const catalogCandidate = rows[0].versions.find((c) => c.versionId === 'v-2')
    const spotifyCandidate = rows[0].versions.find((c) => c.spotifyTrackId === 'sp-aaa')
    expect(catalogCandidate).toBeDefined()
    expect(spotifyCandidate).toBeDefined()
    // Neither carries the other's id: the merge was missed, not faked.
    expect(catalogCandidate?.spotifyTrackId).toBeNull()
    expect(spotifyCandidate?.versionId).toBeNull()
  })

  it('reports a Spotify-only group with a null songId and no version ids (ER8)', () => {
    const rows = mergeSongSearchResults(
      [],
      [
        spotifyTrack({ id: 'sp-aaa', title: 'Bad', artist: 'Michael Jackson', album: 'Bad' }),
        spotifyTrack({
          id: 'sp-bbb',
          title: 'Bad - Live',
          artist: 'Michael Jackson',
          album: 'Bad',
        }),
      ],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].songId).toBeNull()
    expect(rows[0].versions).toHaveLength(2)
    for (const c of rows[0].versions) {
      expect(c.versionId).toBeNull()
      expect(c.spotifyTrackId).toBeTruthy()
    }
  })

  it('keeps two same-provider candidates that share a recording key', () => {
    // Two Spotify tracks both titled `Bad` on album `Bad` key as `("bad", "")`
    // and are both kept: folding them would make the output depend on the
    // order the array happened to arrive in.
    const rows = mergeSongSearchResults(
      [],
      [
        spotifyTrack({ id: 'sp-aaa', title: 'Bad', artist: 'Michael Jackson', album: 'Bad' }),
        spotifyTrack({ id: 'sp-bbb', title: 'Bad', artist: 'Michael Jackson', album: 'Bad' }),
      ],
    )

    expect(rows[0].versions.map((c) => c.spotifyTrackId)).toEqual(['sp-aaa', 'sp-bbb'])
  })

  it('normalises a null and an empty album name to the same recording key', () => {
    const rows = mergeSongSearchResults(
      [
        catalogSong({
          id: 'song-1',
          title: 'Bad',
          artist: 'Michael Jackson',
          versions: [version({ versionId: 'v-1', albumName: null, label: null })],
        }),
      ],
      [spotifyTrack({ id: 'sp-aaa', title: 'Bad', artist: 'Michael Jackson', album: '' })],
    )

    expect(rows[0].versions).toHaveLength(1)
    expect(rows[0].versions[0]).toMatchObject({ versionId: 'v-1', spotifyTrackId: 'sp-aaa' })
  })
})

// ---------------------------------------------------------------------------
// ER12 — the catalog song with no versions
// ---------------------------------------------------------------------------

describe('mergeSongSearchResults — a catalog song with no versions (ER12)', () => {
  it('still produces its row, with an empty versions array', () => {
    const rows = mergeSongSearchResults(
      [
        catalogSong({
          id: 'song-3',
          title: 'Kashmir',
          artist: 'Led Zeppelin',
          album: 'Physical Graffiti',
          cover_url: 'https://img/pg.jpg',
          version_id: null,
          versions: [],
        }),
      ],
      [],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].songId).toBe('song-3')
    expect(rows[0].versions).toHaveLength(0)
    expect(rows[0].title).toBe('Kashmir')
    expect(rows[0].album).toBe('Physical Graffiti')
    expect(rows[0].coverUrl).toBe('https://img/pg.jpg')
  })
})

// ---------------------------------------------------------------------------
// ER14, ER15 — row identity and the thumbnail
// ---------------------------------------------------------------------------

describe('mergeSongSearchResults — row identity (ER14)', () => {
  it('gives every row a non-empty id equal to its group key, unique per call', () => {
    const rows = mergeSongSearchResults(
      [
        catalogSong({ id: 'song-1', title: 'Bad', artist: 'Michael Jackson' }),
        catalogSong({ id: 'song-2', title: 'Kashmir', artist: 'Led Zeppelin' }),
      ],
      [spotifyTrack({ id: 'sp-aaa', title: 'Thriller', artist: 'Michael Jackson' })],
    )

    const ids = rows.map((r) => r.id)
    expect(ids).toEqual(['bad|michael jackson', 'kashmir|led zeppelin', 'thriller|michael jackson'])
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.length).toBeGreaterThan(0)
  })

  it('gives a catalog hit and a Spotify hit for one song a single id', () => {
    const rows = mergeSongSearchResults(
      [badCatalogHit()],
      [spotifyTrack(remaster2012())],
    )

    // One id means one `rowErrors` slot and one `addingId` — at HEAD the two
    // rows had two independent ones.
    expect(rows.map((r) => r.id)).toEqual(['bad|michael jackson'])
  })
})

describe('mergeSongSearchResults — the thumbnail (ER15)', () => {
  it("takes the first non-null candidate cover in sorted order (case 1)", () => {
    const rows = mergeSongSearchResults(
      [
        catalogSong({
          id: 'song-1',
          title: 'Bad',
          artist: 'Michael Jackson',
          cover_url: null,
          versions: [version({ versionId: 'v-1', albumName: 'Bad', albumCoverUrl: null })],
        }),
      ],
      [
        spotifyTrack({
          id: 'sp-aaa',
          title: 'Bad - Live',
          artist: 'Michael Jackson',
          album: 'Live',
          albumArt: 'https://img/a.jpg',
        }),
      ],
    )

    expect(rows[0].coverUrl).toBe('https://img/a.jpg')
  })

  it("falls back to the catalog row's songs.cover_url for an album-less version (case 2)", () => {
    const rows = mergeSongSearchResults(
      [
        catalogSong({
          id: 'song-1',
          title: 'Bad',
          artist: 'Michael Jackson',
          cover_url: 'https://img/c.jpg',
          versions: [version({ versionId: 'v-1', albumName: null, albumCoverUrl: null })],
        }),
      ],
      [],
    )

    // Without the fallback this row silently loses the thumbnail
    // `SongPicker.tsx` renders for it at HEAD.
    expect(rows[0].coverUrl).toBe('https://img/c.jpg')
  })

  it('answers a null cover when neither the candidates nor the song carry one', () => {
    const rows = mergeSongSearchResults(
      [catalogSong({ id: 'song-1', title: 'Bad', artist: 'Michael Jackson' })],
      [],
    )

    expect(rows[0].coverUrl).toBeNull()
  })

  it("prefers the catalog cover on a collapsed candidate and takes Spotify's when it is null", () => {
    const withCatalogCover = mergeSongSearchResults(
      [
        catalogSong({
          id: 'song-1',
          title: 'Bad',
          artist: 'Michael Jackson',
          versions: [
            version({ versionId: 'v-1', albumName: 'Bad', albumCoverUrl: 'https://img/c.jpg' }),
          ],
        }),
      ],
      [
        spotifyTrack({
          id: 'sp-aaa',
          title: 'Bad',
          artist: 'Michael Jackson',
          album: 'Bad',
          albumArt: 'https://img/s.jpg',
        }),
      ],
    )
    expect(withCatalogCover[0].versions[0].coverUrl).toBe('https://img/c.jpg')

    const withoutCatalogCover = mergeSongSearchResults(
      [
        catalogSong({
          id: 'song-1',
          title: 'Bad',
          artist: 'Michael Jackson',
          versions: [version({ versionId: 'v-1', albumName: 'Bad', albumCoverUrl: null })],
        }),
      ],
      [
        spotifyTrack({
          id: 'sp-aaa',
          title: 'Bad',
          artist: 'Michael Jackson',
          album: 'Bad',
          albumArt: 'https://img/s.jpg',
        }),
      ],
    )
    expect(withoutCatalogCover[0].versions[0].coverUrl).toBe('https://img/s.jpg')
    // Nothing of either side is lost: the Spotify URL rides along.
    expect(withoutCatalogCover[0].versions[0].spotifyUrl).toBe(
      'https://open.spotify.com/track/sp-aaa',
    )
  })

  it("takes the album line from versions[0], falling back to the songs.album text", () => {
    const fromVersion = mergeSongSearchResults(
      [
        catalogSong({
          id: 'song-1',
          title: 'Bad',
          artist: 'Michael Jackson',
          album: 'Legacy Text',
          versions: [version({ versionId: 'v-1', albumName: 'Bad' })],
        }),
      ],
      [],
    )
    expect(fromVersion[0].album).toBe('Bad')

    const fromSong = mergeSongSearchResults(
      [
        catalogSong({
          id: 'song-1',
          title: 'Bad',
          artist: 'Michael Jackson',
          album: 'Legacy Text',
          versions: [version({ versionId: 'v-1', albumName: null })],
        }),
      ],
      [],
    )
    expect(fromSong[0].album).toBe('Legacy Text')
  })
})

// ---------------------------------------------------------------------------
// ER16, ER17 — ordering
// ---------------------------------------------------------------------------

describe('mergeSongSearchResults — candidate order (ER16)', () => {
  it("places a Spotify album candidate ahead of a catalog single", () => {
    const rows = mergeSongSearchResults(
      [
        catalogSong({
          id: 'song-1',
          title: 'Bad',
          artist: 'Michael Jackson',
          versions: [
            version({
              versionId: 'v-1',
              albumName: 'Bad (Single)',
              albumType: 'single',
              releaseDate: '1987-09-07',
            }),
          ],
        }),
      ],
      [
        spotifyTrack({
          id: 'sp-aaa',
          title: 'Bad',
          artist: 'Michael Jackson',
          album: 'Bad',
          albumType: 'album',
          releaseDate: '2001-03-06',
        }),
      ],
    )

    expect(rows[0].versions.map((c) => c.versionId ?? c.spotifyTrackId)).toEqual(['sp-aaa', 'v-1'])
  })

  it('orders by release date, then created_at, then source, then id — nulls last', () => {
    const rows = mergeSongSearchResults(
      [
        catalogSong({
          id: 'song-1',
          title: 'Bad',
          artist: 'Michael Jackson',
          versions: [
            version({ versionId: 'v-late', albumName: 'C', albumType: 'album', releaseDate: '1990-01-01' }),
            version({ versionId: 'v-null', albumName: 'D', albumType: 'album', releaseDate: null }),
            version({ versionId: 'v-early', albumName: 'B', albumType: 'album', releaseDate: '1987-08-31' }),
            version({ versionId: 'v-single', albumName: 'E', albumType: 'single', releaseDate: '1980-01-01' }),
          ],
        }),
      ],
      [],
    )

    expect(rows[0].versions.map((c) => c.versionId)).toEqual([
      'v-early',
      'v-late',
      'v-null',
      'v-single',
    ])
  })

  it('puts a catalog candidate ahead of a Spotify candidate it ties with', () => {
    const rows = mergeSongSearchResults(
      [
        catalogSong({
          id: 'song-1',
          title: 'Bad',
          artist: 'Michael Jackson',
          versions: [version({ versionId: 'v-1', albumName: 'A', albumType: 'album', releaseDate: '1987-08-31' })],
        }),
      ],
      [
        spotifyTrack({
          id: 'sp-aaa',
          title: 'Bad',
          artist: 'Michael Jackson',
          album: 'Z',
          albumType: 'album',
          releaseDate: '1987-08-31',
        }),
      ],
    )

    // A Spotify candidate's `createdAt` is always null, which sorts last, and
    // the derived source separates them even when it does not.
    expect(rows[0].versions.map((c) => c.versionId ?? c.spotifyTrackId)).toEqual(['v-1', 'sp-aaa'])
  })

  it('breaks a full tie by id, which makes the order total', () => {
    const rows = mergeSongSearchResults(
      [],
      [
        spotifyTrack({ id: 'sp-zzz', title: 'Bad', artist: 'Michael Jackson', album: 'Z' }),
        spotifyTrack({ id: 'sp-aaa', title: 'Bad', artist: 'Michael Jackson', album: 'A' }),
      ],
    )

    expect(rows[0].versions.map((c) => c.spotifyTrackId)).toEqual(['sp-aaa', 'sp-zzz'])
  })

  it('returns the identical order for the same inputs supplied in a different order', () => {
    const catalog = [
      catalogSong({
        id: 'song-1',
        title: 'Bad',
        artist: 'Michael Jackson',
        versions: [
          version({ versionId: 'v-1', albumName: 'Bad', albumType: 'album', releaseDate: '1987-08-31' }),
          version({ versionId: 'v-2', albumName: 'Live', albumType: 'album', releaseDate: '1988-07-16' }),
        ],
      }),
      catalogSong({ id: 'song-2', title: 'Kashmir', artist: 'Led Zeppelin' }),
    ]
    const tracks = [
      spotifyTrack({ id: 'sp-aaa', title: 'Bad - Remaster 2012', artist: 'Michael Jackson', album: 'Bad' }),
      spotifyTrack({ id: 'sp-bbb', title: 'Thriller', artist: 'Michael Jackson', album: 'Thriller' }),
    ]

    const forwards = mergeSongSearchResults(catalog, tracks)
    const backwards = mergeSongSearchResults([...catalog].reverse(), [...tracks].reverse())

    expect(backwards.map((r) => r.id)).toEqual(forwards.map((r) => r.id))
    expect(backwards.map((r) => r.versions.map((c) => c.versionId ?? c.spotifyTrackId))).toEqual(
      forwards.map((r) => r.versions.map((c) => c.versionId ?? c.spotifyTrackId)),
    )
  })
})

describe('mergeSongSearchResults — row order (ER17)', () => {
  it('puts catalog-backed rows first, then sorts by title and artist', () => {
    const rows = mergeSongSearchResults(
      [
        catalogSong({ id: 'song-2', title: 'Kashmir', artist: 'Led Zeppelin' }),
        catalogSong({ id: 'song-1', title: 'Bad', artist: 'Michael Jackson' }),
      ],
      [spotifyTrack({ id: 'sp-aaa', title: 'Africa', artist: 'Toto' })],
    )

    // `Africa` would lead alphabetically; provider precedence puts it last,
    // reproducing HEAD's catalog-before-Spotify order exactly.
    expect(rows.map((r) => r.id)).toEqual([
      'bad|michael jackson',
      'kashmir|led zeppelin',
      'africa|toto',
    ])
  })

  it('sorts by lowercased artist when two rows share a title', () => {
    const rows = mergeSongSearchResults(
      [
        catalogSong({ id: 'song-1', title: 'Bad', artist: 'u2' }),
        catalogSong({ id: 'song-2', title: 'BAD', artist: 'Michael Jackson' }),
      ],
      [],
    )

    expect(rows.map((r) => r.artist)).toEqual(['Michael Jackson', 'u2'])
  })

  it('breaks a row tie by songId, never by versions[0] on an empty array', () => {
    const rows = mergeSongSearchResults(
      [
        catalogSong({ id: 'song-b', title: 'Bad', artist: 'Michael Jackson' }),
        catalogSong({ id: 'song-a', title: 'bad', artist: 'michael jackson' }),
      ],
      [],
    )

    // Both key identically, so they are one group: the tiebreak is reached
    // only when two rows survive it, and a version-less row has a songId.
    expect(rows).toHaveLength(1)
    expect(rows[0].versions).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// ER19 — degradation
// ---------------------------------------------------------------------------

describe('mergeSongSearchResults — degradation (ER19)', () => {
  it('returns exactly the catalog rows when Spotify answered nothing', () => {
    const rows = mergeSongSearchResults(
      [
        catalogSong({ id: 'song-1', title: 'Bad', artist: 'Michael Jackson' }),
        catalogSong({ id: 'song-2', title: 'Kashmir', artist: 'Led Zeppelin' }),
        catalogSong({ id: 'song-3', title: 'Africa', artist: 'Toto' }),
      ],
      [],
    )

    expect(rows.map((r) => r.title)).toEqual(['Africa', 'Bad', 'Kashmir'])
    expect(rows.every((r) => r.songId !== null)).toBe(true)
  })

  it('returns exactly the Spotify rows when the catalog answered nothing', () => {
    const rows = mergeSongSearchResults(
      [],
      [
        spotifyTrack({ id: 'sp-aaa', title: 'Bad', artist: 'Michael Jackson' }),
        spotifyTrack({ id: 'sp-bbb', title: 'Africa', artist: 'Toto' }),
      ],
    )

    expect(rows.map((r) => r.title)).toEqual(['Africa', 'Bad'])
    expect(rows.every((r) => r.songId === null)).toBe(true)
  })

  it('returns an empty list when both sources answered nothing', () => {
    expect(mergeSongSearchResults([], [])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// ER18 — withoutHeldVersions
// ---------------------------------------------------------------------------

describe('withoutHeldVersions (ER18)', () => {
  it('shrinks a row to the candidates the playlist does not hold (case 1)', () => {
    const rows = [
      row({
        versions: [
          candidate({ versionId: 'v-1' }),
          candidate({ versionId: 'v-2' }),
        ],
      }),
    ]

    const kept = withoutHeldVersions(rows, new Set(['v-1']))

    expect(kept).toHaveLength(1)
    expect(kept[0].versions).toHaveLength(1)
    expect(kept[0].versions[0].versionId).toBe('v-2')
  })

  it('removes a row whose only candidate is held (case 2)', () => {
    const rows = [row({ versions: [candidate({ versionId: 'v-1' })] })]

    expect(withoutHeldVersions(rows, new Set(['v-1']))).toEqual([])
  })

  it('never filters a candidate with no version id (case 3)', () => {
    const rows = [row({ songId: null, versions: [candidate({ spotifyTrackId: 'sp-aaa' })] })]

    expect(withoutHeldVersions(rows, new Set(['v-1']))).toEqual(rows)
  })

  it('drops a collapsed candidate carrying both ids — it is the held recording (case 4)', () => {
    const rows = [
      row({ versions: [candidate({ versionId: 'v-1', spotifyTrackId: 'sp-aaa' })] }),
    ]

    expect(withoutHeldVersions(rows, new Set(['v-1']))).toEqual([])
  })

  it('keeps a version-less catalog row, which no playlist can hold (ER12)', () => {
    // It arrived with no candidates rather than losing them, and
    // `addSongToRepertoire` is what gives such a song its first version.
    const rows = [row({ songId: 'song-3', versions: [] })]

    expect(withoutHeldVersions(rows, new Set(['v-1']))).toEqual(rows)
  })

  it('leaves the rows untouched when the playlist is empty', () => {
    const rows = [row({ versions: [candidate({ versionId: 'v-1' })] })]

    expect(withoutHeldVersions(rows, new Set())).toEqual(rows)
  })
})
