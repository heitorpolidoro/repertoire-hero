import type { SongStatus } from '@/types/database'

export const STATUS_CONFIG: Record<
  SongStatus,
  { label: string; color: string; bgColor: string; textColor: string }
> = {
  unknown:    { label: 'Unknown',    color: 'gray',   bgColor: 'bg-gray-100',   textColor: 'text-gray-600' },
  learning:   { label: 'Learning',   color: 'blue',   bgColor: 'bg-blue-100',   textColor: 'text-blue-700' },
  practicing: { label: 'Practicing', color: 'yellow', bgColor: 'bg-yellow-100', textColor: 'text-yellow-700' },
  polishing:  { label: 'Polishing',  color: 'orange', bgColor: 'bg-orange-100', textColor: 'text-orange-700' },
  mastered:   { label: 'Mastered',   color: 'green',  bgColor: 'bg-green-100',  textColor: 'text-green-700' },
}

/**
 * The four real mastery stages, in order (RH-102).
 *
 * `unknown` is deliberately outside it: it is the absence of a stage, which the
 * note control draws as zero filled notes and `PlaylistSummary` draws as the
 * part of the track no segment covers. Anything that has to offer the user all
 * five values — the dashboard filter, the `SongForm` picker, the score label
 * mapping — enumerates `ALL_STATUSES` instead.
 */
export const STATUS_ORDER: SongStatus[] = [
  'learning',
  'practicing',
  'polishing',
  'mastered',
]

/** Every status value, `unknown` first — the five-value enumeration. */
export const ALL_STATUSES: SongStatus[] = ['unknown', ...STATUS_ORDER]
