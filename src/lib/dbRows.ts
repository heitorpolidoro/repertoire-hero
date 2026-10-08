import type { Song, SongLink, SongMap, SongStatus } from '@/types/database'

/**
 * Row shapes for SELECT lists that are not already a domain type in
 * `src/types/database.ts` (see AGENTS.md, "Database Row Types"). One interface
 * per distinct projection, named `<Subject>Row` and mirroring it column for
 * column. Never re-declare a domain type here — name it at the call site
 * instead — and never add a speculative one: `npm run lint:dead` (knip) fails
 * on an export nobody imports.
 */

/** `SELECT * FROM get_band_by_invite_code($1)` — `member_count` is a bigint, so pg hands it back as text. */
export interface BandByInviteCodeRow {
  id: string
  name: string
  description: string | null
  cover_url: string | null
  member_count: string
}

/** `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2` */
export interface BandMemberRoleRow {
  role: 'admin' | 'member'
}

/**
 * `songIdentity.ts`'s `LOOKUP_SQL`:
 * `SELECT s.id, <songLinksJson('s')> AS links FROM songs s WHERE LOWER(BTRIM(title)) = LOWER(BTRIM($1)) AND LOWER(BTRIM(artist)) = LOWER(BTRIM($2))`.
 *
 * `links` is the correlated `song_links` aggregate (RH-136), not the
 * `songs.links` column it used to be, so each element may carry a `provider`.
 * The matching insert no longer returns links at all — it returns `id` alone and
 * the create path writes `song_links` rows itself.
 */
export interface SongLinksRow {
  id: string
  links: SongLink[]
}

/** `SELECT * FROM join_band_by_invite($1, $2)` — both columns are NULL when the code matches no band (migration 0004). */
export interface JoinBandByInviteRow {
  band_id: string | null
  already_member: boolean | null
}

/** `SELECT id, user_id, band_id FROM playlists WHERE id = $1 AND (...)` */
export interface PlaylistAccessRow {
  id: string
  user_id: string | null
  band_id: string | null
}

/**
 * `getPlaylistDetailsWithEntries`' projection (RH-125):
 * `SELECT ps.position, o.id AS repertoire_id, ps.version_id, v.song_id, s.title, s.artist
 *    FROM playlist_songs ps JOIN song_versions v … LEFT JOIN <owner table> o …`.
 *
 * `repertoire_id` is nullable because the owner table is `LEFT JOIN`ed: an entry
 * whose owner holds no row is information, not an error, and it is returned
 * rather than dropped. `version_id` is the entry's identity and is never null.
 */
export interface PlaylistEntryRow {
  position: number
  repertoire_id: string | null
  version_id: string
  song_id: string
  title: string
  artist: string
}

/** `SELECT version_id FROM playlist_songs WHERE playlist_id = $1` */
export interface PlaylistVersionIdRow {
  version_id: string
}

/**
 * `SELECT ps.version_id, ps.position, <spotifyLinkUrlsJson('v.song_id')> AS spotify_urls
 *    FROM playlist_songs ps JOIN song_versions v ON v.id = ps.version_id …`
 * — the Spotify push's URL source (RH-137).
 *
 * `spotify_urls` holds the song's `provider = 'spotify'` link urls in the
 * canonical read order `position, created_at, id`, keyed off the derived column
 * on `song_links` rather than off a label or a url substring. It is never null:
 * the fragment wraps the aggregate in `COALESCE(…, '[]'::json)`, so a song with
 * no Spotify link answers an empty array and contributes nothing to the push.
 *
 * There is no `songs` row in this query at all — the push reaches a song's links
 * through `song_links` correlated on the entry's own `v.song_id`, so the
 * retained `songs.links` column is read by nothing in production.
 */
export interface PlaylistVersionSpotifyUrlsRow {
  version_id: string
  position: number
  spotify_urls: string[]
}

/**
 * The `UNION ALL` of the user and band branches in `assertRepertoireAccess`:
 * `SELECT o.id, v.song_id, o.version_id, o.user_id, NULL AS band_id FROM user_songs o ...`.
 * Exactly one of `user_id` / `band_id` is non-null — which branch matched.
 */
export interface RepertoireAccessRow {
  id: string
  song_id: string
  version_id: string
  user_id: string | null
  band_id: string | null
}

/**
 * The `LEVELS` projection in `@/lib/ownerSongRows`: the three resolution levels
 * **raw and un-coalesced**, plus the joined `songs` row as json.
 *
 * Every `owner_*` column is nullable because the owner table is `LEFT JOIN`ed in
 * `getResolvedEntryForVersion` — a null `owner_row_id` is the whole "the owner
 * holds no row" case, not a missing value. The fold is
 * `resolveSongFields`'s; nothing reads these columns directly.
 */
export interface OwnerSongLevelsRow {
  owner_row_id: string | null
  owner_status: SongStatus | null
  owner_key: string | null
  owner_tuning: string | null
  owner_lyrics: string | null
  owner_map: SongMap | null
  owner_tags: string[] | null
  owner_last_practiced: string | null
  version_id: string
  song_id: string
  version_key: string | null
  version_tuning: string | null
  version_lyrics: string | null
  version_map: SongMap | null
  song_lyrics: string | null
  song_map: SongMap | null
  song: Song
}

/** `SELECT access_token, refresh_token, expires_at FROM spotify_tokens WHERE user_id = $1` */
export interface SpotifyTokenRow {
  access_token: string
  refresh_token: string
  expires_at: string
}
