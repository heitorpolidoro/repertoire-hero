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
 *
 * RH-138: a link correction is per `song_links` row. Its suggestions are stored
 * with `target_table = 'song_links'` and a link id as `target_id`, and its
 * approval (`src/lib/songLinkSuggestions.ts`) writes that one row.
 */
import { randomUUID } from 'crypto'
import { query, withTransaction } from '@/lib/db'
import {
  CATALOG_SUGGESTION_PREFIX,
  parseCatalogSuggestionPayload,
  parseCatalogSuggestionValue,
  type CatalogSuggestionValue,
} from '@/lib/catalogSuggestionPayload'
import { logger } from '@/lib/logger'
import type { SuggestionOutcomeRow } from '@/lib/dbRows'
import {
  ACKNOWLEDGE_SUGGESTION_OUTCOMES_SQL,
  APPROVE_SUGGESTION_GROUP_SQL,
  LINK_SUGGESTION_TARGET_TABLE,
  PENDING_SUGGESTION_GROUPS_SQL,
  UNSEEN_SUGGESTION_OUTCOMES_SQL,
  groupSuggestionOutcomes,
  REJECT_SUGGESTION_GROUP_SQL,
  REJECT_SUGGESTION_ROWS_SQL,
  SUGGESTION_GROUP_SQL,
  SUGGESTION_TARGET_TABLE,
  SUPERSEDE_LINK_SUGGESTIONS_SQL,
  SUPERSEDE_SUGGESTIONS_SQL,
  suggestionInsert,
  type SuggestionEntry,
} from '@/lib/catalogSuggestionSql'
import {
  applyApprovedLinkChanges,
  parseLinkChanges,
  supersededLinkPairs,
  validatedRejectedIds,
  type ApprovedLinkChange,
} from '@/lib/songLinkSuggestions'
import type {
  CatalogSuggestion,
  PendingCatalogSuggestionGroup,
  SuggestionOutcomeGroup,
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

/** What the admin decides besides approve-or-reject (RH-138). */
export interface ReviewOptions {
  /** The rejection reason, recorded on every row this call rejects. */
  reason?: string
  /** Link-row suggestion ids to reject while the rest of the group is approved. */
  rejectLinkSuggestionIds?: readonly string[]
}

/**
 * A link id the submission names must be a row of the song it is filed under:
 * otherwise a requester could queue a change against someone else's link by
 * guessing an id, and the admin's card would show it under the wrong song.
 */
async function assertLinksBelongToSong(songId: string, entries: readonly SuggestionEntry[]) {
  const ids = [...new Set(entries.map((e) => e.targetId))]
  if (ids.length === 0) return
  const res = await query<{ id: string }>(
    'SELECT id FROM song_links WHERE song_id = $1 AND id = ANY($2::uuid[])',
    [songId, ids],
  )
  if (res.rows.length !== ids.length) {
    throw new Error(`${CATALOG_SUGGESTION_PREFIX}: a named link is not a link of this song`)
  }
}

/**
 * Submits one correction as **N rows sharing a `group_id`**, one per proposed
 * `songs` column and one per changed thing on a named link row
 * (`data.linkChanges`), each carrying the submitted `reason`.
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
  // Outside the wrapper (convention L1a): the UI shows these messages verbatim.
  const linkEntries = parseLinkChanges(data.linkChanges)
  const payload = parseCatalogSuggestionPayload(data, linkEntries.length > 0)
  const reason = typeof data.reason === 'string' && data.reason.trim() !== '' ? data.reason : null
  try {
    await assertLinksBelongToSong(songId, linkEntries)
    const columnEntries = Object.entries(payload).map(([column, value]) => ({
      table: SUGGESTION_TARGET_TABLE,
      targetId: songId,
      column,
      value,
    }))
    const insert = suggestionInsert({ groupId: randomUUID(), requestedBy: userId, reason }, [
      ...columnEntries,
      ...linkEntries,
    ])
    const res = await query<CatalogSuggestion>(insert.sql, insert.params)
    return res.rows
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    if (err.message.startsWith(CATALOG_SUGGESTION_PREFIX)) throw err
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
 * RH-111 — what became of the caller's own corrections, per field, until they
 * dismiss it. Scoped by `userId` inside the statement: the session user is the
 * only requester whose rows can be read, so no `checkSystemAdmin` applies and
 * none is wanted.
 */
export async function getUnseenSuggestionOutcomes(
  userId: string,
): Promise<SuggestionOutcomeGroup[]> {
  try {
    const res = await query<SuggestionOutcomeRow>(UNSEEN_SUGGESTION_OUTCOMES_SQL, [userId])
    return groupSuggestionOutcomes(res.rows)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to fetch suggestion outcomes', err, { userId })
    throw new Error(`Failed to fetch suggestion outcomes: ${err.message}`)
  }
}

/**
 * RH-111 — marks exactly the listed outcome rows seen. An id that is not the
 * caller's matches nothing (the statement filters on `requested_by`), and a
 * second call over the same ids changes nothing more. Returns the number of
 * rows acknowledged.
 */
export async function acknowledgeSuggestionOutcomes(
  userId: string,
  ids: readonly string[],
): Promise<number> {
  if (ids.length === 0) return 0
  try {
    const res = await query(ACKNOWLEDGE_SUGGESTION_OUTCOMES_SQL, [userId, [...ids]])
    return res.rowCount ?? 0
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to acknowledge suggestion outcomes', err, { userId })
    throw new Error(`Failed to acknowledge suggestion outcomes: ${err.message}`)
  }
}

/**
 * The approved rows, narrowed and split by what they target. Every stored value
 * is validated here, before the transaction opens, which is what makes an
 * invalid row abort the whole group for free.
 */
function narrowApproved(approved: readonly CatalogSuggestion[]): {
  fields: ApprovedField[]
  songId: string | undefined
  linkChanges: ApprovedLinkChange[]
} {
  const songRows = approved.filter((r) => r.target_table === SUGGESTION_TARGET_TABLE)
  const linkRows = approved.filter((r) => r.target_table === LINK_SUGGESTION_TARGET_TABLE)
  return {
    fields: songRows.map((row) => [
      row.target_column,
      parseCatalogSuggestionValue(row.target_table, row.target_column, row.value),
    ]),
    songId: songRows[0]?.target_id,
    linkChanges: linkRows.map((row) => ({
      linkId: row.target_id,
      column: row.target_column,
      value: parseCatalogSuggestionValue(row.target_table, row.target_column, row.value),
    })),
  }
}

/**
 * Applies the approved rows of a group, flips its rows, and closes the
 * competitors — one `withTransaction` unit, so an invalid field or a colliding
 * link url aborts the whole group and applies nothing.
 *
 * **One `UPDATE songs` per approved group, never one per row.** Each `songs`
 * row contributes one `${col} = $n` clause; link rows contribute none (they
 * write `song_links`, one row each). The timestamp clause is appended **inside
 * the template's interpolation**, so the join supplies the comma: a group with
 * no `songs` column leaves the clause list empty, and `SET ${clauses.join(', ')},
 * updated_at = now()` would render `SET , updated_at = now()` and raise `42601`.
 * The literal stays between the verb and the `WHERE` in the *source text*,
 * which is what `catalogTimestampGuard`'s textual scan requires. A link-only
 * group finds its song through the links it changed; when every link is gone
 * there is no song to bump and no statement is issued.
 *
 * `rejectedIds` are the link rows the admin refused while approving the rest.
 * They are flipped **before** the group approve, which only touches rows still
 * `pending`.
 */
async function applyApprovedGroup(
  adminUserId: string,
  groupId: string,
  pending: readonly CatalogSuggestion[],
  rejected: { ids: readonly string[]; reason: string | null },
): Promise<CatalogSuggestion[]> {
  const rejectedSet = new Set(rejected.ids)
  const { fields, songId: columnSongId, linkChanges } = narrowApproved(
    pending.filter((row) => !rejectedSet.has(row.id)),
  )
  const setClauses: string[] = []
  const values: unknown[] = []
  for (const [column, value] of fields) {
    setClauses.push(`${column} = $${values.length + 1}`)
    values.push(value)
  }

  return await withTransaction(async (client) => {
    const linkSongIds = await applyApprovedLinkChanges(client, linkChanges)
    const songId = columnSongId ?? linkSongIds[0]
    if (songId !== undefined) {
      values.push(songId)
      const updateSongSql = `UPDATE songs SET ${[...setClauses, 'updated_at = now()'].join(', ')} WHERE id = $${values.length}`
      await client.query<never>(updateSongSql, values)
    }

    const refused =
      rejected.ids.length === 0
        ? []
        : (
            await client.query<CatalogSuggestion>(REJECT_SUGGESTION_ROWS_SQL, [
              adminUserId,
              rejected.reason,
              groupId,
              [...rejected.ids],
            ])
          ).rows
    const res = await client.query<CatalogSuggestion>(APPROVE_SUGGESTION_GROUP_SQL, [
      adminUserId,
      groupId,
    ])
    // After the approve, never before: run first it would close the rows being
    // approved along with their competitors.
    if (fields.length > 0) {
      await client.query<never>(SUPERSEDE_SUGGESTIONS_SQL, [
        adminUserId,
        SUGGESTION_TARGET_TABLE,
        columnSongId,
        fields.map(([column]) => column),
      ])
    }
    if (linkChanges.length > 0) {
      const pairs = supersededLinkPairs(linkChanges)
      await client.query<never>(SUPERSEDE_LINK_SUGGESTIONS_SQL, [
        adminUserId,
        pairs.linkIds,
        pairs.columns,
      ])
    }
    return [...res.rows, ...refused]
  })
}

/**
 * Approves or rejects one submitted correction, addressed by its `group_id`.
 *
 * `approve` may name link-row suggestions to reject
 * (`options.rejectLinkSuggestionIds`): those are refused with
 * `options.reason`, the rest of the group is approved.
 *
 * The group is read with **no status filter**, so an already-reviewed group
 * gets its own message rather than looking like a missing one. All refusals —
 * a validation refusal, a missing group and an already-reviewed group —
 * propagate verbatim rather than wrapped (convention L1a), because the UI shows
 * them to the admin as they are.
 */
export async function reviewCatalogSuggestionGroup(
  adminUserId: string,
  groupId: string,
  action: 'approve' | 'reject',
  options: ReviewOptions = {},
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

    const reason = options.reason || null
    if (action === 'reject') {
      const res = await query<CatalogSuggestion>(REJECT_SUGGESTION_GROUP_SQL, [
        adminUserId,
        reason,
        groupId,
      ])
      return res.rows
    }

    const ids = validatedRejectedIds(pending, options.rejectLinkSuggestionIds)
    return await applyApprovedGroup(adminUserId, groupId, pending, { ids, reason })
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
