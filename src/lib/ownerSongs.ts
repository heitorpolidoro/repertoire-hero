/**
 * RH-124 — every owner-scoped read and write, against `user_songs` and
 * `band_songs`.
 *
 * One table became two, keyed by a **version** instead of a song. The owner
 * comes from the context the screen is in, the version from the row; together
 * they are the unique key (`docs/use-cases.md`, *Resolving a value*). A user's
 * hold and a band's hold on the same version are independent — nothing
 * propagates between them (RH-96).
 *
 * Two rules this module exists to keep true:
 *
 *  - **The cascade is never written in SQL.** Every read projects the three
 *    levels raw and folds them in TypeScript; `@/lib/ownerSongRows` holds that
 *    projection and that fold, `@/lib/songResolution` the cascade itself. No
 *    query here coalesces `lyrics`, `map`, `key` or `tuning` across levels.
 *  - **Every band write is gated at the call site, not here.** The Server
 *    Actions resolve a band owner through `assertBandAdmin`, and the two
 *    playlist-side paths do the same, so the refusal reaches the UI verbatim
 *    (convention L1a). This module takes a resolved owner and trusts it.
 *
 * The vocabulary keeps the word *repertoire* — the `Repertoire` type, the
 * `repertoireId` parameters, `getRepertoire`. It is still the right domain word
 * and the TypeScript rename is its own task (`docs/suggestions-log.md`).
 */

import { query, withTransaction, type Queryable } from '@/lib/db'
import { logger } from '@/lib/logger'
// prettier-ignore
import { LEVELS, OWNER_SONG_COLUMNS, entryFrom, ownerColumn, ownerId, ownerTable, toEntry, toResolvedEntry, type OwnerSongPatch, type RepertoireOwner } from '@/lib/ownerSongRows'
import { buildUpdateSet } from '@/lib/sqlUpdate'
import { applyCatalogFill, resolveCatalogSongForAdd, type SongCreateInput, type SongUpdateInput } from '@/lib/songs'
import {
  ensureSongHasVersion,
  representativeVersionOrder,
  representativeVersionSubquery,
} from '@/lib/songVersions'
import type { OwnerSongLevelsRow, RepertoireAccessRow } from '@/lib/dbRows'
import type { Repertoire, ResolvedSongEntry, SongStatus, SongUpdateResult } from '@/types/database'

export type { OwnerSongPatch, RepertoireOwner }

/**
 * The repertoire row the caller may act on, or throws. Reachable when the row
 * is the caller's own or belongs to a band they are a member of — reading and
 * link editing stay member-level — and a non-existent id throws the same
 * message, so existence is not leaked.
 */
export async function assertRepertoireAccess(repertoireId: string, userId: string): Promise<RepertoireAccessRow> {
  const sql = `
    SELECT o.id, v.song_id, o.version_id, o.user_id, NULL::uuid AS band_id
      FROM user_songs o JOIN song_versions v ON v.id = o.version_id
     WHERE o.id = $1 AND o.user_id = $2
    UNION ALL
    SELECT o.id, v.song_id, o.version_id, NULL::uuid AS user_id, o.band_id
      FROM band_songs o JOIN song_versions v ON v.id = o.version_id
     WHERE o.id = $1
       AND o.band_id IN (SELECT band_id FROM band_members WHERE user_id = $2)
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

/**
 * One owner's whole repertoire, newest first. `created_at DESC, id DESC`
 * replaces `ORDER BY r.id DESC`, which was meaningless for a uuid; for migrated
 * rows, all stamped at migration time, it degrades to exactly the old order.
 */
export async function getRepertoire(owner: RepertoireOwner): Promise<Repertoire[]> {
  const sql = `
    SELECT ${LEVELS}
    ${entryFrom(owner)}
    WHERE o.${ownerColumn(owner)} = $1
    ORDER BY o.created_at DESC, o.id DESC
  `
  try {
    const res = await query<OwnerSongLevelsRow>(sql, [ownerId(owner)])
    return res.rows.map((row) => toEntry(row, owner))
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to fetch repertoire', err)
    throw new Error(`Failed to fetch repertoire: ${err.message}`)
  }
}

/**
 * The insert both add paths run: one row for `$1`'s hold on the representative
 * version of the song `$2`, read straight back as a resolved entry. Each caller
 * guarantees the song has a version first, so the `NOT NULL` on `version_id`
 * can only fire on a broken invariant.
 */
function addRowSql(owner: RepertoireOwner, onConflict = ''): string {
  return `
    WITH inserted AS (
      INSERT INTO ${ownerTable(owner)} (${ownerColumn(owner)}, version_id)
      SELECT $1, ${representativeVersionSubquery('$2')}
      ${onConflict}
      RETURNING *
    )
    SELECT ${LEVELS}
    FROM inserted o
    JOIN song_versions v ON v.id = o.version_id
    JOIN songs s ON s.id = v.song_id
  `
}

/**
 * Adds a catalog song to a personal or band repertoire, against that song's
 * representative version. The row is born `unknown` by the column default, in
 * band context exactly as in personal context: status is per-owner and nothing
 * derives one owner's value from another's (RH-96).
 */
export async function addSongToRepertoire(owner: RepertoireOwner, songId: string): Promise<Repertoire> {
  const sql = addRowSql(owner)
  try {
    return await withTransaction(async (client) => {
      await ensureSongHasVersion(songId, client)
      const res = await client.query<OwnerSongLevelsRow>(sql, [ownerId(owner), songId])
      return toEntry(res.rows[0], owner)
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to add song to repertoire', err)
    throw new Error(`Failed to add song to repertoire: ${err.message}`)
  }
}

/**
 * **The** owner-row write. Every per-field entry point delegates here, so
 * "every override is writable and every write is scoped to its owner" is one
 * fact instead of seven. Returns the rows matched; zero means the
 * `(id, owner)` pair matches nothing, which each caller words for itself.
 *
 * `map` is jsonb and is serialized on the way in — the driver would otherwise
 * send an object as a Postgres record literal. `null` stays SQL NULL:
 * `JSON.stringify(null)` would write the jsonb scalar `null`, an authored value
 * that stops the cascade instead of sending it up.
 */
async function writeOwnerSongRow(
  owner: RepertoireOwner,
  repertoireId: string,
  patch: OwnerSongPatch,
  db?: Queryable,
): Promise<number> {
  const serialized: Record<string, unknown> = { ...patch }
  if (patch.map !== undefined && patch.map !== null) serialized.map = JSON.stringify(patch.map)

  const { setClauses, values, nextIndex } = buildUpdateSet(serialized, OWNER_SONG_COLUMNS)
  // A programming error, not a data condition: an all-undefined patch would
  // build `SET  WHERE`, and reporting it as "entry not found" would send the
  // caller looking in the wrong place.
  if (setClauses.length === 0) throw new Error('an owner-row write needs at least one field')

  const sql = `
    UPDATE ${ownerTable(owner)}
    SET ${setClauses.join(', ')}
    WHERE id = $${nextIndex} AND ${ownerColumn(owner)} = $${nextIndex + 1}
    RETURNING id
  `
  const params = [...values, repertoireId, ownerId(owner)]
  const res = db ? await db.query<{ id: string }>(sql, params) : await query<{ id: string }>(sql, params)
  return res.rowCount ?? 0
}

/**
 * The three per-field writes' shared body: write, and fail closed on no match
 * with the message they have always thrown. The `rowCount === 0` throw sits
 * **inside** the wrapper, as before — the UI shows
 * `Failed to <verb>: Repertoire entry not found or access denied`.
 */
async function writeOwnerField(
  owner: RepertoireOwner,
  repertoireId: string,
  patch: OwnerSongPatch,
  log: { verb: string; context?: Record<string, unknown> },
): Promise<void> {
  try {
    const matched = await writeOwnerSongRow(owner, repertoireId, patch)
    if (matched === 0) throw new Error('Repertoire entry not found or access denied')
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error(`Failed to ${log.verb}`, err, { repertoireId, ...log.context })
    throw new Error(`Failed to ${log.verb}: ${err.message}`)
  }
}

export async function updateSongStatus(owner: RepertoireOwner, repertoireId: string, status: SongStatus): Promise<void> {
  const log = { verb: 'update song status', context: { status } }
  await writeOwnerField(owner, repertoireId, { status }, log)
}

export async function updateSongTags(owner: RepertoireOwner, repertoireId: string, tags: string[]): Promise<void> {
  await writeOwnerField(owner, repertoireId, { tags }, { verb: 'update song tags' })
}

/**
 * **Every override is writable through one call**, which is the other half of
 * what makes {@link writeOwnerSongRow} the single write: `tuning` and `map` have
 * no per-field entry point because no screen hosts them yet (RH-102 and RH-118
 * own that), and a patch is how they are reached in the meantime.
 */
export async function updateSongOverrides(
  owner: RepertoireOwner,
  repertoireId: string,
  patch: OwnerSongPatch,
): Promise<void> {
  await writeOwnerField(owner, repertoireId, patch, { verb: 'update song overrides' })
}

/**
 * The owner's key override, named for the column it writes now: `personal_key`
 * became `user_songs.key` / `band_songs.key`, and null here is what sends
 * resolution to `song_versions.key` — and no further.
 */
export async function updateSongKey(owner: RepertoireOwner, repertoireId: string, key: string | null): Promise<void> {
  await writeOwnerField(owner, repertoireId, { key }, { verb: 'update personal key' })
}

/**
 * Writes the owner-scoped lyrics of one entry, and fails closed: an
 * `(id, owner)` pair matching no row throws instead of reporting the success
 * the musician would otherwise be shown (RH-83 ER9).
 */
export async function updateLyrics(owner: RepertoireOwner, repertoireId: string, lyrics: string): Promise<void> {
  let matched: number
  try {
    matched = await writeOwnerSongRow(owner, repertoireId, { lyrics })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to update lyrics', err, { repertoireId })
    throw new Error(`Failed to update lyrics: ${err.message}`)
  }

  // Outside the wrapper (convention L1a): the UI shows this message verbatim.
  if (matched === 0) throw new Error('Lyrics entry not found or not editable')
}

export async function removeSongFromRepertoire(owner: RepertoireOwner, repertoireId: string): Promise<void> {
  const sql = `
    DELETE FROM ${ownerTable(owner)}
    WHERE id = $1 AND ${ownerColumn(owner)} = $2
    RETURNING id
  `
  try {
    const res = await query<{ id: string }>(sql, [repertoireId, ownerId(owner)])
    if (res.rowCount === 0) throw new Error('Repertoire entry not found or access denied')
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to remove song from repertoire', err, { repertoireId })
    throw new Error(`Failed to remove song from repertoire: ${err.message}`)
  }
}

/**
 * One owner row by its id, or **`null`**.
 *
 * The `null` is load-bearing and is not becoming a throw: `useSongEntry.ts`
 * drives the Fast View not-found screen from it, and `useOfflinePlaylist.ts`
 * skips an unreadable entry on it so an offline download completes.
 */
export async function getSongEntry(owner: RepertoireOwner, repertoireId: string): Promise<Repertoire | null> {
  const sql = `
    SELECT ${LEVELS}
    ${entryFrom(owner)}
    WHERE o.id = $1 AND o.${ownerColumn(owner)} = $2
  `
  try {
    const res = await query<OwnerSongLevelsRow>(sql, [repertoireId, ownerId(owner)])
    if (res.rowCount === 0) return null
    return toEntry(res.rows[0], owner)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to fetch song entry', err, { repertoireId })
    throw new Error(`Failed to fetch song entry: ${err.message}`)
  }
}

/**
 * One user's own row for a catalog song, or `null` — the Fast View's "does this
 * song sit in *my* repertoire?". Keyed by `(song_id, user_id)` and not by a
 * version, so the representative-version ordering is applied to the rows the
 * user **actually holds**, through a lateral; that preserves the
 * one-row-per-song answer the caller expects. **The lateral stays**: RH-125
 * deleted the two in the *playlist* reads, whose rows carry a `version_id` now,
 * but this caller holds a `songs.id` — Fast View and the offline snapshot are
 * still owner-row-addressed, and re-addressing them (RH-109) is what deletes it.
 */
export async function getPersonalEntryForSong(songId: string, userId: string): Promise<Repertoire | null> {
  const sql = `
    SELECT ${LEVELS}
    FROM songs s
    JOIN LATERAL (
      SELECT uo.* FROM user_songs uo
      JOIN song_versions uv ON uv.id = uo.version_id
      LEFT JOIN albums ua ON ua.id = uv.album_id
      WHERE uo.user_id = $2 AND uv.song_id = s.id
      ORDER BY ${representativeVersionOrder('uv', 'ua')}
      LIMIT 1
    ) o ON true
    JOIN song_versions v ON v.id = o.version_id
    WHERE s.id = $1
  `
  try {
    const res = await query<OwnerSongLevelsRow>(sql, [songId, userId])
    if (res.rowCount === 0) return null
    return toEntry(res.rows[0], { userId })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to fetch personal entry for song', err, { songId })
    throw new Error(`Failed to fetch personal entry for song: ${err.message}`)
  }
}

/**
 * One `(owner, version)` pair resolved — **the read a missing owner row must
 * not break** (ER12).
 *
 * The version and song levels are read unconditionally and the owner table is
 * `LEFT JOIN`ed on `(owner, version_id)`, so an owner holding no row gets
 * `ownerRowId: null`, `status: null`, `tags: []`, `last_practiced: null` and the
 * inherited `key` / `tuning` / `lyrics` / `map`. It never answers `null` and
 * never throws for an absent owner row — only for a `versionId` that does not
 * exist, and for a database failure.
 */
export async function getResolvedEntryForVersion(owner: RepertoireOwner, versionId: string): Promise<ResolvedSongEntry> {
  const sql = `
    SELECT ${LEVELS}
    FROM song_versions v
    JOIN songs s ON s.id = v.song_id
    LEFT JOIN ${ownerTable(owner)} o
      ON o.version_id = v.id AND o.${ownerColumn(owner)} = $2
    WHERE v.id = $1
  `
  try {
    const res = await query<OwnerSongLevelsRow>(sql, [versionId, ownerId(owner)])
    if (res.rowCount === 0) throw new Error('Song version not found')
    return toResolvedEntry(res.rows[0])
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to resolve song version', err, { versionId })
    throw new Error(`Failed to resolve song version: ${err.message}`)
  }
}

/**
 * A song-form save: the shared catalog's fill-or-refuse half, then the owner
 * row's three columns. Both writes or neither — a catalog row filled in from an
 * edit the owner's own row never received is worse than no edit at all.
 */
export async function updateSong(owner: RepertoireOwner, entry: Repertoire, data: SongUpdateInput): Promise<SongUpdateResult> {
  try {
    return await withTransaction(async (client) => {
      const refused = await applyCatalogFill(entry.song_id, data, client)
      const patch = { status: data.status, tags: data.tags, key: data.key }
      await writeOwnerSongRow(owner, entry.id, patch, client)
      return { refused }
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to update song', err, { songId: entry.song_id })
    throw new Error(`Failed to update song: ${err.message}`)
  }
}

/**
 * Creates the catalog row (with its album and version) and the owner's hold on
 * it, in one transaction.
 *
 * `ON CONFLICT DO NOTHING` on the owner table's unique answers "already in this
 * repertoire?" and inserts in one statement, so two concurrent calls by the same
 * owner cannot both pass a check (RH-95 ER9). Zero rows back means the row was
 * already there, and the throw is inside the callback on purpose: the rollback
 * undoes a catalog row this call may just have created.
 */
export async function createAndAddSong(owner: RepertoireOwner, data: SongCreateInput): Promise<Repertoire> {
  const insertSql = addRowSql(owner, 'ON CONFLICT DO NOTHING')
  try {
    return await withTransaction(async (client) => {
      const songId = await resolveCatalogSongForAdd(data, client)
      const res = await client.query<OwnerSongLevelsRow>(insertSql, [ownerId(owner), songId])
      if (res.rowCount === 0) throw new Error('Song already in your repertoire')
      return toEntry(res.rows[0], owner)
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to create and add song', err)
    throw new Error(
      err.message.includes('already in') ? err.message : `Failed to create and add song: ${err.message}`,
    )
  }
}
