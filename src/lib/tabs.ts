import type { QueryResultRow } from 'pg'
import { query, type DbRow } from '@/lib/db'
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
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error(`Failed to ${verb}`, err, context)
    throw new Error(`Failed to ${verb}: ${err.message}`)
  }
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
 * parsed-and-narrowed input shape, as in `SongEditPayload`.
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
}

export async function createTab(payload: CreateSongFilePayload): Promise<SongFile> {
  const { userId, songId, title, fileUrl, contentType } = payload

  const res = await runTabQuery<SongFile>(
    'create file',
    `INSERT INTO song_files (user_id, song_id, title, file_url, content_type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, song_id, title, file_url, content_type,
               created_at::text as created_at`,
    [userId, songId, title, fileUrl, contentType],
    { userId, songId },
  )

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

export async function deleteTab(fileId: string, userId: string): Promise<void> {
  await runTabQuery<never>(
    'delete file',
    'DELETE FROM song_files WHERE id = $1 AND user_id = $2',
    [fileId, userId],
    { fileId },
  )
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

export async function listTabs(userId: string, songId: string): Promise<SongFile[]> {
  const res = await runTabQuery<SongFile>(
    'list files',
    `SELECT id, user_id, song_id, title, file_url, content_type,
            created_at::text as created_at
     FROM song_files
     WHERE user_id = $1 AND song_id = $2
     ORDER BY created_at DESC`,
    [userId, songId],
    { userId, songId },
  )

  return res.rows
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
