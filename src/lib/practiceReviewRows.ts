import type { PracticeReviewRow } from '@/hooks/usePracticeReview'
import type { PlaylistSong } from '@/types/database'

/** RH-169: the playlist page's songs as the plain rows the practice review takes. */
export function practiceReviewRows(songs: PlaylistSong[]): PracticeReviewRow[] {
  return songs.map(ps => ({
    versionId: ps.version_id,
    title: ps.song?.title ?? 'song',
    artist: ps.song?.artist ?? null,
  }))
}
