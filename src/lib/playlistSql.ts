/**
 * RH-125 — the three `playlist_songs` projections, written once.
 *
 * A playlist entry names a **version** since RH-125, so every read of one joins
 * `song_versions` on the way to `songs`. Two of the three reads live in
 * different modules (`getUserPlaylists` here in `@/lib/playlists`,
 * `getBandPlaylists` in `@/lib/bands`) and aggregate the *same* per-entry json;
 * keeping both copies inline would hand `jscpd` a clone and let the two drift —
 * and since these are SQL strings, a drift type-checks and fails only at
 * runtime. The third is pulled out for the same reason `@/lib/dbRows` exists:
 * `@/lib/playlists.ts` sits one line under its `max-lines` ceiling.
 *
 * Nothing here resolves a cascaded field. `key`, `tuning`, `lyrics` and `map`
 * are folded in TypeScript by `resolveSongFields` and by nothing else
 * (AGENTS.md, *Resolving a value*); the one `COALESCE` below is over
 * `duration_seconds`, which is not one of the four and has no cascade — it is
 * the version's playing time where the version records one and the song's
 * otherwise, so a mastery summary's total time does not go blank.
 */

import { songLinksJson } from '@/lib/songLinksSql'

/**
 * The per-entry json both playlist-card reads aggregate: enough to count the
 * entries and sum their playing time, and nothing else. Correlated on `p.id`,
 * so the enclosing query must alias `playlists` as `p`.
 */
export const PLAYLIST_CARD_ENTRIES_JSON = `
      COALESCE(
        (SELECT json_agg(json_build_object(
           'id', ps.id,
           'song', json_build_object(
             'duration_seconds', COALESCE(v.duration_seconds, s.duration_seconds)
           )
         ))
           FROM playlist_songs ps
           JOIN song_versions v ON v.id = ps.version_id
           JOIN songs s ON s.id = v.song_id
          WHERE ps.playlist_id = p.id
        ), '[]'::json)`

/**
 * The whole entry list `getPlaylistWithSongs` nests under `songs`, in position
 * order: the entry's own columns, the version's `label` (which is what makes two
 * takes of one song two readable rows) and the catalog song beside it.
 *
 * It joins no owner table and resolves nothing: the page already reads
 * `getRepertoire(owner)` into the map the view receives, and a second resolution
 * of the same `(owner, version)` would leave a renderer with two answers and no
 * rule for choosing. The map is the single resolved source.
 */
export const PLAYLIST_DETAIL_ENTRIES_JSON = `
      COALESCE(
        (SELECT json_agg(json_build_object(
           'id', ps.id,
           'playlist_id', ps.playlist_id,
           'version_id', ps.version_id,
           'position', ps.position,
           'label', v.label,
           'song', json_build_object(
             'id', s.id,
             'title', s.title,
             'artist', s.artist,
             'album', s.album,
             'standard_key', s.standard_key,
             'cover_url', s.cover_url,
             'duration_seconds', COALESCE(v.duration_seconds, s.duration_seconds),
             'links', ${songLinksJson('s')},
             'created_at', s.created_at
           )
         ) ORDER BY ps.position ASC)
           FROM playlist_songs ps
           JOIN song_versions v ON v.id = ps.version_id
           JOIN songs s ON s.id = v.song_id
          WHERE ps.playlist_id = p.id
        ), '[]'::json)`

/**
 * One owner context's view of a playlist's entries, in position order — what
 * Fast View walks a setlist with.
 *
 * The owner table is **`LEFT JOIN`ed on `(playlist owner, version_id)`**, which
 * is the whole point of the re-key: the pair is that table's unique key, so the
 * hold is one index hit away and no representative-version pick is needed any
 * more (RH-124 added one here; RH-125 deletes it). An owner holding no row for
 * an entry yields a null `repertoire_id` and the entry is still returned — a
 * missing row resolves exactly like a row whose overrides are all null, and
 * dropping the entry used to collapse the entire setlist, because
 * `computePlaylistNav` answers `null` when the current song is not in the list.
 *
 * `$1` is the owner id (the band's or the user's), `$2` the playlist. Both
 * identifiers are chosen by this module's caller from a closed pair, never by a
 * request.
 */
export function playlistEntriesSql(
  table: 'user_songs' | 'band_songs',
  ownerColumn: 'user_id' | 'band_id',
): string {
  return `
    SELECT ps.position, o.id AS repertoire_id, ps.version_id, v.song_id, s.title, s.artist
      FROM playlist_songs ps
      JOIN song_versions v ON v.id = ps.version_id
      JOIN songs s ON s.id = v.song_id
      LEFT JOIN ${table} o ON o.version_id = ps.version_id AND o.${ownerColumn} = $1
     WHERE ps.playlist_id = $2
     ORDER BY ps.position ASC
  `
}
