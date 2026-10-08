/**
 * RH-107 — the moderation queue's statements, kept out of the behaviour module.
 *
 * A plain library module, with no server-action directive at the top and not
 * under `src/app/actions/`. Files there publish every export as a Server
 * Action, so a helper taking a caller-supplied `userId` would become a callable
 * endpoint that never passes `getRequiredUserId`. `suggestionInsert` does take
 * a `requestedBy` — a user id under another name — but it only binds it as a
 * parameter: nothing here issues a statement, and nothing here holds an
 * authorization decision, so there is no check for a caller to skip.
 * `src/lib/moderation.ts` owns `checkSystemAdmin` and every call.
 *
 * It exists for the same reason `playlistSql.ts` and `songLinksSql.ts` do: the
 * grouped projection is long enough that leaving it inline pushes
 * `moderation.ts` at its 400-line budget, and the budget's override list is
 * shrink-only, so extraction is the remedy rather than a new ceiling.
 *
 * **The one statement deliberately not here is `UPDATE songs`.**
 * `catalogTimestampGuard` counts catalog writers across production source and
 * scans each one textually for `updated_at = now()`; keeping the catalog write
 * in the module that decides to make it keeps that guard reading the decision
 * and the statement in one place.
 */

import { songLinksJson } from '@/lib/songLinksSql'

/**
 * The only target table the allowlist admits, as a SQL literal.
 *
 * Spelled once, here, rather than threaded through as a bind parameter: it is
 * this module's own constant, not a caller's input, and the row-wise CHECK in
 * `migrations/0021_catalog_suggestions.sql` admits no other value anyway.
 */
export const SUGGESTION_TARGET_TABLE = 'songs'

/**
 * The pending queue, projected back into **one row per `group_id`** — the card
 * the admin reviews.
 *
 * The table is per-column and the queue is per-group, and this is where the two
 * meet: `jsonb_object_agg(target_column, value)` rebuilds the
 * `proposed_data`-shaped object the diff component already renders, and
 * `jsonb_object_agg(target_column, id)` carries the per-field suggestion ids
 * RH-111 needs to tell a requester what happened to each field.
 *
 * **Only `pending` rows are aggregated**, so a partially reviewed group shows
 * only what is left to decide. (The *review* path is the opposite and reads its
 * group with no status filter, so an already-reviewed group gets its own
 * message instead of looking like a missing one.)
 *
 * `requested_by` is grouped on rather than aggregated: one submission is one
 * requester. `reason` and `created_at` are aggregated with `min` so that a
 * group whose rows somehow disagree still renders as one card instead of
 * splitting into two.
 */
export const PENDING_SUGGESTION_GROUPS_SQL = `
  SELECT g.group_id,
         g.song_id,
         g.proposed_data,
         g.suggestion_ids,
         g.reason,
         g.requested_by,
         g.created_at,
         json_build_object(
           'id', s.id,
           'title', s.title,
           'artist', s.artist,
           'album', s.album,
           'standard_key', s.standard_key,
           'cover_url', s.cover_url,
           'duration_seconds', s.duration_seconds,
           'links', ${songLinksJson('s')},
           'created_at', s.created_at
         ) as song,
         json_build_object(
           'id', p.id,
           'email', p.email,
           'full_name', p.full_name,
           'avatar_url', p.avatar_url,
           'instruments', p.instruments,
           'primary_instrument', p.primary_instrument,
           'is_system_admin', p.is_system_admin
         ) as requester
    FROM (
          SELECT c.group_id,
                 c.target_id AS song_id,
                 c.requested_by,
                 jsonb_object_agg(c.target_column, c.value) AS proposed_data,
                 jsonb_object_agg(c.target_column, c.id) AS suggestion_ids,
                 min(c.reason) AS reason,
                 min(c.created_at) AS created_at
            FROM catalog_suggestions c
           WHERE c.status = 'pending'
             AND c.target_table = '${SUGGESTION_TARGET_TABLE}'
           GROUP BY c.group_id, c.target_id, c.requested_by
         ) g
    JOIN songs s ON g.song_id = s.id
    JOIN profiles p ON g.requested_by = p.id
   ORDER BY g.created_at ASC
`

/**
 * One group's rows, **with no status filter**, which is the review path's read.
 *
 * The tempting simplification — read only `pending` rows, so an
 * already-reviewed group falls through as not-found — is refused: it collapses
 * two answers an admin needs to tell apart ("someone already handled this"
 * versus "this group does not exist") and would pass every behavioural test
 * that only checks the not-found case.
 */
export const SUGGESTION_GROUP_SQL = `
  SELECT * FROM catalog_suggestions
   WHERE group_id = $1
   ORDER BY created_at ASC, target_column ASC
`

/** Flips every still-pending row of one group to `approved`. */
export const APPROVE_SUGGESTION_GROUP_SQL = `
  UPDATE catalog_suggestions
     SET status = 'approved', reviewed_by = $1, updated_at = now()
   WHERE group_id = $2 AND status = 'pending'
   RETURNING *
`

/** Records the rejection on every still-pending row of one group. */
export const REJECT_SUGGESTION_GROUP_SQL = `
  UPDATE catalog_suggestions
     SET status = 'rejected', reviewed_by = $1, rejection_reason = $2, updated_at = now()
   WHERE group_id = $3 AND status = 'pending'
   RETURNING *
`

/**
 * Closes the competing suggestions for the columns just approved.
 *
 * **Must run after the approve, not before**: run first it would close the very
 * rows being approved, since they are `pending` and name the same columns.
 *
 * **Carries no `group_id <> …` term, deliberately.** Supersession keys on the
 * target column, not on the submission, so another group proposing the *same*
 * column is closed while another group proposing a *different* column is left
 * alone. `superseded` rather than `rejected`, and with no `rejection_reason`:
 * RH-111 has to tell the requester which of the two happened, and nobody
 * refused their value.
 */
export const SUPERSEDE_SUGGESTIONS_SQL = `
  UPDATE catalog_suggestions
     SET status = 'superseded', reviewed_by = $1, updated_at = now()
   WHERE target_table = $2
     AND target_id = $3
     AND target_column = ANY($4::text[])
     AND status = 'pending'
`

/** A fan-out INSERT: its statement text and the parameters it binds. */
export interface SuggestionInsert {
  sql: string
  params: unknown[]
}

/**
 * The submit fan-out: **one statement**, one row per proposed column, every row
 * sharing the submission's `group_id` and `reason`.
 *
 * Pure — it shapes text and parameters and issues nothing. `target_column` is
 * bound as a parameter here rather than interpolated, because on this path it
 * is only ever a key of the allowlist the caller has already consulted; the
 * place a column name becomes an *identifier* is the approval's `UPDATE`, and
 * `parseCatalogSuggestionValue` guards that.
 */
export function suggestionInsert(
  submission: {
    groupId: string
    targetId: string
    requestedBy: string
    reason: string | null
  },
  entries: ReadonlyArray<readonly [string, unknown]>,
): SuggestionInsert {
  const params: unknown[] = [
    submission.groupId,
    submission.targetId,
    submission.requestedBy,
    submission.reason,
  ]
  const tuples = entries.map(([column, value]) => {
    params.push(column, JSON.stringify(value === undefined ? null : value))
    const columnPlaceholder = params.length - 1
    return `($1, '${SUGGESTION_TARGET_TABLE}', $2, $${columnPlaceholder}, $${params.length}::jsonb, $4, $3, 'pending')`
  })
  return {
    sql: `
      INSERT INTO catalog_suggestions
        (group_id, target_table, target_id, target_column, value, reason, requested_by, status)
      VALUES ${tuples.join(', ')}
      RETURNING *
    `,
    params,
  }
}
