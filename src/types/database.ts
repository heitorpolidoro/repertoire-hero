export type SongStatus =
  | "unknown"
  | "learning"
  | "practicing"
  | "polishing"
  | "mastered";

export interface SongLink {
  label: string;
  url: string;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  standard_key: string | null;
  cover_url: string | null;
  duration_seconds: number | null;
  links: SongLink[];
  created_at: string;
}

/**
 * The shared `songs` columns a direct song edit can be refused on
 * (RH-97). `standard_key` is deliberately absent: the song form's key input
 * writes the owner row's `key` (`user_songs` / `band_songs`), which always
 * succeeds, so reporting a refused catalog key would be a false alarm.
 */
export type RefusableCatalogColumn =
  | "title"
  | "artist"
  | "album"
  | "cover_url"
  | "duration_seconds"
  | "links";

/** Whatever one shared catalog column can hold. */
export type CatalogFieldValue = string | number | SongLink[] | null;

/**
 * One shared catalog column a save did not write, because the catalog already
 * holds a different value. Public vocabulary: it crosses a Server Action
 * boundary from `updateSong` into the song form.
 */
export interface RefusedCatalogField {
  column: RefusableCatalogColumn;
  current: CatalogFieldValue;
  proposed: CatalogFieldValue;
}

/** What `updateSong` reports: the owner-local write always landed; these shared columns did not. */
export interface SongUpdateResult {
  refused: RefusedCatalogField[];
}

/**
 * The `jsonb` a song map holds. Deliberately unshaped: the map editor (RH-118)
 * is what will give it a structure, and inventing one here would be a guess
 * every reader then has to work around.
 */
export type SongMap = Record<string, unknown>;

/**
 * One owner's hold on one **version** of a song, with every field already
 * resolved through `resolveSongFields` (RH-124).
 *
 * The row behind it is a `user_songs` or a `band_songs` row — `repertoire` is
 * gone — and `id` is that row's id. The name stays: "repertoire" is still the
 * right domain word, and the TypeScript/route vocabulary rename is its own
 * task (docs/suggestions-log.md).
 *
 * `key`, `tuning`, `lyrics` and `map` are **resolved** values, so they may have
 * come from `song_versions` or (for `lyrics` and `map` only) from `songs`. They
 * are not necessarily this row's own overrides, which is why a write never
 * echoes them back: it sends what the musician typed.
 *
 * `status` is not nullable here, unlike on {@link ResolvedSongEntry}: a
 * `Repertoire` is only ever produced from a row that exists, and a row that
 * exists has a status by the column default.
 */
export interface Repertoire {
  id: string;
  user_id: string | null;
  band_id: string | null;
  song_id: string;
  /** `song_versions.id` — half of the owner row's unique key. */
  version_id: string;
  key: string | null;
  tuning: string | null;
  status: SongStatus;
  tags: string[];
  last_practiced: string | null;
  lyrics: string | null;
  map: SongMap | null;
  song?: Song;
}

/**
 * One `(owner, version)` pair resolved, **whether or not the owner holds a
 * row** — the shape `getResolvedEntryForVersion` answers with (RH-124 ER12).
 *
 * It is the shape a missing owner row must not break: `ownerRowId` is `null`,
 * `status` is `null`, `tags` is `[]` and `last_practiced` is `null`, while
 * `key` / `tuning` / `lyrics` / `map` are inherited exactly as they are for a
 * row whose overrides are all null. "Not in my repertoire yet" is information,
 * not an error.
 */
export interface ResolvedSongEntry {
  /** The `user_songs` / `band_songs` row's id, or `null` when there is none. */
  ownerRowId: string | null;
  version_id: string;
  song_id: string;
  status: SongStatus | null;
  key: string | null;
  tuning: string | null;
  lyrics: string | null;
  map: SongMap | null;
  tags: string[];
  last_practiced: string | null;
  song?: Song;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  instruments: string[];
  primary_instrument: string | null;
  is_system_admin?: boolean;
}

export type EditStatus = "pending" | "approved" | "rejected";

export interface SongEdit {
  id: string;
  song_id: string;
  requested_by: string;
  proposed_data: Record<string, unknown>;
  status: EditStatus;
  reviewed_by: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  song?: Song;
  requester?: Profile;
}

export interface Playlist {
  id: string;
  user_id: string | null;
  band_id: string | null;
  name: string;
  description: string | null;
  cover_url: string | null;
  spotify_playlist_id: string | null;
  sync_with_spotify: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  tags: string[];
  songs?: PlaylistSong[];
  band?: { id: string; name: string } | null;
}

export interface Band {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  color?: string | null;
  invite_code: string;
  created_at: string;
  updated_at: string;
  members?: BandMember[];
}

/** The minimal band shape the app chrome's context switcher renders (RH-46). */
export interface BandOption {
  id: string;
  name: string;
  color?: string | null;
}

export interface BandMember {
  id: string;
  band_id: string;
  user_id: string;
  role: "admin" | "member";
  joined_at: string;
  profile?: Pick<
    Profile,
    "id" | "full_name" | "avatar_url" | "email" | "primary_instrument"
  >;
}

export interface PlaylistSong {
  id: string;
  playlist_id: string;
  song_id: string;
  position: number;
  song?: Song;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  total_tracks: number;
  owner: string;
}

export interface Stroke {
  id: string; // client-generated (crypto.randomUUID()), used for undo (pop by id) and eraser hit-testing (remove by id)
  color: string; // any hex color, e.g. "#ef4444" or "#7c3aed" — a free string, not an enum
  width: number; // stroke width in normalized units (a fraction of the page's original width)
  points: [number, number][]; // [x, y] pairs, each 0..1 relative to the PDF page's original (scale-independent) dimensions
}

// song_files.annotations shape: page number (1-indexed, as string) -> that page's strokes
export type TabAnnotations = Record<string, Stroke[]>;

// One uploaded chart, belonging to a musician and a composition (RH-123).
// Keyed by `(user_id, song_id)` and carrying no band id: a file belongs to the
// person, not to the band.
export interface SongFile {
  id: string;
  user_id: string;
  song_id: string;
  title: string;
  file_url: string;
  created_at: string;
  annotations?: TabAnnotations; // only present when explicitly fetched via getTabAnnotationsAction
}
