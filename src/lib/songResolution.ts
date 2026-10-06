/**
 * RH-124 — the walk-up, written once.
 *
 * Every screen does two things before it can show a song: find the owner's row,
 * then walk up until a field is non-null (docs/use-cases.md, *Resolving a
 * value*). Finding the row is SQL and lives in `@/lib/ownerSongs`. The walk is
 * here, and **this is the only place either cascade is written**: the SQL
 * selects the three levels' raw columns and this module folds them. A second
 * implementation in `COALESCE` across levels is the defect the rule exists to
 * prevent — two foldings cannot be kept in step, and the one that disagrees is
 * silently wrong rather than broken.
 *
 * Deliberately **no `@/lib/db` import**, so the module is pure, client-safe and
 * unit-testable in the default `node` environment with no mock (AGENTS.md,
 * "Server-only is decided by the `@/lib/db` import").
 *
 * The two depths differ, and getting either wrong is a silent correctness bug:
 *
 *  - **`lyrics` and `map` walk three levels**: owner row -> `song_versions` ->
 *    `songs`. Words and structure belong to the composition, so they start at
 *    the song; a live take overrides them because it has ad-libs and a longer
 *    solo.
 *  - **`key` and `tuning` walk two**: owner row -> `song_versions`, and there
 *    is **no** fallback to `songs`. They are properties of a recording and have
 *    nothing to inherit above it, so null at both levels resolves to null even
 *    when `songs` carries something.
 *  - **`status` has no fallback at all** — it is the owner's or it is `null`,
 *    and "not in my repertoire yet" is legitimate information, never a value
 *    borrowed from the version or the song.
 *  - **`tags` and `last_practiced` are owner-only too**: `[]` and `null` when
 *    there is no row.
 *
 * "First non-null wins" means `null`, not falsy. An empty string and an empty
 * jsonb object are authored values and stop the walk — clearing the lyrics is
 * writing an empty string, and re-inheriting the version's words would make
 * clearing them impossible (*Edit or clear an override*).
 */

import type { SongMap, SongStatus } from '@/types/database'

/** The owner row's seven columns — `user_songs` or `band_songs`, identically. */
export interface OwnerOverrides {
  status: SongStatus | null
  key: string | null
  tuning: string | null
  lyrics: string | null
  map: SongMap | null
  tags: string[]
  last_practiced: string | null
}

/** The middle level: the four overridable columns of `song_versions`. */
export interface VersionLevel {
  key: string | null
  tuning: string | null
  lyrics: string | null
  map: SongMap | null
}

/**
 * The top level: the two columns of `songs` the cascade reaches.
 *
 * `key` and `tuning` are declared and **read by nothing**, on purpose. Their
 * presence is what makes "a key the song carries is still not inherited"
 * something a test can state rather than something a reader has to take on
 * trust (ER9).
 */
export interface SongLevel {
  lyrics: string | null
  map: SongMap | null
  key?: string | null
  tuning?: string | null
}

/** What one song resolves to for one owner: the seven fields a screen reads. */
export interface ResolvedSongFields {
  status: SongStatus | null
  key: string | null
  tuning: string | null
  lyrics: string | null
  map: SongMap | null
  tags: string[]
  last_practiced: string | null
}

/** The all-null override literal a missing owner row is read as. */
const NO_OWNER_ROW: OwnerOverrides = {
  status: null,
  key: null,
  tuning: null,
  lyrics: null,
  map: null,
  tags: [],
  last_practiced: null,
}

/** First non-null of the levels given, in order. `null` only if all are. */
function firstAuthored<T>(...levels: (T | null | undefined)[]): T | null {
  for (const level of levels) {
    if (level !== null && level !== undefined) return level
  }
  return null
}

/**
 * The three levels folded into the one row a screen reads.
 *
 * A missing owner row is not an error: the first statement substitutes the
 * all-null override literal for a null `owner`, so both inputs traverse the
 * same code and "absent resolves like blank" is structural rather than
 * coincidental (ER11).
 */
export function resolveSongFields(input: {
  owner: OwnerOverrides | null
  version: VersionLevel
  song: SongLevel
}): ResolvedSongFields {
  const owner = input.owner ?? NO_OWNER_ROW
  const { version, song } = input

  return {
    // No fallback: the owner's value or nothing.
    status: owner.status,
    // Two levels — a recording's key is not the composition's.
    key: firstAuthored(owner.key, version.key),
    tuning: firstAuthored(owner.tuning, version.tuning),
    // Three levels — words and structure belong to the composition.
    lyrics: firstAuthored(owner.lyrics, version.lyrics, song.lyrics),
    map: firstAuthored(owner.map, version.map, song.map),
    // Owner-only.
    tags: owner.tags,
    last_practiced: owner.last_practiced,
  }
}
