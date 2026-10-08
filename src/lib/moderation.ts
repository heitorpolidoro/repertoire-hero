/**
 * RH-107 — the moderation queue's behaviour: submit, read, review.
 *
 * `catalog_suggestions` is reachable from here and from nowhere else in
 * production. `src/lib/catalogSuggestionSql.ts` holds the statement text (and
 * therefore the table literal) for the same reason `playlistSql.ts` and
 * `songLinksSql.ts` exist, but it is inert: it takes no `userId`, issues
 * nothing and holds no authorization decision. Every gate is here, and
 * `checkSystemAdmin` is the first statement of both reader paths — nothing
 * proposed is visible to anyone but a system admin before it is approved, and
 * no catalog read path joins the queue.
 *
 * The one statement deliberately kept in this file rather than moved out is the
 * approval's `UPDATE songs`: `catalogTimestampGuard` scans production source
 * textually for it, and the decision to write the catalog and the statement
 * that does it belong together.
 */
import { randomUUID } from 'crypto'
import { query, withTransaction, type Queryable } from '@/lib/db'
import {
  CATALOG_SUGGESTION_PREFIX,
  parseCatalogSuggestionPayload,
  parseCatalogSuggestionValue,
  type CatalogSuggestionValue,
} from '@/lib/catalogSuggestionPayload'
import { logger } from '@/lib/logger'
import {
  APPROVE_SUGGESTION_GROUP_SQL,
  PENDING_SUGGESTION_GROUPS_SQL,
  REJECT_SUGGESTION_GROUP_SQL,
  SUGGESTION_GROUP_SQL,
  SUGGESTION_TARGET_TABLE,
  SUPERSEDE_SUGGESTIONS_SQL,
  suggestionInsert,
} from '@/lib/catalogSuggestionSql'
import { dedupeLinksByUrl, songLinkInsertRows } from '@/lib/songLinksSql'
import type {
  CatalogSuggestion,
  PendingCatalogSuggestionGroup,
  SongLink,
} from '@/types/database'

/**
 * The group does not exist. Thrown *and* matched in the catch filter below, so
 * it is a constant rather than two literals: change one copy only and the admin
 * sees `Failed to review a catalog suggestion group: …` on a missing group
 * instead of the message that tells them what actually happened.
 */
const GROUP_NOT_FOUND = 'Catalog suggestion group not found'

/** Every row of the group has already been decided. Same reason it is a constant. */
const GROUP_ALREADY_REVIEWED = 'Catalog suggestion group is already reviewed'

/** One approved column and the normalised value approved for it. */
type ApprovedField = readonly [string, CatalogSuggestionValue]

/**
 * The `links` entry of an approved group, or `undefined` when the group
 * proposes no links at all — which is **not** the same as proposing an empty
 * array, the "remove every link" instruction that has to keep working.
 *
 * A file-local reader rather than two lines inside the apply, because that
 * function is already close to the base `complexity` ceiling of 15 and
 * `eslint.config.mjs`'s override list is shrink-only: a ternary spent there
 * would have nowhere to go.
 *
 * Narrowed by `Array.isArray` rather than by an `as SongLink[]` cast: the
 * allowlist's normaliser does guarantee the shape today, but a cast would
 * survive that guarantee changing and this value is handed straight to a
 * writer.
 */
function approvedLinksOf(fields: readonly ApprovedField[]): SongLink[] | undefined {
  const entry = fields.find(([column]) => column === 'links')?.[1]
  return Array.isArray(entry) ? entry : undefined
}

/**
 * An approved links array, applied to `song_links` as a **replace-set**.
 *
 * An approved correction is authoritative over the whole set, labels and order
 * included, so this is `DELETE` then upsert rather than a fill:
 *
 *  - the `DELETE` runs first, which is what lets a surviving url keep its
 *    `song_links.id`; an approved **empty** array deletes every row, since
 *    `url <> ALL('{}')` holds for all of them;
 *  - the insert's conflict policy re-asserts both the label and the position.
 *    That position clause is the whole reason this writer has authority over
 *    order: a correction that keeps every url and only moves two of them
 *    produces a `DELETE` that removes nothing and an insert that conflicts on
 *    every row, so with `DO UPDATE SET label` alone *nothing at all* is written
 *    and the approved reorder is discarded without an error while the
 *    suggestion's status still flips to `approved`.
 *
 * `dedupeLinksByUrl` is what keeps that `DO UPDATE` off `21000`; the links
 * normaliser admits a duplicated url and does not supply it.
 *
 * **`songs.links` is never written here.** RH-136 took the column out of the
 * catalog write entirely, so an approved `links` suggestion contributes no
 * clause to the statement in {@link applyApprovedGroup} — which still issues
 * that statement, so the group's timestamp bump happens either way.
 */
async function applyApprovedSongLinks(
  client: Queryable,
  songId: string,
  links: SongLink[],
): Promise<void> {
  const deduped = dedupeLinksByUrl(links)
  await client.query<never>(
    'DELETE FROM song_links WHERE song_id = $1 AND url <> ALL($2::text[])',
    [songId, deduped.map((l) => l.url)],
  )
  const rows = songLinkInsertRows(songId, deduped)
  if (rows.count === 0) return
  await client.query<never>(
    `INSERT INTO song_links (song_id, url, label, position)
     VALUES ${rows.values}
     ON CONFLICT (song_id, url) DO UPDATE SET label = EXCLUDED.label, position = EXCLUDED.position`,
    rows.params,
  )
}

/**
 * Submits one correction as **N rows sharing a `group_id`**, one per proposed
 * column, each carrying the submitted `reason`.
 *
 * Validation runs before the INSERT and per column. Keys that are not catalog
 * columns are dropped by the narrower rather than stored: a
 * `target_column = 'reason'` row would put a non-column name where an
 * identifier goes, and the row-wise CHECK would refuse the whole statement.
 */
export async function submitCatalogSuggestion(
  userId: string,
  songId: string,
  data: Record<string, unknown>,
): Promise<CatalogSuggestion[]> {
  // Outside the wrapper (convention L1a): the UI shows this message verbatim.
  const payload = parseCatalogSuggestionPayload(data)
  const reason = typeof data.reason === 'string' && data.reason.trim() !== '' ? data.reason : null
  try {
    const insert = suggestionInsert(
      { groupId: randomUUID(), targetId: songId, requestedBy: userId, reason },
      Object.entries(payload),
    )
    const res = await query<CatalogSuggestion>(insert.sql, insert.params)
    return res.rows
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to submit a catalog suggestion', err, { userId, songId })
    throw new Error(`Failed to submit a catalog suggestion: ${err.message}`)
  }
}

export async function checkSystemAdmin(userId: string): Promise<void> {
  const sql = 'SELECT is_system_admin FROM profiles WHERE id = $1'
  const res = await query<{ is_system_admin: boolean }>(sql, [userId])
  if (res.rowCount === 0 || !res.rows[0]?.is_system_admin) {
    throw new Error('Access denied: User is not a system admin')
  }
}

/**
 * The pending queue, one card per submission. `checkSystemAdmin` is the first
 * statement and the only gate: nothing proposed is visible to anyone else
 * before it is approved.
 */
export async function getPendingCatalogSuggestions(
  adminUserId: string,
): Promise<PendingCatalogSuggestionGroup[]> {
  try {
    await checkSystemAdmin(adminUserId)
    const res = await query<PendingCatalogSuggestionGroup>(PENDING_SUGGESTION_GROUPS_SQL, [])
    return res.rows
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    if (err.message.startsWith('Access denied')) {
      throw err
    }
    logger.error('Failed to fetch pending catalog suggestions', err, { adminUserId })
    throw new Error(`Failed to fetch pending catalog suggestions: ${err.message}`)
  }
}

/**
 * Applies an approved group, flips its rows, and closes the competitors — one
 * `withTransaction` unit, so an invalid field aborts the whole group and
 * applies nothing.
 *
 * **Every row is validated before the transaction opens**, which is what makes
 * that abort free: a stored value the allowlist refuses throws before any
 * statement is issued.
 *
 * **One `UPDATE songs` per approved group, never one per row.** Each
 * non-`links` row contributes one `${col} = $n` clause and a `links` row
 * contributes none, and the collected clauses go into a single statement. The
 * timestamp clause is appended **inside the template's interpolation**, so the
 * join supplies the comma: a group whose only column is `links` leaves the
 * clause list empty, and `SET ${clauses.join(', ')}, updated_at = now()` would
 * render `SET , updated_at = now()` and raise `42601`. The form below renders
 * the bare `UPDATE songs SET updated_at = now() WHERE id = $1` instead, which
 * is valid and still advances the column — and the literal stays between the
 * verb and the `WHERE` in the *source text*, which is what
 * `catalogTimestampGuard`'s textual scan requires.
 *
 * A single-column template (`SET ${col} = $1, updated_at = now()`) could not be
 * instantiated at all for a `links` row: after RH-136 there is no `songs`
 * column for it to name.
 */
async function applyApprovedGroup(
  adminUserId: string,
  groupId: string,
  pending: readonly CatalogSuggestion[],
): Promise<CatalogSuggestion[]> {
  const targetId = pending[0].target_id
  const fields: ApprovedField[] = pending.map((row) => [
    row.target_column,
    parseCatalogSuggestionValue(row.target_table, row.target_column, row.value),
  ])
  const approvedLinks = approvedLinksOf(fields)
  const setClauses: string[] = []
  const values: (string | number | null)[] = []
  for (const [column, value] of fields) {
    if (column === 'links') continue
    setClauses.push(`${column} = $${values.length + 1}`)
    values.push(Array.isArray(value) ? JSON.stringify(value) : value)
  }

  return await withTransaction(async (client) => {
    values.push(targetId)
    const updateSongSql = `UPDATE songs SET ${[...setClauses, 'updated_at = now()'].join(', ')} WHERE id = $${values.length}`
    await client.query<never>(updateSongSql, values)

    // `!== undefined`, not a truthiness test: an **approved empty array** is a
    // real instruction — "remove every link" — and `[]` being truthy in
    // JavaScript is too invisible a thing for that case to depend on.
    if (approvedLinks !== undefined) {
      await applyApprovedSongLinks(client, targetId, approvedLinks)
    }

    const res = await client.query<CatalogSuggestion>(APPROVE_SUGGESTION_GROUP_SQL, [
      adminUserId,
      groupId,
    ])
    // After the approve, never before: run first it would close the rows being
    // approved along with their competitors.
    await client.query<never>(SUPERSEDE_SUGGESTIONS_SQL, [
      adminUserId,
      SUGGESTION_TARGET_TABLE,
      targetId,
      fields.map(([column]) => column),
    ])
    return res.rows
  })
}

/**
 * Approves or rejects one submitted correction, addressed by its `group_id`.
 *
 * The group is read with **no status filter**, so an already-reviewed group
 * gets its own message rather than looking like a missing one. All three
 * refusals — a validation refusal, a missing group and an already-reviewed
 * group — propagate verbatim rather than wrapped (convention L1a), because the
 * UI shows them to the admin as they are.
 */
export async function reviewCatalogSuggestionGroup(
  adminUserId: string,
  groupId: string,
  action: 'approve' | 'reject',
  reason?: string,
): Promise<CatalogSuggestion[]> {
  try {
    await checkSystemAdmin(adminUserId)

    const groupRes = await query<CatalogSuggestion>(SUGGESTION_GROUP_SQL, [groupId])
    if (groupRes.rowCount === 0) {
      throw new Error(GROUP_NOT_FOUND)
    }

    const pending = groupRes.rows.filter((row) => row.status === 'pending')
    if (pending.length === 0) {
      throw new Error(GROUP_ALREADY_REVIEWED)
    }

    if (action === 'reject') {
      const res = await query<CatalogSuggestion>(REJECT_SUGGESTION_GROUP_SQL, [
        adminUserId,
        reason || null,
        groupId,
      ])
      return res.rows
    }

    return await applyApprovedGroup(adminUserId, groupId, pending)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    if (
      err.message.startsWith('Access denied') ||
      err.message.startsWith(CATALOG_SUGGESTION_PREFIX) ||
      err.message === GROUP_NOT_FOUND ||
      err.message === GROUP_ALREADY_REVIEWED
    ) {
      throw err
    }
    logger.error('Failed to review a catalog suggestion group', err, {
      adminUserId,
      groupId,
      action,
    })
    throw new Error(`Failed to review a catalog suggestion group: ${err.message}`)
  }
}
