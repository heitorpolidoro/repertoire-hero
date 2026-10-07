/**
 * RH-108 — one row per song in the add-song picker, carrying every version
 * both sources offered for it.
 *
 * The list the picker renders was always one `<ul>`; what was wrong is that one
 * song occupied two rows in it. A search for `bad` returned the catalog's
 * `"Bad"` and Spotify's `"Bad - Remaster 2012"` as two adjacent, near-identical
 * rows with nothing saying which to press, because the dedup key this replaces
 * (`pickerDedupKey`) lowercased the **raw** title and `"bad - remaster 2012"`
 * is not `"bad"`. Splitting the title before keying is what collapses them.
 *
 * Two levels of collapse, and they are different questions:
 *
 *  - **a row names a song** — grouped by {@link songIdentityKey}, the split
 *    title then the artist. Given RH-122 that is the only answer that works:
 *    two takes of one song by one artist are one `songs` row with two
 *    `song_versions`, so a list keyed by recording shows the same song twice
 *    with nothing to tell the two apart;
 *  - **a candidate is a recording** — keyed by `(albumName, label)` within a
 *    row. If both sources describe the *same* recording it must be **one**
 *    candidate holding both ids, or RH-112's expanded card lists it twice and
 *    the add path has two ways to reach one `song_versions` row.
 *
 * Matching is exact equality after normalisation; fuzzy matching is RH-113's.
 * **Missed merge is the chosen error** in both forms: the duplicate row survives
 * when the artist halves differ, one extra candidate when the album names do.
 * Both are cheap because **this module writes nothing** — every candidate from
 * both sources stays on the row, so the alternative stays pressable and a wrong
 * grouping is a wrong *list*, never a wrong *row*.
 *
 * Pure and client-safe by construction: it imports `@/lib/songTitle`, which has
 * no imports at all, and types. It cannot reach `primaryArtistName` —
 * `songIdentity.ts` imports `pool` — and must not: the artist arrives already
 * reduced from both sources, and a second copy of the RH-95 rule is the defect
 * RH-95 removed.
 */

import { songIdentityKey, splitSongTitle } from '@/lib/songTitle'
import type { SpotifyTrack } from '@/lib/spotify'
import type { CatalogSearchResult, CatalogVersionOption } from '@/types/database'

/**
 * One recording offered for a row — a catalog version, a Spotify track, or the
 * one collapsed candidate describing both. `source` is **not** a field: it is
 * derived as
 * `versionId !== null ? 'catalog' : 'spotify'`, so a collapsed candidate is a
 * *catalog* candidate — which is what makes the add path take the cheap branch
 * instead of pushing an existing recording back through
 * `resolveOrCreateSongIdentity`.
 *
 * Every field is threaded into `createAndAddSong` on the Spotify branch.
 * `rawTitle` is the **unsplit** source title: `splitSongTitle` runs inside
 * `resolveOrCreateSongIdentity`, which hands the right half to
 * `upsertAlbumAndVersion` as `song_versions.label`, so a row's split display
 * title would write `label: null` for `"Bad - Remaster 2012"` — the stripping
 * RH-122 existed to stop. `spotifyUrl` is here for one reason: it is the `links`
 * entry, without which every created song loses its URL.
 */
export interface SearchVersionCandidate {
  versionId: string | null
  spotifyTrackId: string | null
  rawTitle: string
  albumName: string | null
  albumType: string | null
  /** `YYYY-MM-DD`, or Spotify's shorter `YYYY` / `YYYY-MM` prefix. */
  releaseDate: string | null
  label: string | null
  durationSeconds: number | null
  /** Catalog only: a Spotify candidate has no local row and so no age. */
  createdAt: string | null
  coverUrl: string | null
  spotifyUrl: string | null
}

/**
 * One row of the merged list: a **song**, with its ordered recordings.
 *
 * `id` is the group key itself (`"bad|michael jackson"`), unique per row by
 * construction and stable across renders for a fixed query — which the panel's
 * React `key`, `addingId` and `rowErrors` all require. It replaces HEAD's
 * `song.id` / `track.id` keying, under which a catalog and a Spotify row for one
 * song had two ids and two independent error slots.
 *
 * `versions` is non-empty except for a catalog song with no `song_versions` row
 * yet — a real input, not a defensive branch: `scripts/seed-catalog.sql` inserts
 * into `songs` and never into `song_versions`. Such a row renders in the picker
 * at HEAD, so dropping it would delete a row a musician can see; `songId` is
 * non-null for it and `addSongToRepertoire` resolves its first version.
 */
export interface SongSearchRow {
  id: string
  title: string
  artist: string
  coverUrl: string | null
  album: string | null
  songId: string | null
  versions: SearchVersionCandidate[]
}

/**
 * A group under construction, before its candidates are collapsed and sorted.
 * `catalogTitle` / `catalogArtist` are the catalog row's spelling, which wins
 * over Spotify's where there is one; `songCoverUrl` / `songAlbum` are `songs.cover_url` / `songs.album`, the row-level fallbacks.
 */
interface SongGroup {
  id: string
  songId: string | null
  catalogTitle: string | null
  catalogArtist: string | null
  songCoverUrl: string | null
  songAlbum: string | null
  catalog: SearchVersionCandidate[]
  spotify: SearchVersionCandidate[]
}

/**
 * The recording-level key: the album name and the label, both lowercased and
 * trimmed, with `null` and `''` normalising to the same empty string so the key
 * is total on both sides.
 */
function recordingKey(candidate: SearchVersionCandidate): string {
  const part = (value: string | null): string => (value ?? '').trim().toLowerCase()
  return `${part(candidate.albumName)}|${part(candidate.label)}`
}

/** A catalog version as a candidate. `rawTitle` is the `songs` row's title. */
function catalogCandidate(s: CatalogSearchResult, o: CatalogVersionOption): SearchVersionCandidate {
  return {
    versionId: o.versionId,
    spotifyTrackId: null,
    rawTitle: s.title,
    albumName: o.albumName,
    albumType: o.albumType,
    releaseDate: o.releaseDate,
    label: o.label,
    durationSeconds: o.durationSeconds,
    createdAt: o.createdAt,
    coverUrl: o.albumCoverUrl,
    spotifyUrl: null,
  }
}

/**
 * A Spotify track as a candidate. Its `label` is the right half of the very
 * same split whose left half produced the group key — one parse, both keys, as
 * `songIdentityOf` does for the write path. Spotify ships no label field; the
 * suffix *is* the label.
 */
function spotifyCandidate(track: SpotifyTrack): SearchVersionCandidate {
  return {
    versionId: null,
    spotifyTrackId: track.id,
    rawTitle: track.title,
    albumName: track.album,
    albumType: track.albumType,
    releaseDate: track.releaseDate,
    label: splitSongTitle(track.title).label,
    durationSeconds: null,
    createdAt: null,
    coverUrl: track.albumArt,
    spotifyUrl: track.spotifyUrl,
  }
}

/** The group for `key`, created empty on first sight of it. */
function groupFor(groups: Map<string, SongGroup>, key: string): SongGroup {
  const existing = groups.get(key)
  if (existing) return existing
  const created: SongGroup = {
    id: key, songId: null, catalogTitle: null, catalogArtist: null,
    songCoverUrl: null, songAlbum: null, catalog: [], spotify: [],
  }
  groups.set(key, created)
  return created
}

/** Folds one catalog hit into its group, versions and fallbacks included. */
function addCatalogHit(groups: Map<string, SongGroup>, song: CatalogSearchResult): void {
  const group = groupFor(groups, songIdentityKey(song.title, song.artist))
  // First catalog hit wins every scalar: two `songs` rows keying identically
  // is a catalog duplicate the admin merge screen resolves, not something this
  // read should arbitrate.
  group.songId ??= song.id
  group.catalogTitle ??= song.title
  group.catalogArtist ??= song.artist
  group.songCoverUrl ??= song.cover_url
  group.songAlbum ??= song.album
  for (const option of song.versions) group.catalog.push(catalogCandidate(song, option))
}

/**
 * Folds one Spotify track into its group. Its artist is taken only when no
 * catalog hit supplied one — a candidate carries no artist of its own, and every
 * catalog hit is already folded in by the time this runs.
 */
function addSpotifyHit(groups: Map<string, SongGroup>, track: SpotifyTrack): void {
  const group = groupFor(groups, songIdentityKey(track.title, track.artist))
  group.catalogArtist ??= track.artist
  group.spotify.push(spotifyCandidate(track))
}

/** The one candidate describing both sides of a recording they agree on. */
function collapsePair(c: SearchVersionCandidate, sp: SearchVersionCandidate): SearchVersionCandidate {
  return {
    ...c,
    spotifyTrackId: sp.spotifyTrackId,
    spotifyUrl: sp.spotifyUrl,
    coverUrl: c.coverUrl ?? sp.coverUrl,
  }
}

/** How many candidates carry each recording key. */
function countByRecordingKey(candidates: readonly SearchVersionCandidate[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const c of candidates) counts.set(recordingKey(c), (counts.get(recordingKey(c)) ?? 0) + 1)
  return counts
}

/**
 * The group's candidates, with each recording described once.
 *
 * A key collapses **only** when exactly one catalog and exactly one Spotify
 * candidate carry it. Two candidates of the same provider sharing a key are both
 * kept and never folded into each other — two Spotify tracks titled `"Bad"` on
 * album `"Bad"` both key as `("bad", "")` and remain two — because a
 * keep-the-first dedup would make the output depend on input order, which
 * contradicts the totality this module's ordering claims. Where either side
 * contributes more than one the pairing would be arbitrary, so nothing is
 * paired; the cost is one extra candidate, invisible until RH-112 renders it.
 */
function collapseCandidates(group: SongGroup): SearchVersionCandidate[] {
  const spotifyCounts = countByRecordingKey(group.spotify)
  const catalogCounts = countByRecordingKey(group.catalog)
  const pairs = (candidate: SearchVersionCandidate): boolean => {
    const key = recordingKey(candidate)
    return spotifyCounts.get(key) === 1 && catalogCounts.get(key) === 1
  }

  const collapsed = group.catalog.map((candidate) => {
    if (!pairs(candidate)) return candidate
    const partner = group.spotify.find((s) => recordingKey(s) === recordingKey(candidate))
    return partner ? collapsePair(candidate, partner) : candidate
  })

  return [...collapsed, ...group.spotify.filter((candidate) => !pairs(candidate))]
}

/**
 * Ascending string compare with nulls last, on plain `<` / `>` — deliberately
 * not the locale-aware comparator, whose result depends on the runtime's ICU
 * data: two environments could otherwise disagree about this order.
 */
function compareNullsLast(left: string | null, right: string | null): number {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  if (left < right) return -1
  return left > right ? 1 : 0
}

/** `0` for an `album`, `1` for any other type and for a missing one. */
function albumTypeRank(c: SearchVersionCandidate): number {
  return c.albumType === 'album' ? 0 : 1
}

/** `0` for a catalog candidate — collapsed included — and `1` for a Spotify one. */
function sourceRank(c: SearchVersionCandidate): number {
  return c.versionId !== null ? 0 : 1
}

/** Every candidate has at least one of the two ids, so this is never empty. */
function candidateId(c: SearchVersionCandidate): string {
  return c.versionId ?? c.spotifyTrackId ?? ''
}

/**
 * Mirrors `representativeVersionOrder`, extended only where a Spotify candidate
 * has nothing to compare: `album_type = 'album'` first, then the earliest
 * release date, then the earliest `created_at` — which a Spotify candidate never
 * has, so it falls behind a catalog candidate it ties with and the SQL ordering
 * is preserved for a catalog-only row — then the derived source, then the id.
 * That last step makes it **total**: a uuid and a Spotify base62 id never
 * collide, and no id repeats inside a row after the collapse. The first two
 * steps are what let a Spotify candidate *beat* a catalog one, which is why the
 * two Spotify album fields exist at all.
 */
function compareCandidates(left: SearchVersionCandidate, right: SearchVersionCandidate): number {
  return (
    albumTypeRank(left) - albumTypeRank(right) ||
    compareNullsLast(left.releaseDate, right.releaseDate) ||
    compareNullsLast(left.createdAt, right.createdAt) ||
    sourceRank(left) - sourceRank(right) ||
    compareNullsLast(candidateId(left), candidateId(right))
  )
}

/**
 * Catalog-backed rows first — provider precedence carried forward from HEAD,
 * which mapped the catalog list before the Spotify one — then lowercased title,
 * then lowercased artist, then the id. The last step reads `songId` first and
 * only then `versions[0]`, in that order and never the reverse: a row with an
 * empty `versions` array always has a `songId`, and a row with a null `songId`
 * is Spotify-only and so always has a candidate. No row indexes an empty array.
 *
 * **That last step is unreachable through {@link mergeSongSearchResults} and
 * stays anyway** — it is the one line here no test covers, for this reason and
 * not for want of a case. Reaching it needs two rows agreeing on rank and on
 * lowercased title and artist, which cannot happen: a row's title is either
 * `songs.title` or its first candidate's `rawTitle`, and the group key is a pure
 * function of both, so equal titles and artists mean one group and one row. It
 * is kept because the comparator's contract is to be total.
 */
function compareRows(left: SongSearchRow, right: SongSearchRow): number {
  const rank = (row: SongSearchRow): number => (row.songId !== null ? 0 : 1)
  const tiebreak = (row: SongSearchRow): string | null =>
    row.songId ?? (row.versions[0] ? candidateId(row.versions[0]) : null)

  return (
    rank(left) - rank(right) ||
    compareNullsLast(left.title.toLowerCase(), right.title.toLowerCase()) ||
    compareNullsLast(left.artist.toLowerCase(), right.artist.toLowerCase()) ||
    compareNullsLast(tiebreak(left), tiebreak(right))
  )
}

/** The finished row: candidates collapsed and sorted, then the fallbacks. */
function buildRow(group: SongGroup): SongSearchRow {
  const versions = collapseCandidates(group).sort(compareCandidates)
  const first = versions[0] ?? null

  return {
    id: group.id,
    title: group.catalogTitle ?? first?.rawTitle ?? '',
    artist: group.catalogArtist ?? '',
    // The fallback to `songs.cover_url` is not decoration: a candidate's cover
    // comes from `albums.cover_url` and `song_versions.album_id` is nullable,
    // so a catalog song whose every version is album-less has no candidate
    // cover at all — while the panel renders `songs.cover_url` for it at HEAD.
    coverUrl: versions.find((c) => c.coverUrl !== null)?.coverUrl ?? group.songCoverUrl ?? null,
    album: first?.albumName ?? group.songAlbum ?? null,
    songId: group.songId,
    versions,
  }
}

/**
 * The merged list: one row per song, each carrying every recording both
 * sources offered for it, in a total and deterministic order.
 *
 * Total over its two arrays, which is the degradation contract: empty `tracks`
 * yields exactly the catalog rows, empty `catalog` the Spotify rows, both empty
 * `[]`. A Spotify outage, an unconfigured deployment and a user with no
 * connection all produce a complete catalog-only list, never an empty panel.
 */
export function mergeSongSearchResults(
  catalog: readonly CatalogSearchResult[],
  tracks: readonly SpotifyTrack[],
): SongSearchRow[] {
  const groups = new Map<string, SongGroup>()
  // Catalog first, so every `??=` below prefers the catalog's spelling.
  for (const song of catalog) addCatalogHit(groups, song)
  for (const track of tracks) addSpotifyHit(groups, track)

  return [...groups.values()].map(buildRow).sort(compareRows)
}

/**
 * The rows minus the recordings the playlist already holds.
 *
 * Separate from the merge because the two change at different times: the merge
 * is a function of the search response alone, the filter of the playlist's
 * current contents, which an add changes without re-issuing the search.
 *
 * A row is dropped only when it **had** candidates and lost them all. A row that
 * arrived with none is the version-less catalog song, which cannot be in any
 * playlist — a playlist entry *is* a version — so no set of version ids can hide
 * it, exactly as `visiblePickerCatalog` offered it unconditionally at HEAD.
 * Existing behaviour, not the similarity filtering
 * `docs/plans/repertoire-rework.md` forbids.
 */
export function withoutHeldVersions(
  rows: readonly SongSearchRow[],
  playlistVersionIds: ReadonlySet<string>,
): SongSearchRow[] {
  const kept: SongSearchRow[] = []
  for (const row of rows) {
    const versions = row.versions.filter(
      (candidate) => !candidate.versionId || !playlistVersionIds.has(candidate.versionId),
    )
    if (row.versions.length > 0 && versions.length === 0) continue
    kept.push(versions.length === row.versions.length ? row : { ...row, versions })
  }
  return kept
}
