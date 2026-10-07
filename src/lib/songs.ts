/**
 * The shared song catalog: `songs`, its links and the moderated edits to them.
 *
 * Since RH-124 this module holds **no owner-row query**. The per-owner side —
 * `user_songs` and `band_songs` — lives in `@/lib/ownerSongs`, which calls the
 * two catalog halves exported here (`resolveCatalogSongForAdd` and
 * `applyCatalogFill`) inside its own transactions. The split is along the line
 * `updateSong` already drew: the catalog is shared and every owner sees it, the
 * owner row is one musician's or one band's.
 */

import { query, type Queryable } from '@/lib/db'
import { logger } from '@/lib/logger'
import { fetchUrlTitle } from '@/lib/linkFetcher'
import { submitSongEdit } from '@/lib/moderation'
import { resolveOrCreateSongIdentity } from '@/lib/songIdentity'
import {
  representativeVersionOrder,
  representativeVersionSubquery,
  upsertAlbumAndVersion,
} from '@/lib/songVersions'
import { splitCatalogUpdate } from '@/lib/catalogFields'
import type { CatalogSearchResult, Song, SongLink, SongStatus, RefusedCatalogField } from '@/types/database'

/**
 * Every version of `s.id`, in representative order, as a json array (RH-108).
 *
 * `COALESCE(..., '[]'::json)` is what makes a version-less `songs` row answer
 * an empty array rather than null: `json_agg` over no rows is null, and that
 * row still has to render in the picker.
 */
const SONG_VERSIONS_AGGREGATE = `COALESCE((
             SELECT json_agg(json_build_object(
                      'versionId', v.id,
                      'label', v.label,
                      'durationSeconds', v.duration_seconds,
                      'createdAt', v.created_at,
                      'albumName', a.name,
                      'albumType', a.album_type,
                      'albumCoverUrl', a.cover_url,
                      'releaseDate', to_char(a.release_date, 'YYYY-MM-DD')
                    ) ORDER BY ${representativeVersionOrder('v', 'a')})
               FROM song_versions v
               LEFT JOIN albums a ON a.id = v.album_id
              WHERE v.song_id = s.id
           ), '[]'::json)`

/**
 * Catalog matches for the picker's query, each carrying the id of its
 * **representative version** (RH-125) so a collapsed card can add exactly that
 * version and the picker computes no ordering of its own.
 *
 * The subquery is `representativeVersionSubquery`, the one place that ordering
 * exists, and it answers `null` for a `songs` row that has no version yet —
 * which `scripts/seed-catalog.sql` can produce. The caller treats a null as
 * "let the repertoire write resolve it", never as "unavailable".
 *
 * RH-108 adds the `versions` aggregate: the **full ordered list** of each
 * song's versions, so the picker can collapse a catalog row and a Spotify row
 * for one song into one row carrying every recording either source offered.
 * `version_id` stays, so nothing outside the picker has to change.
 *
 * Three things about the aggregate are load-bearing. The join onto `albums` is
 * a `LEFT JOIN` — `song_versions.album_id` is nullable on purpose, and an
 * inner join would silently drop every album-less version
 * (`ownerSongsGuards.test.ts`). `release_date` is rendered as `YYYY-MM-DD`
 * text rather than left to the driver's date handling, because the picker's
 * candidate ordering compares it as a string against Spotify's shorter `YYYY`
 * and `YYYY-MM` prefixes. And the `LIMIT 20` still counts **songs**: limiting
 * versions first and grouping after would drop whole songs from the results
 * depending on how many versions the earlier ones happened to have.
 */
export async function searchSongs(queryStr: string): Promise<CatalogSearchResult[]> {
  const trimmed = queryStr.trim()
  if (!trimmed) return []
  const sql = `
    SELECT s.*, ${representativeVersionSubquery('s.id')} AS version_id,
           ${SONG_VERSIONS_AGGREGATE} AS versions
    FROM songs s
    WHERE s.title ILIKE $1 OR s.artist ILIKE $1
    ORDER BY s.title ASC
    LIMIT 20
  `
  try {
    const res = await query<CatalogSearchResult>(sql, [`%${trimmed}%`])
    return res.rows
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to search global songs', err, { query: trimmed })
    throw new Error(`Failed to search global songs: ${err.message}`)
  }
}

/** The editable song fields a repertoire owner can submit from the song form. */
export interface SongUpdateInput {
  title: string
  artist: string
  album?: string | null
  key: string | null
  status: SongStatus
  tags: string[]
  links: SongLink[]
  cover_url?: string | null
  duration_seconds?: number | null
}

/**
 * The catalog half of a song-form save, run on the caller's transaction client.
 *
 * `FOR UPDATE`, because the fill-or-refuse split below is a read-modify-write
 * on a row every owner of this song shares: a concurrent save must queue behind
 * it rather than read the same blank.
 *
 * The owner-row half is `@/lib/ownerSongs`' `updateSong`, which wraps both in
 * one transaction — both writes or neither: a shared catalog row filled in from
 * an edit the owner's own row never received is worse than no edit at all.
 */
export async function applyCatalogFill(
  songId: string,
  data: SongUpdateInput,
  client: Queryable,
): Promise<RefusedCatalogField[]> {
  const songRes = await client.query<Song>('SELECT * FROM songs WHERE id = $1 FOR UPDATE', [songId])
  if (songRes.rowCount === 0) throw new Error('Song entry not found')

  // Shared catalog: this edit may only fill columns that are currently empty
  // (see `splitCatalogUpdate`). The rest come back as `refused` instead of
  // being silently dropped, and their route is `CorrectionModal` —
  // docs/use-cases.md § "Suggest a correction to the catalog".
  const { fill, refused } = splitCatalogUpdate(songRes.rows[0], {
    title: data.title,
    artist: data.artist,
    album: data.album ?? null,
    standard_key: data.key,
    cover_url: data.cover_url ?? null,
    duration_seconds: data.duration_seconds ?? null,
    links: data.links,
  })

  if (fill.length > 0) {
    // Column names come from `CATALOG_COLUMNS`, never from the caller.
    const setList = fill.map((f, i) => `${f.column} = $${i + 1}${f.cast}`).join(', ')
    await client.query<never>(
      `UPDATE songs SET ${setList}, updated_at = now() WHERE id = $${fill.length + 1}`,
      [...fill.map((f) => f.value), songId],
    )
  }

  return refused
}

/** What the manual add form submits about the song itself. */
export interface SongCreateInput {
  title: string
  artist: string
  album?: string
  standard_key?: string
  cover_url?: string
  duration_seconds?: number
  links?: SongLink[]
}

/**
 * The catalog half of `createAndAddSong` (`@/lib/ownerSongs`): resolve or
 * create the `songs` row, then record its release and recording.
 *
 * `data` is already the resolver's input shape, so the title is parsed once:
 * the left half becomes `songs.title` and the right half comes back as
 * `song.label` for the version (RH-122). Both upserts run on `client`, so they
 * are atomic with the owner-row insert the caller adds — a failure there cannot
 * leave an orphan catalog row behind for everyone else to see (RH-95).
 */
export async function resolveCatalogSongForAdd(
  data: SongCreateInput,
  client: Queryable,
): Promise<string> {
  const song = await resolveOrCreateSongIdentity(data, client)
  await upsertAlbumAndVersion(song, data, client)
  return song.id
}

/**
 * Applies a link edit to the shared `songs` catalog on behalf of a user
 * who already proved a claim on a repertoire entry for the song.
 *
 * Additive changes land directly (a musician adding a chords link mid-rehearsal
 * needs to see it now); removing or rewriting an existing link is a correction
 * to data everyone else sees, so it goes to the RH-15/RH-27 moderation queue
 * and reports `pending` instead of writing.
 */
export async function applySongLinkUpdate(
  userId: string,
  songId: string,
  links: SongLink[],
): Promise<{ success: true; pending?: true }> {
  let songRes
  try {
    songRes = await query<{ links: SongLink[] | null }>('SELECT links FROM songs WHERE id = $1', [songId])
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to update song links', err, { songId })
    throw new Error(`Failed to update song links: ${err.message}`)
  }

  // Outside the wrapper (convention L1a): the UI shows this message verbatim.
  if (songRes.rowCount === 0) throw new Error('Song entry not found')

  const processedLinks = await Promise.all(
    links.map(async (l) => {
      if (!l.label || !l.label.trim()) {
        const fetchedTitle = await fetchUrlTitle(l.url)
        return { label: fetchedTitle || l.url, url: l.url }
      }
      return l
    })
  )

  const currentLinks = songRes.rows[0].links ?? []
  const submittedUrls = new Set(processedLinks.map((l) => l.url))
  const isAdditive = currentLinks.every((l) => submittedUrls.has(l.url))

  if (!isAdditive) {
    await submitSongEdit(userId, songId, { links: processedLinks })
    return { success: true, pending: true }
  }

  try {
    await query<never>('UPDATE songs SET links = $1, updated_at = now() WHERE id = $2', [
      JSON.stringify(processedLinks),
      songId,
    ])
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to update song links', err, { songId })
    throw new Error(`Failed to update song links: ${err.message}`)
  }

  return { success: true }
}
