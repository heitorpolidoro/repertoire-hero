import type { Repertoire, SongStatus } from '@/types/database'

/**
 * Pure function that filters a song list by search query, status, and tags.
 * Extracted here so it can be tested independently from the Zustand store.
 */
export function filterSongs(
  songs: Repertoire[],
  query: string,
  status: SongStatus | null,
  tags: string[],
): Repertoire[] {
  const normalizedQuery = query.trim().toLowerCase()

  return songs.filter((entry) => {
    // Search filter — matches title or artist (case-insensitive)
    if (normalizedQuery) {
      const title = entry.song?.title.toLowerCase() ?? ''
      const artist = entry.song?.artist.toLowerCase() ?? ''
      if (!title.includes(normalizedQuery) && !artist.includes(normalizedQuery)) {
        return false
      }
    }

    // Status filter
    if (status !== null && entry.status !== status) {
      return false
    }

    // Tag filter — all selected tags must be present
    if (tags.length > 0) {
      const hasTags = tags.every((tag) => entry.tags.includes(tag))
      if (!hasTags) return false
    }

    return true
  })
}
