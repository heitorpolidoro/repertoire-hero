import type { QueryResultRow } from 'pg'
import { query, withTransaction, type DbRow } from '@/lib/db'
import { logger } from '@/lib/logger'
import type { SongFile, Stroke, TabAnnotations } from '@/types/database'

/**
 * Data access for `song_files`. A file belongs to a musician and a composition,
 * never to a band (RH-123), so every function here takes the caller's user id
 * and carries `AND user_id = $n` in the `WHERE` clause of its statement.
 *
 * That predicate *is* the whole authorization story, and a stronger one than
 * the `assertRepertoireAccess` round trip it replaced: there is no band
 * membership through which a third party could reach somebody else's chart, so
 * there is nothing left to check beyond the row's own owner.
 *
 * "Not found" is deliberately not an exception — the reads answer `null` and
 * the annotation write answers `false`, so the Server Actions above keep
 * producing their `{ error: 'Tab not found' }` envelope unchanged. A file
 * belonging to another user is indistinguishable from one that does not exist,
 * which is the right answer to give.
 *
 * The module is still called `tabs.ts` while its row type is `SongFile`. That
 * mismatch is a choice, not an oversight: renaming the whole "tab" vocabulary
 * to "file" (`tabs.ts` -> `files.ts`, `uploadTabAction` -> `uploadFileAction`,
 * `useTabLibrary` -> `useFileLibrary`, the `src/components/fastview` names)
 * touches every consumer without changing behaviour and would bury the re-key
 * it rode on. It is its own task.
 */

/**
 * Runs one statement behind the L1 wrapper (AGENTS.md, "Error Handling
 * Conventions"). Factored out so the functions below do not each carry a copy
 * of the same eight-line log-then-throw block, which `npm run lint:dup` would
 * rightly flag.
 *
 * Generic in the row shape so a caller that knows its SELECT list names it
 * (`runTabQuery<SongFile>(...)`) instead of casting `res.rows` afterwards;
 * every caller below names its row shape, single-column projections inline.
 */
async function runTabQuery<T extends QueryResultRow = DbRow>(
  verb: string,
  sql: string,
  params: unknown[],
  context: Record<string, unknown>,
) {
  try {
    return await query<T>(sql, params)
  } catch (error) {
    return failTabQuery(verb, error, context)
  }
}

/** The L1 log-then-wrap, shared by every statement here (AGENTS.md, "Error Handling Conventions"). */
function failTabQuery(verb: string, error: unknown, context: Record<string, unknown>): never {
  const err = error instanceof Error ? error : new Error(String(error))
  logger.error(`Failed to ${verb}`, err, context)
  throw new Error(`Failed to ${verb}: ${err.message}`)
}

/**
 * The argument shape of {@link createTab} (RH-127).
 *
 * An object rather than five positional parameters, and not because five reads
 * badly: `src/lib/tabs.ts` sits at the global `max-params: 4` ceiling, and the
 * `max-params: 5` override it used to carry was deleted by RH-123 when every
 * function here lost its `repertoireId`. That list is a ratchet that may only
 * shrink, so a fifth parameter has no legal remedy. The object form takes the
 * function to *one* parameter instead, which leaves headroom rather than
 * consuming the last slot.
 *
 * It lives beside its one function, not in `src/types/database.ts` (it is not
 * app vocabulary) and not in `dbRows.ts` (it is not a SQL projection) — the
 * `<Subject>Payload` convention AGENTS.md already names for a
 * parsed-and-narrowed input shape, as in `CatalogSuggestionPayload`.
 *
 * `contentType` is what the ingest actually produced, never the client's
 * claim — see `src/lib/fileIngest.ts`.
 */
export interface CreateSongFilePayload {
  userId: string
  songId: string
  title: string
  fileUrl: string
  contentType: string
  /** Written for audio rows (RH-162) so the per-user quota can be summed. */
  sizeBytes?: number
}

/** The chart predicate every primary-file rule shares: audio rows are never primary (RH-147). */
const IS_CHART = "content_type NOT LIKE 'audio/%'"

/** `unique_violation` raised by the one-primary-per-pair index (E1). */
function isPrimarySlotTaken(error: unknown): boolean {
  const { code, constraint } = error as { code?: string; constraint?: string }
  return code === '23505' && constraint === 'uq_song_files_primary'
}

/**
 * The first chart for a pair becomes its primary; a later upload keeps the
 * existing one (`migrations/0027`'s header). `$7` is whether this attempt may
 * claim the primary slot: two concurrent first uploads both see an empty pair,
 * the index refuses the second, and {@link createTab} retries it with `$7`
 * false, so the loser is stored as a non-primary file instead of failing.
 */
const INSERT_TAB_SQL = `INSERT INTO song_files (user_id, song_id, title, file_url, content_type, size_bytes, is_primary)
     SELECT $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::bigint,
            $7::boolean AND $5::text NOT LIKE 'audio/%'
            AND NOT EXISTS (SELECT 1 FROM song_files WHERE user_id = $1::uuid AND song_id = $2::uuid
                            AND is_primary AND ${IS_CHART})
     RETURNING id, user_id, song_id, title, file_url, content_type, is_primary,
               size_bytes::int as size_bytes, created_at::text as created_at`

export async function createTab(payload: CreateSongFilePayload): Promise<SongFile> {
  const { userId, songId, title, fileUrl, contentType, sizeBytes = null } = payload
  const params = [userId, songId, title, fileUrl, contentType, sizeBytes]

  try {
    const res = await query<SongFile>(INSERT_TAB_SQL, [...params, true])
    return res.rows[0]
  } catch (error) {
    if (!isPrimarySlotTaken(error)) return failTabQuery('create file', error, { userId, songId })
  }

  // The loser of a concurrent first upload: the pair has a primary now.
  const res = await runTabQuery<SongFile>('create file', INSERT_TAB_SQL, [...params, false], {
    userId,
    songId,
  })
  return res.rows[0]
}

export async function getTabFileUrl(fileId: string, userId: string): Promise<string | null> {
  const res = await runTabQuery<{ file_url: string }>(
    'read file url',
    'SELECT file_url FROM song_files WHERE id = $1 AND user_id = $2',
    [fileId, userId],
    { fileId },
  )

  if (res.rows.length === 0) return null
  return res.rows[0].file_url
}

/**
 * Deletes one file. When it was the pair's primary chart, the oldest remaining
 * chart is promoted in the same transaction, so a non-empty list never has zero
 * primaries (RH-147).
 */
export async function deleteTab(fileId: string, userId: string): Promise<void> {
  try {
    await withTransaction(async (client) => {
      const gone = await client.query<{ song_id: string; is_primary: boolean }>(
        'DELETE FROM song_files WHERE id = $1 AND user_id = $2 RETURNING song_id, is_primary',
        [fileId, userId],
      )
      if (gone.rows.length === 0 || !gone.rows[0].is_primary) return
      await client.query(
        `UPDATE song_files SET is_primary = true
         WHERE id = (SELECT id FROM song_files
                     WHERE user_id = $1 AND song_id = $2 AND ${IS_CHART}
                     ORDER BY created_at ASC, id ASC LIMIT 1)`,
        [userId, gone.rows[0].song_id],
      )
    })
  } catch (error) {
    failTabQuery('delete file', error, { fileId })
  }
}

/**
 * Makes one chart file the primary of its `(user_id, song_id)` pair, clearing
 * the previous primary in the same transaction. Answers `false` — writing
 * nothing — when the file/owner pair matches no chart row: another musician's
 * file looks exactly like a missing one, and an audio row is never primary.
 *
 * The pair's rows are locked first so two concurrent designations serialise
 * instead of both setting a primary, which the partial unique index would
 * refuse for one of them.
 */
export async function setTabPrimary(fileId: string, userId: string): Promise<boolean> {
  try {
    return await withTransaction(async (client) => {
      const target = await client.query<{ song_id: string }>(
        `SELECT song_id FROM song_files WHERE id = $1 AND user_id = $2 AND ${IS_CHART}`,
        [fileId, userId],
      )
      if (target.rows.length === 0) return false
      const songId = target.rows[0].song_id

      await client.query(
        'SELECT id FROM song_files WHERE user_id = $1 AND song_id = $2 ORDER BY id FOR UPDATE',
        [userId, songId],
      )
      await client.query(
        'UPDATE song_files SET is_primary = false WHERE user_id = $1 AND song_id = $2 AND is_primary AND id <> $3',
        [userId, songId, fileId],
      )
      await client.query('UPDATE song_files SET is_primary = true WHERE id = $1 AND user_id = $2', [
        fileId,
        userId,
      ])
      return true
    })
  } catch (error) {
    return failTabQuery('set primary file', error, { fileId })
  }
}

export async function getTabAnnotations(
  fileId: string,
  userId: string,
): Promise<TabAnnotations | null> {
  const res = await runTabQuery<{ annotations: TabAnnotations }>(
    'load annotations',
    'SELECT annotations FROM song_files WHERE id = $1 AND user_id = $2',
    [fileId, userId],
    { fileId },
  )

  if (res.rows.length === 0) return null
  return res.rows[0].annotations
}

/**
 * Writes one page's strokes. Answers `false` — not an exception — when the
 * file/owner pair matches no row, so the caller reports "Tab not found".
 */
export async function saveTabAnnotations(
  fileId: string,
  userId: string,
  pageNumber: number,
  strokes: Stroke[],
): Promise<boolean> {
  // Outside the wrapped statement on purpose (convention L1a): `pageNumber` is
  // folded straight into the jsonb_set path, so anything that is not a positive
  // integer is refused with a message the UI shows verbatim, rather than
  // reaching Postgres and coming back as an opaque driver error.
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new Error('Invalid page number')
  }

  // jsonb_set writes/overwrites only this page's key, leaving every other
  // page's strokes in the same row untouched. RETURNING id is what makes the
  // affected-row count readable, so a non-matching pair reports false instead
  // of silently succeeding.
  const res = await runTabQuery<{ id: string }>(
    'save annotations',
    `UPDATE song_files
     SET annotations = jsonb_set(annotations, $3, $4::jsonb, true)
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [fileId, userId, `{${pageNumber}}`, JSON.stringify(strokes)],
    { fileId, pageNumber },
  )

  return res.rows.length > 0
}

/**
 * The chart list: PDF and image rows only. Audio rows (RH-162) share the table
 * but never appear here, in the viewer, or in the offline snapshot captured
 * from this read.
 */
export async function listTabs(userId: string, songId: string): Promise<SongFile[]> {
  const res = await runTabQuery<SongFile>(
    'list files',
    `SELECT id, user_id, song_id, title, file_url, content_type, is_primary,
            created_at::text as created_at
     FROM song_files
     WHERE user_id = $1 AND song_id = $2 AND content_type NOT LIKE 'audio/%'
     ORDER BY created_at DESC`,
    [userId, songId],
    { userId, songId },
  )

  return res.rows
}

/** The reader's own audio rows for one song, newest first (RH-162). */
export async function listAudio(userId: string, songId: string): Promise<SongFile[]> {
  const res = await runTabQuery<SongFile>(
    'list audio files',
    `SELECT id, user_id, song_id, title, file_url, content_type,
            size_bytes::int as size_bytes, created_at::text as created_at
     FROM song_files
     WHERE user_id = $1 AND song_id = $2 AND content_type LIKE 'audio/%'
     ORDER BY created_at DESC`,
    [userId, songId],
    { userId, songId },
  )

  return res.rows
}

/** The total bytes of audio the user has stored, across every song (RH-162). */
export async function sumAudioBytes(userId: string): Promise<number> {
  const res = await runTabQuery<{ total: number }>(
    'sum audio bytes',
    `SELECT COALESCE(SUM(size_bytes), 0)::float8 AS total
     FROM song_files
     WHERE user_id = $1 AND content_type LIKE 'audio/%'`,
    [userId],
    { userId },
  )

  return res.rows[0].total
}

/**
 * Appends one Vercel Blob object to the recovery ledger `migrations/0015`
 * created.
 *
 * Nothing in the application reads `abandoned_blobs`; its future reader is the
 * blob sweeper, which is its own task. It is written when the application
 * stops pointing at an object it cannot prove is gone — exactly the branch in
 * `deleteTabAction` where the row delete succeeded and `del` rejected. When
 * `del` resolves nothing is written: handing the sweeper a URL that no longer
 * resolves would make the ledger a list of false leaks.
 *
 * `ON CONFLICT DO NOTHING` because a URL already recorded is not an error —
 * the ledger wants one entry per object, not one per failure.
 */
export async function recordAbandonedBlob(fileUrl: string, reason: string): Promise<void> {
  await runTabQuery<never>(
    'record an abandoned blob',
    `INSERT INTO abandoned_blobs (file_url, reason)
     VALUES ($1, $2)
     ON CONFLICT (file_url) DO NOTHING`,
    [fileUrl, reason],
    { fileUrl },
  )
}
