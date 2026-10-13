/**
 * RH-141 — the statements of the grouped correction review: one read that
 * collapses identical proposals into options, and the approve / reject
 * statements that act on a whole `(song, column)` target.
 *
 * Inert, like `catalogSuggestionSql.ts`: it issues nothing and holds no
 * authorization decision. `src/lib/moderationFields.ts` owns every call and the
 * `checkSystemAdmin` gate in front of it.
 */

import { SUGGESTION_TARGET_TABLE } from '@/lib/catalogSuggestionSql'

/**
 * The grouped review read: one row per `(song, column)` having a pending
 * `songs` suggestion, with its options as a json array.
 *
 * Values are compared as jsonb in the `GROUP BY`, so `"G"` from five people is
 * one option. A proposed `null` is a jsonb `null`, its own option. Options are
 * ordered by requester count, then by who asked first, so the order is stable.
 * The inner join to `songs` hides orphans; the left join to `profiles` keeps a
 * row whose requester profile is gone (named "Unknown requester").
 */
export const PENDING_FIELD_GROUPS_SQL = `
  WITH pending AS (
    SELECT cs.id, cs.target_id AS song_id, cs.target_column, cs.value, cs.reason,
           cs.created_at, cs.requested_by,
           to_jsonb(s) -> cs.target_column AS current_value,
           COALESCE(NULLIF(btrim(p.full_name), ''), p.email, 'Unknown requester') AS requester_name
      FROM catalog_suggestions cs
      JOIN songs s ON s.id = cs.target_id
      LEFT JOIN profiles p ON p.id = cs.requested_by
     WHERE cs.status = 'pending' AND cs.target_table = '${SUGGESTION_TARGET_TABLE}'
  ), options AS (
    SELECT song_id, target_column, current_value, value,
           count(*)::int AS count,
           min(created_at) AS first_at,
           array_agg(id::text ORDER BY created_at, id) AS suggestion_ids,
           json_agg(json_build_object('id', requested_by, 'name', requester_name)
                    ORDER BY created_at, id) AS requesters,
           COALESCE(array_agg(DISTINCT reason) FILTER (WHERE reason IS NOT NULL), '{}') AS reasons
      FROM pending
     GROUP BY song_id, target_column, current_value, value
  )
  SELECT o.song_id,
         s.title AS song_title,
         s.artist AS song_artist,
         o.target_column,
         o.current_value,
         sum(o.count)::int AS total,
         json_agg(json_build_object(
                    'value', o.value,
                    'count', o.count,
                    'requesters', o.requesters,
                    'suggestion_ids', o.suggestion_ids,
                    'reasons', o.reasons
                  ) ORDER BY o.count DESC, o.first_at ASC) AS options
    FROM options o
    JOIN songs s ON s.id = o.song_id
   GROUP BY o.song_id, s.title, s.artist, o.target_column, o.current_value
   ORDER BY min(o.first_at) ASC, o.song_id, o.target_column
`

/**
 * The rows named by an Approve, locked for the transaction. **No status
 * filter**: an already-decided row must come back so the caller can say
 * "already reviewed" instead of "not found".
 */
export const SUGGESTION_ROWS_FOR_UPDATE_SQL = `
  SELECT * FROM catalog_suggestions WHERE id = ANY($1::uuid[]) ORDER BY created_at, id FOR UPDATE
`

/**
 * Approves every pending row of one target column that holds the same value as
 * the row `$4` names. `IS NOT DISTINCT FROM` and a subselect rather than a
 * bound literal, so the comparison is jsonb-to-jsonb with no JSON round trip
 * through JavaScript.
 */
export const APPROVE_FIELD_VALUE_SQL = `
  UPDATE catalog_suggestions
     SET status = 'approved', reviewed_by = $1, updated_at = now()
   WHERE target_table = '${SUGGESTION_TARGET_TABLE}'
     AND target_id = $2
     AND target_column = $3
     AND status = 'pending'
     AND value IS NOT DISTINCT FROM (SELECT value FROM catalog_suggestions WHERE id = $4)
`

/** Rejects every pending row of one target column, whatever its value. */
export const REJECT_FIELD_SQL = `
  UPDATE catalog_suggestions
     SET status = 'rejected', reviewed_by = $1, rejection_reason = $2, updated_at = now()
   WHERE target_table = '${SUGGESTION_TARGET_TABLE}'
     AND target_id = $3
     AND target_column = $4
     AND status = 'pending'
`
