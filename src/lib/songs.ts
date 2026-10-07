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

import { query, withTransaction, type Queryable } from '@/lib/db'
import { logger } from '@/lib/logger'
import { fetchUrlTitle } from '@/lib/linkFetcher'
import { submitSongEdit } from '@/lib/moderation'
import { resolveOrCreateSongIdentity } from '@/lib/songIdentity'
import {
  representativeVersionOrder,
  representativeVersionSubquery,
  upsertAlbumAndVersion,
} from '@/lib/songVersions'
import { splitCatalogUpdate, type CatalogFill } from '@/lib/catalogFields'
import { dedupeLinksByUrl, songLinkInsertRows } from '@/lib/songLinksSql'
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

  // The fill-or-refuse decision is taken against the links the catalog really
  // holds — `song_links` rows, not the retained `songs.links` column, which this
  // writer stopped maintaining in RH-136 (`SELECT *` above still returns it, and
  // overriding it here is what keeps `isCatalogFieldEmpty` off a stale array).
  // `FOR UPDATE` on the `songs` row does not lock these rows; it still
  // serialises two concurrent fills of the same song, which is all it ever
  // bought.
  const current = await client.query<SongLink>(
    'SELECT label, url, provider FROM song_links WHERE song_id = $1 ORDER BY position, created_at, id',
    [songId],
  )

  // Shared catalog: this edit may only fill columns that are currently empty
  // (see `splitCatalogUpdate`). The rest come back as `refused` instead of
  // being silently dropped, and their route is `CorrectionModal` —
  // docs/use-cases.md § "Suggest a correction to the catalog".
  const { fill, refused } = splitCatalogUpdate(
    { ...songRes.rows[0], links: current.rows },
    {
      title: data.title,
      artist: data.artist,
      album: data.album ?? null,
      standard_key: data.key,
      cover_url: data.cover_url ?? null,
      duration_seconds: data.duration_seconds ?? null,
      links: data.links,
    },
  )

  const linksFill = fill.find((f) => f.column === 'links')
  const columnFills = fill.filter((f) => f.column !== 'links')
  if (linksFill) await fillSongLinks(songId, linksFill, client)

  // Run whenever a column was filled **or** links were written: a links change
  // bumping the catalog row's timestamp is the existing convention (RH-101) and
  // `catalogTimestamp.db.test.ts` asserts it.
  if (columnFills.length > 0 || linksFill) {
    // Column names come from `CATALOG_COLUMNS`, never from the caller.
    const clauses = columnFills.map((f, i) => `${f.column} = $${i + 1}${f.cast}`)
    // `'updated_at = now()'` is appended to the clause array **inline inside the
    // interpolation**, so the join supplies the comma and an empty `clauses` —
    // reachable now that `links` is partitioned out — still yields valid SQL
    // rather than an empty SET list and a 42601. The literal must stay between
    // the statement's verb and its WHERE in the source text:
    // `catalogTimestampGuard`'s scan is textual.
    await client.query<never>(
      `UPDATE songs SET ${[...clauses, 'updated_at = now()'].join(', ')} WHERE id = $${columnFills.length + 1}`,
      [...columnFills.map((f) => f.value), songId],
    )
  }

  return refused
}

/**
 * The `links` entry of a fill, applied row-wise to `song_links`.
 *
 * The conflict policy below is `DO NOTHING`, and deliberately **not**
 * `DO UPDATE`:
 * this writer fills what is empty and *refuses* what is set, so overwriting an
 * existing row's label here would be exactly the silent catalog overwrite the
 * refusal model exists to prevent. No re-assertion of `position` either, for
 * the same reason — `DO NOTHING` leaves an existing row entirely alone.
 *
 * `dedupeLinksByUrl` is what keeps this statement off 23505. It is the one
 * writer whose failure costs a musician the **whole** song-form save: it runs on
 * `updateSong`'s shared transaction (`@/lib/ownerSongs`), so an aborted
 * statement takes the owner-row write with it.
 *
 * `fillFor` hands the entry back already `JSON.stringify`-ed with
 * `cast: '::jsonb'`, so it is parsed back into a `SongLink[]` here.
 */
async function fillSongLinks(
  songId: string,
  linksFill: CatalogFill,
  client: Queryable,
): Promise<void> {
  const proposed = JSON.parse(String(linksFill.value)) as SongLink[]
  const rows = songLinkInsertRows(songId, dedupeLinksByUrl(proposed))
  if (rows.count === 0) return
  await client.query<never>(
    `INSERT INTO song_links (song_id, url, label, position)
     VALUES ${rows.values}
     ON CONFLICT (song_id, url) DO NOTHING`,
    rows.params,
  )
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
    songRes = await query<{ id: string }>('SELECT id FROM songs WHERE id = $1', [songId])
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to update song links', err, { songId })
    throw new Error(`Failed to update song links: ${err.message}`)
  }

  // Outside the wrapper (convention L1a): the UI shows this message verbatim.
  if (songRes.rowCount === 0) throw new Error('Song entry not found')

  // BEFORE the transaction, and it must stay that way: this loop issues one
  // *outbound HTTP request* per blank-labelled link, to a host a musician chose.
  // Holding a Postgres transaction open across an arbitrary network round trip
  // pins a connection from the pool and holds the `songs` row's locks for the
  // fetcher's timeout, once per link.
  const processedLinks = await Promise.all(
    links.map(async (l) => {
      if (!l.label || !l.label.trim()) {
        const fetchedTitle = await fetchUrlTitle(l.url)
        return { label: fetchedTitle || l.url, url: l.url }
      }
      return l
    })
  )

  let pending: boolean
  try {
    // The `song_links` read, the upsert and the timestamp bump are one
    // transaction — the only sanctioned way to group them.
    pending = await withTransaction(async (client) => {
      const current = await client.query<{ url: string }>(
        'SELECT url FROM song_links WHERE song_id = $1',
        [songId],
      )
      const submittedUrls = new Set(processedLinks.map((l) => l.url))
      if (!current.rows.every((l) => submittedUrls.has(l.url))) return true

      await upsertSongLinks(songId, processedLinks, client)
      // No variable clause list remains at this writer: `links` left the column,
      // so the statement degenerates to a bare timestamp bump.
      await client.query<never>('UPDATE songs SET updated_at = now() WHERE id = $1', [songId])
      return false
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to update song links', err, { songId })
    throw new Error(`Failed to update song links: ${err.message}`)
  }

  if (pending) {
    // Removing or rewriting an existing link is a correction to data everyone
    // else sees, so it goes to the moderation queue and writes nothing.
    await submitSongEdit(userId, songId, { links: processedLinks })
    return { success: true, pending: true }
  }

  return { success: true }
}

/**
 * The additive submission, upserted into `song_links`.
 *
 * The conflict policy below re-asserts both the label and the position,
 * because the whole-array column rewrite it replaces rewrote labels **and
 * order** too, and both must survive. The position clause is load-bearing,
 * not decorative: the bridge trigger leaves
 * gaps on purpose, so a survivor that kept an earlier statement's number would
 * end up **tied** with the freshly inserted row, and the canonical
 * `ORDER BY position, created_at, id` would break that tie on a random uuid.
 *
 * `dedupeLinksByUrl` is what keeps the `DO UPDATE` off `21000 ON CONFLICT DO
 * UPDATE command cannot affect row a second time`, which a duplicate url
 * submitted through the song form would otherwise raise — and nothing between
 * the editor and here rejects one.
 */
async function upsertSongLinks(
  songId: string,
  links: SongLink[],
  client: Queryable,
): Promise<void> {
  const rows = songLinkInsertRows(songId, dedupeLinksByUrl(links))
  if (rows.count === 0) return
  await client.query<never>(
    `INSERT INTO song_links (song_id, url, label, position)
     VALUES ${rows.values}
     ON CONFLICT (song_id, url) DO UPDATE SET label = EXCLUDED.label, position = EXCLUDED.position`,
    rows.params,
  )
}
