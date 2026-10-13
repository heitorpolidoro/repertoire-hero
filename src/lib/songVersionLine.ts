import type { SearchVersionCandidate } from '@/lib/songSearchMerge'

/** `m:ss` from a whole number of seconds (`257` -> `4:17`). */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const rest = whole % 60
  return `${Math.floor(whole / 60)}:${rest < 10 ? '0' : ''}${rest}`
}

/** A release date is `YYYY-MM-DD`, `YYYY-MM` or `YYYY`: the year is its first four characters. */
export function versionYear(releaseDate: string | null): string | null {
  return releaseDate ? releaseDate.slice(0, 4) : null
}

/**
 * The main line of one version: album, year, duration joined by ` · `, missing
 * parts omitted with their separator; null when all three are missing.
 */
export function versionLineText(candidate: SearchVersionCandidate): string | null {
  const parts = [
    candidate.albumName,
    versionYear(candidate.releaseDate),
    candidate.durationSeconds === null ? null : formatDuration(candidate.durationSeconds),
  ].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(' · ') : null
}
