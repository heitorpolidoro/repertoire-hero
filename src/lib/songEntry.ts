/**
 * Pure, DOM-free decision helpers for Fast View's song entry (RH-52).
 *
 * Extracted for the same reason as `playlistNav.ts`, `tabLibrary.ts` and
 * `lyricsEditor.ts`: the decisions the page used to inline — what the header
 * shows when the join produced no song, whether a band entry still has to load
 * the member's own row, and how the three in-place patches of the loaded entry
 * are applied without mutating it — become directly unit-testable in the
 * default `node` vitest environment, with no DOM, no React and no Server Action.
 *
 * This module must not import the App Router tree and must not import
 * `@/lib/songs.ts`, which is server-side data access and pulls in the `pg` pool.
 *
 * It also declares the `SongEntryController` contract, so the presentational
 * components under `src/components/fastview` can type the controller they
 * receive without importing the hook that builds it.
 */

import type { Repertoire, ResolvedSongEntry, SongLink, SongStatus } from '@/types/database'

/** What the song header renders: the title, the artist line and the key line. */
export interface SongIdentity {
  title: string
  artist: string
  key: string | null
}

/**
 * The three header fields, with the fallbacks the page applied inline: an entry
 * whose join produced no song is still rendered, as `(untitled)` with no artist.
 */
export function songIdentity(entry: ResolvedSongEntry | null): SongIdentity {
  return {
    title: entry?.song?.title ?? '(untitled)',
    artist: entry?.song?.artist ?? '',
    key: entry?.key ?? entry?.song?.standard_key ?? null,
  }
}

/**
 * True only in band context and only once the entry's song id is known: outside
 * a band the route entry already *is* the member's own row, and without a song
 * id there is nothing to look the personal row up by.
 */
export function shouldLoadPersonalEntry(
  bandId: string | null,
  songId: string | null | undefined,
): boolean {
  return Boolean(bandId && songId)
}

/** A new entry carrying `status`; null stays null, as the page's `prev ? ... : null` did. */
export function withStatus(
  entry: ResolvedSongEntry | null,
  status: SongStatus,
): ResolvedSongEntry | null {
  return entry ? { ...entry, status } : null
}

/**
 * A new entry whose song carries `links`. An entry with no song is returned
 * untouched — the page's `if (!prev || !prev.song) return prev` guard.
 */
export function withSongLinks(
  entry: ResolvedSongEntry | null,
  links: SongLink[],
): ResolvedSongEntry | null {
  if (!entry?.song) return entry
  return { ...entry, song: { ...entry.song, links } }
}

/**
 * A new entry carrying `lyrics`; null stays null.
 *
 * Generic over the row's shape, because Fast View patches **both** sides with
 * it: the route entry is a `ResolvedSongEntry` since RH-132 while
 * `personalEntry` is still a `Repertoire` (§3a), and the patch is the same act
 * on either. The returned row keeps the type it was given, so neither caller
 * widens.
 */
export function withLyrics<T extends { lyrics: string | null }>(
  entry: T | null,
  lyrics: string,
): T | null {
  return entry ? { ...entry, lyrics } : null
}

/**
 * Everything `useSongEntry` exposes. Declared here, not in the hook, so the
 * presentational components can type it without importing `src/hooks`.
 */
export interface SongEntryController {
  /**
   * The route's entry; null until it loads.
   *
   * A `ResolvedSongEntry` since RH-132: the route carries a `song_versions.id`
   * and the owner comes from the page's `?bandId=`, so the addressed owner may
   * hold **no row** at this version — `ownerRowId` is then `null`, `status` is
   * `null` and `tags` is `[]`, with `key` / `tuning` / `lyrics` / `map`
   * inherited from the version. That is a page that renders read-only, not a
   * not-found.
   */
  entry: ResolvedSongEntry | null
  /**
   * The member's own entry in band context, else null.
   *
   * **Still a `Repertoire`, still read by song id** (RH-132 §3a): a
   * version-keyed personal read would lose the lyrics of any member who holds
   * the song at a different version than the band's, and would break the
   * create-my-first-personal-chart flow, which inserts against the song's
   * representative version rather than the page's.
   */
  personalEntry: Repertoire | null
  loading: boolean
  loadingPersonal: boolean
  notFound: boolean
  identity: SongIdentity
  /**
   * The page's `?bandId=` — a tab-library input.
   *
   * Taken from the hook's own option since RH-132, because
   * `ResolvedSongEntry` carries no `band_id`. The two are equal by
   * construction: `resolveOwner` derived the owner from that very parameter.
   */
  entryBandId: string | null
  /** `entry.song_id` — a tab-library input. */
  songId: string | null
  /** `personalEntry?.id ?? null` — a tab-library input. */
  personalRepertoireId: string | null
  /**
   * `entry.ownerRowId` — the owner row every write on this page targets, and
   * `null` exactly when the addressed owner holds no row at this version
   * (RH-132 §3c). A null disables every write control.
   */
  ownerRowId: string | null
  /** Adopts a personal entry another controller just created. */
  adoptPersonalEntry: (entry: Repertoire) => void
  applyStatus: (status: SongStatus) => void
  applyLinks: (links: SongLink[]) => void
  applyEntryLyrics: (lyrics: string) => void
  applyPersonalLyrics: (lyrics: string) => void
}
