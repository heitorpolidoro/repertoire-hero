/**
 * RH-186 - a user's own custom fields and their per-version values.
 *
 * Kept out of `ownerSongs.ts` (400-line budget), and nothing here touches a
 * repertoire table: a value is keyed by `(field, user, version)`, so it can be
 * set on a version nobody holds and setting one never creates a `user_songs` or
 * `band_songs` row. No function takes a band id - band context changes nothing.
 *
 * Every function takes the signed-in user's id first and scopes every statement
 * by it: a field id the user does not own matches zero rows, which is reported
 * as `Custom field not found`. The four user-facing messages are thrown outside
 * the L1 wrapping, so they reach the UI verbatim (L1a).
 */

import { query, withTransaction, type Queryable } from '@/lib/db'
import { logger } from '@/lib/logger'
import {
  CUSTOM_FIELD_DUPLICATE_MESSAGE,
  CUSTOM_FIELD_NOT_FOUND_MESSAGE,
  normalizeCustomFieldName,
  normalizeCustomFieldValue,
} from '@/lib/customFieldRules'
import type { CustomField, CustomFieldEntry } from '@/types/customField'

export type CustomFieldMoveDirection = 'up' | 'down'

const FIELD_COLUMNS = 'id, name, position'

/** Runs `run` under the L1 log-then-wrap; a unique violation is the duplicate-name message (E1). */
async function attempt<T>(verb: string, context: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    // 23505 = unique_violation on (owner_user_id, lower(name)): the user already has that name.
    if ((error as { code?: string }).code === '23505') throw new Error(CUSTOM_FIELD_DUPLICATE_MESSAGE)
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error(`Failed to ${verb}`, err, context)
    throw new Error(`Failed to ${verb}: ${err.message}`)
  }
}

function found<T>(row: T | undefined): T {
  if (row === undefined) throw new Error(CUSTOM_FIELD_NOT_FOUND_MESSAGE)
  return row
}

/** The user's definitions, in their saved order. */
export async function listCustomFields(userId: string): Promise<CustomField[]> {
  const res = await attempt('list custom fields', { userId }, () =>
    query<CustomField>(
      `SELECT ${FIELD_COLUMNS} FROM custom_fields WHERE owner_user_id = $1 ORDER BY position, id`,
      [userId],
    ),
  )
  return res.rows
}

/** Adds a definition after the user's last one. */
export async function createCustomField(userId: string, name: string): Promise<CustomField> {
  const normalized = normalizeCustomFieldName(name)
  const res = await attempt('create custom field', { userId }, () =>
    query<CustomField>(
      `INSERT INTO custom_fields (owner_user_id, name, position)
       SELECT $1, $2, COALESCE(MAX(position), 0) + 1 FROM custom_fields WHERE owner_user_id = $1
       RETURNING ${FIELD_COLUMNS}`,
      [userId, normalized],
    ),
  )
  return res.rows[0]
}

/** Renames one of the user's definitions; a different case of its own name is allowed. */
export async function renameCustomField(userId: string, fieldId: string, name: string): Promise<CustomField> {
  const normalized = normalizeCustomFieldName(name)
  const res = await attempt('rename custom field', { userId, fieldId }, () =>
    query<CustomField>(
      `UPDATE custom_fields SET name = $3 WHERE id = $1 AND owner_user_id = $2 RETURNING ${FIELD_COLUMNS}`,
      [fieldId, userId, normalized],
    ),
  )
  return found(res.rows[0])
}

const NEIGHBOUR_SQL: Record<CustomFieldMoveDirection, string> = {
  up: `SELECT id, position FROM custom_fields
        WHERE owner_user_id = $1 AND (position, id) < ($2, $3)
        ORDER BY position DESC, id DESC LIMIT 1`,
  down: `SELECT id, position FROM custom_fields
          WHERE owner_user_id = $1 AND (position, id) > ($2, $3)
          ORDER BY position, id LIMIT 1`,
}

async function swapWithNeighbour(
  client: Queryable,
  userId: string,
  fieldId: string,
  direction: CustomFieldMoveDirection,
): Promise<boolean> {
  const self = (
    await client.query<{ id: string; position: number }>(
      'SELECT id, position FROM custom_fields WHERE id = $1 AND owner_user_id = $2 FOR UPDATE',
      [fieldId, userId],
    )
  ).rows[0]
  if (!self) return false
  const other = (
    await client.query<{ id: string; position: number }>(NEIGHBOUR_SQL[direction], [userId, self.position, self.id])
  ).rows[0]
  // At either end there is nothing to swap with: a no-op, not an error.
  if (!other) return true
  const swap = 'UPDATE custom_fields SET position = $2 WHERE id = $1 AND owner_user_id = $3'
  await client.query(swap, [self.id, other.position, userId])
  await client.query(swap, [other.id, self.position, userId])
  return true
}

/** Swaps the field with its neighbour of the same owner, in one transaction. */
export async function moveCustomField(
  userId: string,
  fieldId: string,
  direction: CustomFieldMoveDirection,
): Promise<void> {
  const owned = await attempt('move custom field', { userId, fieldId, direction }, () =>
    withTransaction((client) => swapWithNeighbour(client, userId, fieldId, direction)),
  )
  if (!owned) throw new Error(CUSTOM_FIELD_NOT_FOUND_MESSAGE)
}

/** Deletes a definition; the foreign key's cascade removes every value of it. */
export async function deleteCustomField(userId: string, fieldId: string): Promise<void> {
  const res = await attempt('delete custom field', { userId, fieldId }, () =>
    query<{ id: string }>('DELETE FROM custom_fields WHERE id = $1 AND owner_user_id = $2 RETURNING id', [
      fieldId,
      userId,
    ]),
  )
  found(res.rows[0])
}

/** Every definition of the user, in order, each with that user's value on the version or `null`. */
export async function getCustomFieldValues(userId: string, versionId: string): Promise<CustomFieldEntry[]> {
  const res = await attempt('load custom field values', { userId, versionId }, () =>
    query<CustomFieldEntry>(
      `SELECT f.id AS "fieldId", f.name, v.value
         FROM custom_fields f
         LEFT JOIN custom_field_values v
           ON v.field_id = f.id AND v.user_id = $1 AND v.version_id = $2
        WHERE f.owner_user_id = $1
        ORDER BY f.position, f.id`,
      [userId, versionId],
    ),
  )
  return res.rows
}

// Written only through the user's own definition: a field id they do not own selects nothing.
const UPSERT_VALUE_SQL = `
  INSERT INTO custom_field_values (field_id, user_id, version_id, value)
  SELECT f.id, $2, $3, $4 FROM custom_fields f WHERE f.id = $1 AND f.owner_user_id = $2
  ON CONFLICT (field_id, user_id, version_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  RETURNING value
`

// Ownership is checked before the delete: a delete matching nothing cannot tell
// "no value yet" from "not your field", so the answer is the owned-field count.
const CLEAR_VALUE_SQL = `
  WITH owned AS (SELECT id FROM custom_fields WHERE id = $1 AND owner_user_id = $2),
       cleared AS (
         DELETE FROM custom_field_values v USING owned
          WHERE v.field_id = owned.id AND v.user_id = $2 AND v.version_id = $3
       )
  SELECT id FROM owned
`

/**
 * Stores the user's value for one field on one version, or deletes it when the
 * trimmed value is blank. Answers the stored value, `null` after a clear.
 */
export async function setCustomFieldValue(
  userId: string,
  fieldId: string,
  versionId: string,
  value: string,
): Promise<string | null> {
  const normalized = normalizeCustomFieldValue(value)
  const context = { userId, fieldId, versionId }
  if (normalized === null) {
    const res = await attempt('clear custom field value', context, () =>
      query<{ id: string }>(CLEAR_VALUE_SQL, [fieldId, userId, versionId]),
    )
    found(res.rows[0])
    return null
  }
  const res = await attempt('save custom field value', context, () =>
    query<{ value: string }>(UPSERT_VALUE_SQL, [fieldId, userId, versionId, normalized]),
  )
  return found(res.rows[0]).value
}
