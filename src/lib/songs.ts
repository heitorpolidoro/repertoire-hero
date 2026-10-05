import { query, withTransaction } from '@/lib/db'
import { logger } from '@/lib/logger'
import { fetchUrlTitle } from '@/lib/linkFetcher'
import { submitSongEdit } from '@/lib/moderation'
import { resolveOrCreateSongIdentity } from '@/lib/songIdentity'
import { upsertAlbumAndVersion } from '@/lib/songVersions'
import { splitCatalogUpdate } from '@/lib/catalogFields'
import type { RepertoireAccessRow } from '@/lib/dbRows'
import type { Song, Repertoire, SongLink, SongStatus, SongUpdateResult } from '@/types/database'

export type RepertoireOwner = { userId: string } | { bandId: string }

/**
 * The `song` column every repertoire read returns: the joined `songs` row as
 * JSON. Spelled once because five queries embed it — five copies is what kept
 * this file pressed against its `max-lines` ceiling (F20).
 */
const SONG_JSON = `json_build_object(
             'id', s.id, 'title', s.title, 'artist', s.artist,
             'album', s.album, 'standard_key', s.standard_key,
             'cover_url', s.cover_url, 'duration_seconds', s.duration_seconds,
             'links', s.links, 'created_at', s.created_at
           ) as song`

/**
 * The repertoire row the caller may act on, or throws. Reachable when the row
 * is the caller's own or belongs to a band they are a member of; a
 * non-existent id throws the same message, so existence is not leaked.
 */
export async function assertRepertoireAccess(repertoireId: string, userId: string): Promise<RepertoireAccessRow> {
  const sql = `
    SELECT id, song_id, user_id, band_id
    FROM repertoire
    WHERE id = $1
      AND (user_id = $2 OR band_id IN (SELECT band_id FROM band_members WHERE user_id = $2))
  `
  let res
  try {
    res = await query<RepertoireAccessRow>(sql, [repertoireId, userId])
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to authorize repertoire access', err, { repertoireId })
    throw new Error(`Failed to authorize repertoire access: ${err.message}`)
  }

  if (res.rowCount === 0) throw new Error('Access denied: not allowed on this repertoire entry')
  return res.rows[0]
}

export async function getRepertoire(owner: RepertoireOwner): Promise<Repertoire[]> {
  const isBand = 'bandId' in owner
  const id = isBand ? owner.bandId : owner.userId
  const sql = `
    SELECT r.*,
           ${SONG_JSON}
    FROM repertoire r
    JOIN songs s ON r.song_id = s.id
    WHERE ${isBand ? 'r.band_id = $1' : 'r.user_id = $1'}
    ORDER BY r.id DESC
  `
  try {
    const res = await query<Repertoire>(sql, [id])
    return res.rows
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to fetch repertoire', err)
    throw new Error(`Failed to fetch repertoire: ${err.message}`)
  }
}

/**
 * Adds a catalog song to a personal or band repertoire.
 *
 * The new row's `status` is left to the column default, `unknown`, in band
 * context exactly as in personal context: status is per-owner, and nothing
 * derives one owner's value from another's (RH-96).
 */
export async function addSongToRepertoire(
  owner: RepertoireOwner,
  songId: string,
): Promise<Repertoire> {
  const isBand = 'bandId' in owner
  const userId = isBand ? null : owner.userId
  const bandId = isBand ? owner.bandId : null
  const sql = `
    WITH inserted AS (
      INSERT INTO repertoire (song_id, user_id, band_id)
      VALUES ($1, $2, $3)
      RETURNING *
    )
    SELECT i.*,
           ${SONG_JSON}
    FROM inserted i
    JOIN songs s ON i.song_id = s.id
  `
  try {
    const res = await query<Repertoire>(sql, [songId, userId, bandId])
    return res.rows[0]
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to add song to repertoire', err)
    throw new Error(`Failed to add song to repertoire: ${err.message}`)
  }
}

export async function updateSongStatus(owner: RepertoireOwner, repertoireId: string, status: SongStatus): Promise<void> {
  const isBand = 'bandId' in owner
  const id = isBand ? owner.bandId : owner.userId
  const sql = `
    UPDATE repertoire
    SET status = $1
    WHERE id = $2 AND ${isBand ? 'band_id = $3' : 'user_id = $3'}
    RETURNING id
  `
  try {
    const res = await query<{ id: string }>(sql, [status, repertoireId, id])
    if (res.rowCount === 0) throw new Error('Repertoire entry not found or access denied')
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to update song status', err, { repertoireId, status })
    throw new Error(`Failed to update song status: ${err.message}`)
  }
}

export async function updateSongTags(owner: RepertoireOwner, repertoireId: string, tags: string[]): Promise<void> {
  const isBand = 'bandId' in owner
  const id = isBand ? owner.bandId : owner.userId
  const sql = `
    UPDATE repertoire
    SET tags = $1
    WHERE id = $2 AND ${isBand ? 'band_id = $3' : 'user_id = $3'}
    RETURNING id
  `
  try {
    const res = await query<{ id: string }>(sql, [tags, repertoireId, id])
    if (res.rowCount === 0) throw new Error('Repertoire entry not found or access denied')
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to update song tags', err, { repertoireId })
    throw new Error(`Failed to update song tags: ${err.message}`)
  }
}

export async function updatePersonalKey(owner: RepertoireOwner, repertoireId: string, personalKey: string): Promise<void> {
  const isBand = 'bandId' in owner
  const id = isBand ? owner.bandId : owner.userId
  const sql = `
    UPDATE repertoire
    SET personal_key = $1
    WHERE id = $2 AND ${isBand ? 'band_id = $3' : 'user_id = $3'}
    RETURNING id
  `
  try {
    const res = await query<{ id: string }>(sql, [personalKey, repertoireId, id])
    if (res.rowCount === 0) throw new Error('Repertoire entry not found or access denied')
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to update personal key', err, { repertoireId })
    throw new Error(`Failed to update personal key: ${err.message}`)
  }
}

export async function removeSongFromRepertoire(owner: RepertoireOwner, repertoireId: string): Promise<void> {
  const isBand = 'bandId' in owner
  const id = isBand ? owner.bandId : owner.userId
  const sql = `
    DELETE FROM repertoire
    WHERE id = $1 AND ${isBand ? 'band_id = $2' : 'user_id = $2'}
    RETURNING id
  `
  try {
    const res = await query<{ id: string }>(sql, [repertoireId, id])
    if (res.rowCount === 0) throw new Error('Repertoire entry not found or access denied')
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to remove song from repertoire', err, { repertoireId })
    throw new Error(`Failed to remove song from repertoire: ${err.message}`)
  }
}

export async function searchSongs(queryStr: string): Promise<Song[]> {
  const trimmed = queryStr.trim()
  if (!trimmed) return []
  const sql = `
    SELECT * FROM songs
    WHERE title ILIKE $1 OR artist ILIKE $1
    ORDER BY title ASC
    LIMIT 20
  `
  try {
    const res = await query<Song>(sql, [`%${trimmed}%`])
    return res.rows
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to search global songs', err, { query: trimmed })
    throw new Error(`Failed to search global songs: ${err.message}`)
  }
}

export async function getSongEntry(owner: RepertoireOwner, repertoireId: string): Promise<Repertoire | null> {
  const isBand = 'bandId' in owner
  const id = isBand ? owner.bandId : owner.userId
  const sql = `
    SELECT r.*,
           ${SONG_JSON}
    FROM repertoire r
    JOIN songs s ON r.song_id = s.id
    WHERE r.id = $1 AND ${isBand ? 'r.band_id = $2' : 'r.user_id = $2'}
  `
  try {
    const res = await query<Repertoire>(sql, [repertoireId, id])
    if (res.rowCount === 0) return null
    return res.rows[0]
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to fetch song entry', err, { repertoireId })
    throw new Error(`Failed to fetch song entry: ${err.message}`)
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

export async function updateSong(
  owner: RepertoireOwner,
  entry: Repertoire,
  data: SongUpdateInput
): Promise<SongUpdateResult> {
  const isBand = 'bandId' in owner
  const ownerId = isBand ? owner.bandId : owner.userId

  const repSql = `
    UPDATE repertoire SET status = $1, tags = $2, personal_key = $3
    WHERE id = $4 AND ${isBand ? 'band_id = $5' : 'user_id = $5'}
  `

  try {
    // Both writes or neither: a shared catalog row filled in from an edit the
    // owner's own repertoire row never received is worse than no edit at all.
    return await withTransaction(async (client) => {
      // `FOR UPDATE`, because the fill-or-refuse split below is a
      // read-modify-write on a row every owner of this song shares: a
      // concurrent save must queue behind it rather than read the same blank.
      const songRes = await client.query<Song>(
        'SELECT * FROM songs WHERE id = $1 FOR UPDATE',
        [entry.song_id],
      )
      if (songRes.rowCount === 0) throw new Error('Song entry not found')

      // Shared catalog: this edit may only fill columns that are currently
      // empty (see `splitCatalogUpdate`). The rest come back as `refused`
      // instead of being silently dropped, and their route is
      // `CorrectionModal` — docs/use-cases.md § "Suggest a correction to the
      // catalog".
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
          [...fill.map((f) => f.value), entry.song_id],
        )
      }

      await client.query<never>(repSql, [data.status, data.tags, data.key, entry.id, ownerId])

      return { refused }
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to update song', err, { songId: entry.song_id })
    throw new Error(`Failed to update song: ${err.message}`)
  }
}

export async function createAndAddSong(
  owner: RepertoireOwner,
  data: {
    title: string
    artist: string
    album?: string
    standard_key?: string
    cover_url?: string
    duration_seconds?: number
    links?: SongLink[]
  }
): Promise<Repertoire> {
  const isBand = 'bandId' in owner
  const userId = isBand ? null : owner.userId
  const bandId = isBand ? owner.bandId : null

  // `ON CONFLICT DO NOTHING` on the partial `uq_repertoire_{user,band}_song`
  // indexes replaces the old check-then-insert: it answers "already in this
  // repertoire?" and inserts in one statement, so two concurrent calls by the
  // same owner cannot both pass the check (RH-95 ER9). Zero rows back means the
  // row was already there.
  const insertRepSql = `
    WITH inserted AS (
      INSERT INTO repertoire (song_id, user_id, band_id, status)
      VALUES ($1, $2, $3, 'unknown')
      ON CONFLICT DO NOTHING
      RETURNING *
    )
    SELECT i.*,
           ${SONG_JSON}
    FROM inserted i
    JOIN songs s ON i.song_id = s.id
  `

  try {
    // One transaction for the whole create (RH-95): catalog resolution and the
    // repertoire insert either both land or neither does, so a failure here
    // cannot leave an orphan catalog row behind for everyone else to see.
    return await withTransaction(async (client) => {
      // `data` is already the resolver's input shape, so the title is parsed
      // once: the left half becomes `songs.title` and the right half comes back
      // as `song.label` for the version (RH-122). Both upserts run on `client`,
      // so they are atomic with the catalog resolution.
      const song = await resolveOrCreateSongIdentity(data, client)
      await upsertAlbumAndVersion(song, data, client)

      const repRes = await client.query<Repertoire>(insertRepSql, [song.id, userId, bandId])
      // Thrown inside the callback on purpose: the rollback is what undoes a
      // catalog row this call may just have created.
      if (repRes.rowCount === 0) throw new Error('Song already in your repertoire')
      return repRes.rows[0]
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to create and add song', err)
    throw new Error(err.message.includes('already in') ? err.message : `Failed to create and add song: ${err.message}`)
  }
}

/**
 * Writes the owner-scoped lyrics of one repertoire entry, and fails closed:
 * an `(id, owner)` pair that matches no row throws instead of reporting the
 * success the musician would otherwise be shown (RH-83 ER9).
 */
export async function updateLyrics(
  owner: RepertoireOwner,
  repertoireId: string,
  lyrics: string,
): Promise<void> {
  const isBand = 'bandId' in owner
  const id = isBand ? owner.bandId : owner.userId
  const sql = `UPDATE repertoire SET lyrics = $1
    WHERE id = $2 AND ${isBand ? 'band_id = $3' : 'user_id = $3'} RETURNING id`
  let res
  try {
    res = await query<{ id: string }>(sql, [lyrics, repertoireId, id])
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to update lyrics', err, { repertoireId })
    throw new Error(`Failed to update lyrics: ${err.message}`)
  }

  // Outside the wrapper (convention L1a): the UI shows this message verbatim.
  if (res.rowCount === 0) throw new Error('Lyrics entry not found or not editable')
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

/**
 * One user's personal repertoire entry for a catalog song, or `null`. The band
 * half of `RepertoireOwner` has no equivalent here on purpose: the only caller
 * is the fast view, which asks "does this song sit in *my* repertoire?".
 */
export async function getPersonalEntryForSong(
  songId: string,
  userId: string,
): Promise<Repertoire | null> {
  const sql = `
    SELECT r.*,
           ${SONG_JSON}
    FROM repertoire r
    JOIN songs s ON r.song_id = s.id
    WHERE r.song_id = $1 AND r.user_id = $2
  `
  try {
    const res = await query<Repertoire>(sql, [songId, userId])
    if (res.rowCount === 0) return null
    return res.rows[0]
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to fetch personal entry for song', err, { songId })
    throw new Error(`Failed to fetch personal entry for song: ${err.message}`)
  }
}
