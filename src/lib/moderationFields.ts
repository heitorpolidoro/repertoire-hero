/**
 * RH-141 — the grouped correction review: read the pending `songs` suggestions
 * as `(song, column)` targets with their options, approve one option, reject a
 * whole field.
 *
 * The queue is two-level. The outer level is the target; the inner level is the
 * value, and identical proposals collapse into one option carrying its count
 * and requesters. Approving an option closes every competing option of that
 * column in the same act, so the admin decides a field once, not once per
 * submission.
 *
 * Like `moderation.ts`, every function takes the caller as `adminUserId` and
 * `checkSystemAdmin` is the first statement of each: nothing proposed is
 * visible to, or decidable by, anyone but a system admin. The catalog write is
 * `writeSongColumns` from `moderation.ts` - the single `UPDATE songs` the
 * timestamp guard counts - never a second one.
 *
 * `song_links` corrections (RH-138) are not part of this: they stay decided per
 * link row through `reviewCatalogSuggestionGroup`'s `linksOnly` mode.
 */
import { query, withTransaction, type Queryable } from '@/lib/db'
import { CATALOG_SUGGESTION_PREFIX, parseCatalogSuggestionValue } from '@/lib/catalogSuggestionPayload'
import {
  APPROVE_FIELD_VALUE_SQL,
  PENDING_FIELD_GROUPS_SQL,
  REJECT_FIELD_SQL,
  SUGGESTION_ROWS_FOR_UPDATE_SQL,
} from '@/lib/catalogFieldSql'
import { SUGGESTION_TARGET_TABLE, SUPERSEDE_SUGGESTIONS_SQL } from '@/lib/catalogSuggestionSql'
import { logger } from '@/lib/logger'
import { FIELD_ALREADY_REVIEWED } from '@/lib/pendingFields'
import { checkSystemAdmin, writeSongColumns } from '@/lib/moderation'
import type { CatalogSuggestion } from '@/types/database'
import type { ApprovedFieldOutcome, PendingFieldGroup } from '@/types/pendingFieldGroup'

/** Thrown *and* matched in the catch filters below, so it is one constant. */
const SUGGESTION_NOT_FOUND = 'Catalog suggestion not found'

const REFUSALS = [SUGGESTION_NOT_FOUND, FIELD_ALREADY_REVIEWED]

/** A refusal the UI shows verbatim (convention L1a) rather than a wrapped failure. */
function isRefusal(err: Error): boolean {
  return (
    err.message.startsWith('Access denied') ||
    err.message.startsWith(CATALOG_SUGGESTION_PREFIX) ||
    REFUSALS.includes(err.message)
  )
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * The pending `songs` suggestions grouped by target column and then by value,
 * options ordered by requester count, highest first.
 */
export async function getPendingFieldGroups(adminUserId: string): Promise<PendingFieldGroup[]> {
  try {
    await checkSystemAdmin(adminUserId)
    const res = await query<PendingFieldGroup>(PENDING_FIELD_GROUPS_SQL, [])
    return res.rows
  } catch (error) {
    const err = asError(error)
    if (err.message.startsWith('Access denied')) throw err
    logger.error('Failed to fetch pending field groups', err, { adminUserId })
    throw new Error(`Failed to fetch pending field groups: ${err.message}`)
  }
}

/** One option's rows, locked, checked to be pending and to be one target and one value. */
async function lockOptionRows(
  client: Queryable,
  suggestionIds: readonly string[],
): Promise<CatalogSuggestion[]> {
  const ids = [...new Set(suggestionIds)]
  if (ids.length === 0) {
    throw new Error(`${CATALOG_SUGGESTION_PREFIX}: no suggestion was named`)
  }
  const { rows } = await client.query<CatalogSuggestion>(SUGGESTION_ROWS_FOR_UPDATE_SQL, [ids])
  if (rows.length !== ids.length) throw new Error(SUGGESTION_NOT_FOUND)
  if (rows.some((row) => row.status !== 'pending')) throw new Error(FIELD_ALREADY_REVIEWED)
  const [first] = rows
  const sameOption = rows.every(
    (row) =>
      row.target_table === first.target_table &&
      row.target_id === first.target_id &&
      row.target_column === first.target_column &&
      JSON.stringify(row.value) === JSON.stringify(first.value),
  )
  if (!sameOption) {
    throw new Error(`${CATALOG_SUGGESTION_PREFIX}: the named suggestions are not one option`)
  }
  return rows
}

/**
 * Approves one option: applies its value to the catalog, marks every pending
 * row of that column holding that value `approved`, and closes every other
 * pending row of the column as `superseded` - one `withTransaction` unit, so an
 * invalid value leaves every row `pending` and the catalog untouched.
 *
 * The option is named by its suggestion ids (what the screen holds). Rows of the
 * same value that arrived after the screen loaded are approved with it, which is
 * the point of grouping by value; rows of other columns, even of the same
 * submission, are never touched. The value is validated by
 * `parseCatalogSuggestionValue`, the same narrowing every approval meets.
 */
export async function approveCatalogFieldOption(
  adminUserId: string,
  suggestionIds: readonly string[],
): Promise<ApprovedFieldOutcome> {
  try {
    await checkSystemAdmin(adminUserId)
    return await withTransaction(async (client) => {
      const [anchor] = await lockOptionRows(client, suggestionIds)
      const { target_id: songId, target_column: column } = anchor
      const value = parseCatalogSuggestionValue(SUGGESTION_TARGET_TABLE, column, anchor.value)
      await writeSongColumns(client, songId, [[column, value]])
      const approved = await client.query<never>(APPROVE_FIELD_VALUE_SQL, [
        adminUserId,
        songId,
        column,
        anchor.id,
      ])
      // After the approve, never before: run first it would close the rows being approved.
      const superseded = await client.query<never>(SUPERSEDE_SUGGESTIONS_SQL, [
        adminUserId,
        SUGGESTION_TARGET_TABLE,
        songId,
        [column],
      ])
      return { approved: approved.rowCount ?? 0, superseded: superseded.rowCount ?? 0 }
    })
  } catch (error) {
    const err = asError(error)
    if (isRefusal(err)) throw err
    logger.error('Failed to approve a catalog field option', err, { adminUserId })
    throw new Error(`Failed to approve a catalog field option: ${err.message}`)
  }
}

/**
 * Rejects every pending row of one `(song, column)` target with an optional
 * reason; the catalog is untouched. Returns how many rows were rejected. Nothing
 * pending left means someone already decided the field.
 */
export async function rejectCatalogField(
  adminUserId: string,
  songId: string,
  column: string,
  reason?: string,
): Promise<number> {
  try {
    await checkSystemAdmin(adminUserId)
    const res = await query(REJECT_FIELD_SQL, [adminUserId, reason?.trim() || null, songId, column])
    if (!res.rowCount) throw new Error(FIELD_ALREADY_REVIEWED)
    return res.rowCount
  } catch (error) {
    const err = asError(error)
    if (isRefusal(err)) throw err
    logger.error('Failed to reject a catalog field', err, { adminUserId, songId, column })
    throw new Error(`Failed to reject a catalog field: ${err.message}`)
  }
}
