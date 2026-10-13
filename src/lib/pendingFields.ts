/**
 * RH-141 — the pure decisions behind the grouped correction review screen:
 * how a field and a value are named, how fields fold into song cards, what the
 * admin is told after a decision. Client-safe (no `@/lib/db`), so the island can
 * import it and a test can reach it without a component.
 */
import type { PendingFieldGroup } from '@/types/pendingFieldGroup'

/**
 * The message a review action throws when every row it named was already
 * decided. One constant shared by the server module that throws it and the
 * island that reads it (it drops the stale field from the screen).
 */
export const FIELD_ALREADY_REVIEWED = 'Catalog suggestion is already reviewed'

const LABEL_OF_COLUMN: Record<string, string> = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  standard_key: 'Key',
  cover_url: 'Cover URL',
  duration_seconds: 'Duration (s)',
}

/** The admin-facing name of a `songs` column; an unknown one is shown as stored. */
export function fieldLabel(column: string): string {
  return Object.hasOwn(LABEL_OF_COLUMN, column) ? LABEL_OF_COLUMN[column] : column
}

/** A stored value as text; `null` (a proposal to clear the field) is "(empty)". */
export function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(empty)'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/** The stable identity of one contested target, for React keys and busy flags. */
export function fieldKey(field: Pick<PendingFieldGroup, 'song_id' | 'target_column'>): string {
  return `${field.song_id}:${field.target_column}`
}

/** One song's card: its contested fields, in the order the read returned them. */
export interface PendingSongCard {
  song_id: string
  title: string
  artist: string
  fields: PendingFieldGroup[]
}

/** Folds the flat field list into one card per song, keeping first-seen order. */
export function groupFieldsBySong(fields: readonly PendingFieldGroup[]): PendingSongCard[] {
  const cards = new Map<string, PendingSongCard>()
  for (const field of fields) {
    const card = cards.get(field.song_id) ?? {
      song_id: field.song_id,
      title: field.song_title,
      artist: field.song_artist,
      fields: [],
    }
    card.fields.push(field)
    cards.set(field.song_id, card)
  }
  return [...cards.values()]
}

/** What the admin reads after approving an option. */
export function approvalNotice(superseded: number): string {
  if (superseded === 0) return 'Approved and applied to the catalog.'
  const noun = superseded === 1 ? 'option' : 'options'
  return `Approved and applied to the catalog. ${superseded} other ${noun} closed (superseded).`
}
