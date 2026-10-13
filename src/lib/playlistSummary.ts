interface SummarisedPlaylist {
  songs?: Array<{ song?: { duration_seconds?: number | null } }>
}

function clock(secs: number): string {
  const hours = Math.floor(secs / 3600)
  const minutes = Math.floor((secs % 3600) / 60)
  const seconds = String(secs % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

/**
 * "3 songs · 12:05": the count and, when any duration is known, the total.
 * Moved verbatim out of `/bands/[id]` (RH-170, for that page's line budget).
 */
export function playlistSummary(playlist: unknown): string {
  const songs = (playlist as SummarisedPlaylist).songs ?? []
  const count = songs.length
  const secs = songs.reduce((sum, ps) => sum + (ps.song?.duration_seconds ?? 0), 0)
  const dur = secs > 0 ? ` · ${clock(secs)}` : ''
  return `${count} ${count === 1 ? 'song' : 'songs'}${dur}`
}
