/**
 * RH-68 — the pure decisions behind the `/playlists/[id]` song list.
 *
 * The playlist detail page used to take all of these inline: the tag set the
 * filter bar renders, the tag + text filter itself, the position sort, the
 * mastery aggregation the summary bar draws, and the optimistic status cycle
 * with its two `new Map(prev)` clones. They are decisions about data, not about
 * rendering, so they live here — no React, no fetch, no `pg` — and the page and
 * the components under `src/components/playlists/` only render what they return.
 */

import { STATUS_ORDER, nextStatus } from '@/lib/statusConfig'
import type { PlaylistSong, Repertoire, SongStatus } from '@/types/database'

/** What each mastery stage is worth when the playlist level is scored. */
export const STATUS_SCORES: Record<SongStatus, number> = {
  unknown: 0,
  learning: 1,
  practicing: 2,
  polishing: 3,
  mastered: 4,
}

/** Every tag the playlist's songs carry, deduplicated and locale-sorted. */
export function collectPlaylistTags(
  songs: PlaylistSong[],
  repertoire: ReadonlyMap<string, Repertoire>,
): string[] {
  const tags = new Set<string>()
  for (const ps of songs) {
    for (const tag of repertoire.get(ps.song_id)?.tags ?? []) tags.add(tag)
  }
  return [...tags].sort((tagA, tagB) => tagA.localeCompare(tagB))
}

/** The two filters the page can apply at once: one tag chip and one text query. */
export interface PlaylistSongFilter {
  tag: string | null
  query: string
}

/**
 * The songs left after the active tag chip and the text query. A blank or
 * whitespace-only query filters nothing, and both filters apply together.
 */
export function filterPlaylistSongs(
  songs: PlaylistSong[],
  repertoire: ReadonlyMap<string, Repertoire>,
  filter: PlaylistSongFilter,
): PlaylistSong[] {
  let result = songs
  if (filter.tag) {
    const tag = filter.tag
    result = result.filter((ps) => repertoire.get(ps.song_id)?.tags.includes(tag))
  }
  const query = filter.query.toLowerCase().trim()
  if (query) {
    result = result.filter((ps) => {
      const title = ps.song?.title?.toLowerCase() ?? ''
      const artist = ps.song?.artist?.toLowerCase() ?? ''
      return title.includes(query) || artist.includes(query)
    })
  }
  return result
}

/** The songs in playlist order, sorted on a copy so the source array is left alone. */
export function sortPlaylistSongs(songs: PlaylistSong[]): PlaylistSong[] {
  return [...songs].sort((songA, songB) => songA.position - songB.position)
}

/** What the summary bar above the list draws. */
export interface PlaylistMasterySummary {
  counts: Record<SongStatus, number>
  totalSeconds: number
  total: number
  score: number
  scoreStatus: SongStatus
}

/** The status label nearest to a 0-100 score. */
function nearestScoreStatus(score: number): SongStatus {
  return STATUS_ORDER[
    Math.min(
      Math.floor((score / 100) * (STATUS_ORDER.length - 1) + 0.5),
      STATUS_ORDER.length - 1,
    )
  ]
}

/**
 * How far along the playlist is: one count per status (a song with no
 * repertoire entry reads as `unknown`), the total playing time, and the 0-100
 * score with the status label nearest to it. An empty playlist reports
 * `total: 0` and scores 0 rather than dividing by zero.
 */
export function summarisePlaylistMastery(
  songs: PlaylistSong[],
  repertoire: ReadonlyMap<string, Repertoire>,
): PlaylistMasterySummary {
  const counts: Record<SongStatus, number> = {
    unknown: 0,
    learning: 0,
    practicing: 0,
    polishing: 0,
    mastered: 0,
  }
  let totalSeconds = 0
  for (const ps of songs) {
    counts[repertoire.get(ps.song_id)?.status ?? 'unknown']++
    totalSeconds += ps.song?.duration_seconds ?? 0
  }
  const total = songs.length
  if (total === 0) {
    return { counts, totalSeconds, total, score: 0, scoreStatus: 'unknown' }
  }
  const earned = STATUS_ORDER.reduce(
    (sum, status) => sum + STATUS_SCORES[status] * counts[status],
    0,
  )
  const score = Math.round((earned / (total * 4)) * 100)
  return { counts, totalSeconds, total, score, scoreStatus: nearestScoreStatus(score) }
}

/**
 * One step of the mastery cycle. `entry` is the entry as it stands now, so the
 * caller can put it back verbatim when the write fails instead of recomputing
 * a status backwards.
 */
export interface SongStatusCycle {
  entry: Repertoire
  status: SongStatus
  updated: Repertoire
}

/** The next status of one playlist song, or `null` when it has no entry to cycle. */
export function cycleSongStatus(
  repertoire: ReadonlyMap<string, Repertoire>,
  songId: string,
): SongStatusCycle | null {
  const entry = repertoire.get(songId)
  if (!entry) return null
  const status = nextStatus(entry.status)
  return { entry, status, updated: { ...entry, status } }
}

/** The repertoire map with one entry replaced, cloned so React sees a new map. */
export function withRepertoireEntry(
  repertoire: ReadonlyMap<string, Repertoire>,
  songId: string,
  entry: Repertoire,
): Map<string, Repertoire> {
  const next = new Map(repertoire)
  next.set(songId, entry)
  return next
}
