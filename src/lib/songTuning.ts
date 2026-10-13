/**
 * Pure rules of the Fast View tuning control (RH-146): the preset list, the
 * trim/empty-to-null normalisation, the Toast text and the entry patch.
 *
 * The column stays free `text`; the presets only constrain the input, never the
 * storage. Client-safe: no `@/lib/db`.
 */

import type { ResolvedSongEntry } from '@/types/database'

/** The common tunings the control offers; anything else goes in the custom box. */
export const TUNING_PRESETS: readonly string[] = [
  'Standard',
  'Half step down',
  'Whole step down',
  'Drop D',
  'DADGAD',
  'Open G',
  'Open D',
]

/** Trims the input; empty or whitespace becomes `null`, which clears the override. */
export function normalizeTuning(input: string): string | null {
  const trimmed = input.trim()
  return trimmed === '' ? null : trimmed
}

export function isTuningPreset(value: string | null): boolean {
  return value !== null && TUNING_PRESETS.includes(value)
}

export function tuningSavedMessage(tuning: string | null): string {
  return tuning === null ? 'Tuning cleared' : `Tuning set to ${tuning}`
}

/** A new entry carrying `tuning`; a null entry stays null. */
export function withTuning(
  entry: ResolvedSongEntry | null,
  tuning: string | null,
): ResolvedSongEntry | null {
  return entry ? { ...entry, tuning } : null
}

/**
 * Everything `useSongTuning` exposes. Declared here so the presentational
 * control can type it without importing `src/hooks`.
 */
export interface SongTuningController {
  /** The resolved tuning (owner override, else the version's); null when none. */
  tuning: string | null
  /** A write in flight. */
  updating: boolean
  /** Normalises and writes; an empty input writes `null`. */
  save: (input: string) => Promise<void>
}
