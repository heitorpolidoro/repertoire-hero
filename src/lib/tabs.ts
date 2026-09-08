import type { QueryResultRow } from 'pg'
import { query, type DbRow } from '@/lib/db'
import { logger } from '@/lib/logger'
import { assertRepertoireAccess } from '@/lib/songs'
import type { RepertoireTab, Stroke, TabAnnotations } from '@/types/database'

/**
 * Data access for `repertoire_tabs`. Every function here takes the caller's
 * user id and asserts `assertRepertoireAccess` before touching the table: the
 * repertoire entry is the only thing a tab is owned through, so that single
 * predicate is the whole authorization story for this module.
 *
 * "Not found" is deliberately not an exception — the reads answer `null` and
 * the annotation write answers `false`, so the Server Actions above can keep
 * producing their `{ error: 'Tab not found' }` envelope unchanged.
 */

/**
 * Runs one statement behind the L1 wrapper (AGENTS.md, "Error Handling
 * Conventions"). Factored out so the six functions below do not each carry a
 * copy of the same eight-line log-then-throw block, which `npm run lint:dup`
 * would rightly flag.
 *
 * Generic in the row shape so a caller that knows its SELECT list names it
 * (`runTabQuery<RepertoireTab>(...)`) instead of casting `res.rows` afterwards;
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

export async function createTab(
  repertoireId: string,
  userId: string,
  title: string,
  fileUrl: string,
): Promise<RepertoireTab> {
  await assertRepertoireAccess(repertoireId, userId)

  const res = await runTabQuery<RepertoireTab>(
    'create tab',
    `INSERT INTO repertoire_tabs (repertoire_id, title, file_url)
     VALUES ($1, $2, $3)
     RETURNING id, repertoire_id, title, file_url, created_at::text as created_at`,
    [repertoireId, title, fileUrl],
    { repertoireId },
  )

  return res.rows[0]
}

export async function getTabFileUrl(
  tabId: string,
  repertoireId: string,
  userId: string,
): Promise<string | null> {
  await assertRepertoireAccess(repertoireId, userId)

  const res = await runTabQuery<{ file_url: string }>(
    'read tab file url',
    'SELECT file_url FROM repertoire_tabs WHERE id = $1 AND repertoire_id = $2',
    [tabId, repertoireId],
    { tabId, repertoireId },
  )

  if (res.rows.length === 0) return null
  return res.rows[0].file_url
}

export async function deleteTab(tabId: string, repertoireId: string, userId: string): Promise<void> {
  await assertRepertoireAccess(repertoireId, userId)

  await runTabQuery<never>(
    'delete tab',
    'DELETE FROM repertoire_tabs WHERE id = $1 AND repertoire_id = $2',
    [tabId, repertoireId],
    { tabId, repertoireId },
  )
}

export async function getTabAnnotations(
  tabId: string,
  repertoireId: string,
  userId: string,
): Promise<TabAnnotations | null> {
  await assertRepertoireAccess(repertoireId, userId)

  const res = await runTabQuery<{ annotations: TabAnnotations }>(
    'load annotations',
    'SELECT annotations FROM repertoire_tabs WHERE id = $1 AND repertoire_id = $2',
    [tabId, repertoireId],
    { tabId, repertoireId },
  )

  if (res.rows.length === 0) return null
  return res.rows[0].annotations
}

/**
 * Writes one page's strokes. Answers `false` — not an exception — when the
 * tab/repertoire pair matches no row, so the caller reports "Tab not found".
 */
export async function saveTabAnnotations(
  tabId: string,
  repertoireId: string,
  userId: string,
  pageNumber: number,
  strokes: Stroke[],
): Promise<boolean> {
  await assertRepertoireAccess(repertoireId, userId)

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
    `UPDATE repertoire_tabs
     SET annotations = jsonb_set(annotations, $3, $4::jsonb, true)
     WHERE id = $1 AND repertoire_id = $2
     RETURNING id`,
    [tabId, repertoireId, `{${pageNumber}}`, JSON.stringify(strokes)],
    { tabId, repertoireId, pageNumber },
  )

  return res.rows.length > 0
}

export async function listTabs(repertoireId: string, userId: string): Promise<RepertoireTab[]> {
  await assertRepertoireAccess(repertoireId, userId)

  const res = await runTabQuery<RepertoireTab>(
    'list tabs',
    `SELECT id, repertoire_id, title, file_url, created_at::text as created_at
     FROM repertoire_tabs
     WHERE repertoire_id = $1
     ORDER BY created_at DESC`,
    [repertoireId],
    { repertoireId },
  )

  return res.rows
}
