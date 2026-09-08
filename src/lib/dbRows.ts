import type { SongLink } from '@/types/database'

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

/** `SELECT song_id FROM playlist_songs WHERE playlist_id = $1` */
export interface PlaylistSongIdRow {
  song_id: string
}

/** `SELECT ps.song_id, ps.position, s.links FROM playlist_songs ps JOIN global_songs s ...` */
export interface PlaylistSongLinksRow {
  song_id: string
  position: number
  links: SongLink[] | null
}

/** `SELECT id, song_id, user_id, band_id FROM repertoire WHERE id = $1 AND (...)` */
export interface RepertoireAccessRow {
  id: string
  song_id: string
  user_id: string | null
  band_id: string | null
}

/** `SELECT access_token, refresh_token, expires_at FROM spotify_tokens WHERE user_id = $1` */
export interface SpotifyTokenRow {
  access_token: string
  refresh_token: string
  expires_at: string
}
