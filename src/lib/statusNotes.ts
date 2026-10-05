/**
 * RH-102 — the pure decisions behind the four-note mastery control.
 *
 * `StatusNotes` draws four quarter notes and the current stage's name: note *i*
 * is filled when the status has reached stage *i*, and a tap on it writes a
 * status directly rather than cycling. Those are decisions about a value, not
 * about rendering, so they live here and the component only paints them.
 *
 * It reads two things from `statusConfig.ts` — the mastery order and the five
 * labels — and no colour: the control is monochrome at every status, so none of
 * `STATUS_CONFIG`'s three per-stage colour fields has a reader here or in
 * `StatusNotes.tsx`.
 */

import { STATUS_CONFIG, STATUS_ORDER } from '@/lib/statusConfig'
import type { SongStatus } from '@/types/database'

/** The four note positions, left to right — one per mastery stage. */
export const NOTE_INDEXES: number[] = STATUS_ORDER.map((_stage, index) => index)

/** How many of the four notes are filled at `status`; `unknown` fills none. */
export function filledNoteCount(status: SongStatus): number {
  return STATUS_ORDER.indexOf(status) + 1
}

/** The mastery stage note `index` stands for. */
export function noteStatus(index: number): SongStatus {
  return STATUS_ORDER[index]
}

/**
 * The status a tap on note `index` produces from `current`.
 *
 * Any note that is not the current status sets its own stage, upwards or
 * downwards alike. The note that *is* the current status drops one stage, which
 * from the first note means `unknown` — the only way back to unassessed, and
 * the reason nothing wraps past `mastered`.
 */
export function statusAfterNoteTap(current: SongStatus, index: number): SongStatus {
  const tapped = noteStatus(index)
  if (tapped !== current) return tapped
  return index === 0 ? 'unknown' : noteStatus(index - 1)
}

/** The stage name shown beside the notes. */
export function statusLabel(status: SongStatus): string {
  return STATUS_CONFIG[status]?.label ?? status
}

/**
 * One note's accessible name, stating the outcome rather than the position —
 * `Set status to Polishing`, `Drop status to Practicing`, `Clear status`.
 */
export function noteTapLabel(current: SongStatus, index: number): string {
  const outcome = statusAfterNoteTap(current, index)
  if (outcome === 'unknown') return 'Clear status'
  const verb = noteStatus(index) === current ? 'Drop' : 'Set'
  return `${verb} status to ${statusLabel(outcome)}`
}
