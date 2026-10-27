/**
 * Pure rules of the Fast View tuning control (RH-146, RH-185): the 8 half-step
 * positions relative to E standard, the Drop option, canonical text
 * parse/format, display labels and 6-string reference lines, the
 * trim/empty-to-null normalisation, the Toast text and the entry patch.
 *
 * The column stays free `text` in canonical form (`E`, `Eb`, `Drop D`, `Drop Db`);
 * the offset suffix and reference line are worked out on display and never stored.
 * Client-safe: no `@/lib/db`.
 */

import type { ResolvedSongEntry } from '@/types/database'

const NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const
/** E A D G B E as indexes into `NOTES`. */
const STANDARD_STRINGS = [4, 9, 2, 7, 11, 4] as const

/** The 8 half-step offsets relative to E standard (+1 down to -6), in display order. */
export const TUNING_OFFSETS = [1, 0, -1, -2, -3, -4, -5, -6] as const

export type TuningOffset = (typeof TUNING_OFFSETS)[number]

export interface CanonicalTuning {
  offset: TuningOffset
  drop: boolean
}

function noteAt(index: number): string {
  return NOTES[((index % 12) + 12) % 12]
}

function stringNotes(offset: TuningOffset, drop: boolean): string[] {
  return STANDARD_STRINGS.map((base, idx) => noteAt(base + offset - (drop && idx === 0 ? 2 : 0)))
}

/** Builds the stored canonical value (`E`, `Eb`, `Drop D`, `Drop Db`) from `(offset, drop)`. */
export function canonicalTuning(offset: TuningOffset, drop: boolean): string {
  const sixth = stringNotes(offset, drop)[0]
  return drop ? `Drop ${sixth}` : sixth
}

/**
 * Parses a stored value into `(offset, drop)`, or returns `null` when it is custom
 * or absent. Only an exact match of one of the 16 canonical values counts.
 */
export function parseCanonicalTuning(value: string | null): CanonicalTuning | null {
  if (value === null) return null
  for (const drop of [false, true]) {
    for (const offset of TUNING_OFFSETS) {
      if (canonicalTuning(offset, drop) === value) return { offset, drop }
    }
  }
  return null
}

/** Renders the position label with the offset in tones (`Eb (-0.5)`, `Drop Db (-0.5)`, `E`, `Drop D`). */
export function tuningPositionLabel(offset: TuningOffset, drop: boolean): string {
  const base = canonicalTuning(offset, drop)
  if (offset === 0) return base
  const tones = offset / 2
  const sign = tones > 0 ? '+' : ''
  return `${base} (${sign}${tones})`
}

/** Renders the 6-string reference line from low to high (`Eb Ab Db Gb Bb Eb`). */
export function tuningReferenceStrings(offset: TuningOffset, drop: boolean): string {
  return stringNotes(offset, drop).join(' ')
}

/** Renders the label with offset for a canonical value, or the raw text as stored for a custom one. */
export function formatTuningDisplay(value: string): string {
  const parsed = parseCanonicalTuning(value)
  return parsed ? tuningPositionLabel(parsed.offset, parsed.drop) : value
}

/** Trims the input; empty or whitespace becomes `null`, which clears the override. */
export function normalizeTuning(input: string): string | null {
  const trimmed = input.trim()
  return trimmed === '' ? null : trimmed
}

export function tuningSavedMessage(tuning: string | null): string {
  return tuning === null ? 'Tuning cleared' : `Tuning set to ${formatTuningDisplay(tuning)}`
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

