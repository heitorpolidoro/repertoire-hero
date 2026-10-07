/**
 * RH-122 — the one parse of an incoming song title, and the replacement for the
 * title/album sanitizer this task deleted.
 *
 * Spotify reports a recording's provenance as a `" - "` suffix on the track
 * name: `"Bad - Remaster 2012"`, `"Smooth Criminal - Live at Wembley"`. The
 * deleted sanitizer *stripped* some of those suffixes and kept others, which
 * made the title do two jobs at once: `"Bad - Remaster 2012"` collapsed onto
 * `"Bad"` and the fact that it was the 2012 remaster was simply lost, while
 * `"- Live at Wembley"` survived into the title and gave the live take a
 * catalog row of its own.
 *
 * `albums` and `song_versions` give the right-hand half somewhere to live, so
 * the title **splits** instead of being stripped: the left half is the song's
 * identity (`songs.title`, under `uq_songs_artist_title`) and the right half is
 * the recording's `song_versions.label`. One parse feeds both keys, and the
 * person choosing between *Bad*, *Bad / Remaster 2012* and *Bad / Remaster
 * 2025* can still see all three.
 *
 * There is deliberately **no vocabulary of special words** to maintain: no
 * remaster/deluxe/anniversary list, no live/acoustic/demo exception list, and
 * no parenthesised forms — `"Sweet Child O' Mine (2022 Remastered)"` keeps its
 * parentheses inside the title. A title that genuinely contains `" - "` is
 * therefore parsed wrongly and shows one extra version; that is the design's
 * chosen error, because an extra row costs a click while a wrong merge has no
 * delete path to undo it.
 *
 * `migrations/0014_add_albums_and_song_versions.sql` carries `song_title_head`
 * and `song_title_label`, the plpgsql halves of this same rule, and
 * `catalogVersions.db.test.ts` replays this module's pinned cases against them
 * so the two cannot drift.
 */

/** The two halves of a parsed title. `label` is null when there is no suffix. */
export interface SplitSongTitle {
  /** The song's identity title — the left half, never empty for non-empty input. */
  title: string
  /** The recording's label — the right half, trimmed, or null. */
  label: string | null
}

/** Spotify's suffix convention. Spaced on both sides, so `Jack-in-the-box` is safe. */
const SEPARATOR = ' - '

/** A separator left dangling with nothing after it, as in `"Song - "`. */
const DANGLING_SEPARATOR = /\s+-\s*$/

/**
 * Splits `raw` at its **first** `" - "` and returns both halves, trimmed.
 *
 * Everything after that first separator is one label, including any further
 * `" - "`: one parse, one label. Four outcomes, all pinned by
 * `src/lib/__tests__/songTitle.test.ts`:
 *
 *  - a usable split (`"Still Of The Night - 2018 Remaster"`) → both halves;
 *  - no separator (`"Hotel California"`) → the whole trimmed string, null label;
 *  - an empty right half (`"Song - "`) → the trimmed string minus the dangling
 *    separator, null label;
 *  - an empty left half (`" - Live"`) → the whole trimmed string, null label.
 *
 * A title is never returned empty unless the input was empty: a row has to be
 * addressable, and `"- Live"` is a worse title than no title only in theory.
 */
export function splitSongTitle(raw: string): SplitSongTitle {
  const trimmed = raw.trim()
  const at = trimmed.indexOf(SEPARATOR)

  // `at > 0` is the "the left half is not empty" test, and it is sufficient:
  // `trimmed` never starts with whitespace, so a separator found at index 0
  // means there is nothing but the separator to its left. That is why only the
  // right half needs an emptiness check here.
  if (at > 0) {
    const title = trimmed.slice(0, at).trim()
    const label = trimmed.slice(at + SEPARATOR.length).trim()
    if (label !== '') return { title, label }
  }

  // No usable split. Drop a dangling separator so `"Song - "` is stored as
  // `"Song"` rather than as `"Song -"`, and fall back to the trimmed input when
  // that would leave nothing behind.
  const head = trimmed.replace(DANGLING_SEPARATOR, '')
  return { title: head === '' ? trimmed : head, label: null }
}

/**
 * RH-108 — the identity a catalog song and a Spotify track are grouped by in
 * the add-song picker: the **split** title then the artist, both lowercased and
 * trimmed, joined by `|`.
 *
 * Splitting the title before lowercasing is the whole collapse: Spotify's
 * `"Bad - Remaster 2012"` and the catalog's `"Bad"` are one song, and the raw
 * lowercase key this replaced (`pickerDedupKey`) said they were two, so the
 * picker drew two adjacent near-identical rows with nothing saying which to
 * press. On a catalog row the split is a no-op in the normal case —
 * `resolveOrCreateSongIdentity` already stored the left half — and it still
 * rescues a `songs` row written outside that resolver, as
 * `scripts/seed-catalog.sql` does.
 *
 * The artist is **not** re-reduced by `primaryArtistName`: both sources deliver
 * a reduced primary artist by construction, and a second copy of the RH-95 rule
 * is the defect RH-95 removed. It could not live here anyway —
 * `songIdentity.ts` imports `pool` and is server-only, while this module has no
 * imports and both of its callers are client-safe.
 *
 * It lives beside `splitSongTitle` because two modules need the identical key:
 * `songSearchMerge.ts`, which groups the search response, and `songPicker.ts`,
 * whose `findRepertoireVersionIdByTrack` recovers a held entry by it.
 */
export function songIdentityKey(title: string, artist: string): string {
  return `${splitSongTitle(title).title.toLowerCase().trim()}|${artist.toLowerCase().trim()}`
}
