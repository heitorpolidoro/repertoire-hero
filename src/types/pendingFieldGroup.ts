/**
 * RH-141 — the grouped correction review's read model.
 *
 * Kept beside `database.ts` rather than in it: that file sits at the global
 * `max-lines` of 400, which the complexity ratchet forbids raising.
 */

/** Who proposed a value: the profile id and the name the admin sees. */
export interface PendingFieldRequester {
  id: string;
  name: string;
}

/**
 * One distinct proposed value for a field: identical proposals collapse into
 * this single option, carrying how many there were and who made them.
 */
export interface PendingFieldOption {
  /** The proposed value as stored (jsonb); `null` renders as "(empty)". */
  value: unknown;
  /** How many pending rows proposed exactly this value. */
  count: number;
  requesters: PendingFieldRequester[];
  /** The `catalog_suggestions.id`s behind this option: what Approve names. */
  suggestion_ids: string[];
  /** The distinct submission reasons, when any requester gave one. */
  reasons: string[];
}

/** One contested `(songs row, column)` target and its competing options. */
export interface PendingFieldGroup {
  song_id: string;
  song_title: string;
  song_artist: string;
  target_column: string;
  /** The catalog value now, straight from the `songs` row. */
  current_value: unknown;
  /** Total pending rows across every option. */
  total: number;
  /** Ordered by requester count, highest first. */
  options: PendingFieldOption[];
}

/** What approving one option did: rows approved and rows closed as superseded. */
export interface ApprovedFieldOutcome {
  approved: number;
  superseded: number;
}
