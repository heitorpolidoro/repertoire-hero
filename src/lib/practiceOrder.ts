/**
 * RH-168 - the order a practice session walks the songs in.
 *
 * `docs/use-cases.md` § *Start a practice session* decides it; this module is
 * only its implementation. A song's urgency is
 * `days since last practised / the interval for its level`, capped at
 * `MAX_DUE_RATIO`, highest first.
 *
 * - **Unassessed is always due.** `unknown` and an absent owner row (`status`
 *   `null`) have no interval; a song never practised (`lastPracticed` null) has
 *   no days. Both rank above every finite ratio and form one tie group.
 * - **Days are whole calendar days** in `PRACTICE_TIME_ZONE` (RH-182): the
 *   dates of `now` and of the last practice, read there, subtracted. The hour
 *   does not count, so songs at one level practised on one local date tie
 *   exactly, as does the always-due group.
 * - **Only exact ties are shuffled**, uniformly (Fisher-Yates per group)
 *   through an injected `random`. Near-ties (7 days against 8) keep ratio order.
 *
 * Pure and client safe: no I/O, no clock read other than the injectable `now`.
 */

import type { SongStatus } from '@/types/database'

/** Days between two practices of a song at each level; `null` is always due. */
export const PRACTICE_INTERVAL_DAYS: Record<SongStatus, number | null> = {
  unknown: null,
  learning: 1,
  practicing: 3,
  polishing: 14,
  mastered: 21,
}

/**
 * RH-177 - the urgency ceiling: twice overdue is as urgent as it gets. Without
 * it a learning song (1-day interval) scores ~7 after a weekly gap and always
 * leads. Every song at the ceiling ties exactly and is shuffled together.
 */
export const MAX_DUE_RATIO = 2

/** RH-182 - the zone a practice date is read in; the boundary is its midnight. */
export const PRACTICE_TIME_ZONE = 'America/Sao_Paulo'

const DAY_MS = 86_400_000

// en-CA formats as YYYY-MM-DD.
const localDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: PRACTICE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The local calendar date of an instant, as a day number since the epoch. */
function dayNumber(instant: number): number {
  return Date.parse(`${localDate.format(instant)}T00:00:00Z`) / DAY_MS
}

/** What the ordering needs of a song; extra fields travel through untouched. */
export interface PracticeCandidate {
  versionId: string
  title: string
  artist: string | null
  /** `null` when the owner holds no row for the version. */
  status: SongStatus | null
  /** ISO instant, or `null` when never practised. */
  lastPracticed: string | null
}

export interface PracticeOrderOptions {
  /** The instant "now" is measured at (ms since epoch or a Date). */
  now?: number | Date
  /** A uniform source in [0, 1). Defaults to `Math.random`. */
  random?: () => number
}

/** The urgency ratio; `Infinity` for always-due and never-practised songs. */
function dueRatio(song: PracticeCandidate, now: number): number {
  const interval = song.status === null ? null : PRACTICE_INTERVAL_DAYS[song.status]
  if (interval === null || song.lastPracticed === null) return Infinity
  const last = Date.parse(song.lastPracticed)
  if (Number.isNaN(last)) return Infinity
  return Math.min((dayNumber(now) - dayNumber(last)) / interval, MAX_DUE_RATIO)
}

/** In-place uniform shuffle. */
function shuffle<T>(items: T[], random: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const held = items[i]
    items[i] = items[j]
    items[j] = held
  }
}

/** A new list in due order. The input is not mutated. */
export function orderForPractice<T extends PracticeCandidate>(
  songs: readonly T[],
  options: PracticeOrderOptions = {},
): T[] {
  const now = options.now === undefined ? Date.now() : Number(options.now)
  const random = options.random ?? Math.random

  const ranked = songs.map((song) => ({ song, ratio: dueRatio(song, now) }))
  ranked.sort((a, b) => (a.ratio === b.ratio ? 0 : a.ratio > b.ratio ? -1 : 1))

  const result: T[] = []
  let start = 0
  while (start < ranked.length) {
    let end = start + 1
    while (end < ranked.length && ranked[end].ratio === ranked[start].ratio) end++
    const group = ranked.slice(start, end).map((entry) => entry.song)
    shuffle(group, random)
    result.push(...group)
    start = end
  }
  return result
}
