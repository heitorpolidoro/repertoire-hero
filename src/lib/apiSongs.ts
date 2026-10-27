/**
 * RH-187: Data access and pure filtering for /api/v1 song endpoints.
 */
import { query } from '@/lib/db'
import type { Repertoire, SongStatus } from '@/types/database'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ApiSongSummary {
  versionId: string
  songId: string
  title: string
  artist: string | null
  versionLabel: string | null
  status: SongStatus
  tuning: string | null
}

export interface ApiSongDetail {
  versionId: string
  songId: string
  title: string
  artist: string | null
  inRepertoire: boolean
  status: SongStatus | null
  key: string | null
  tuning: string | null
  customFields: Array<{ name: string; value: string | null }>
}

/**
 * Checks if versionId is a UUID and finds the song_versions row.
 * Returns { versionId, songId } or null if absent/invalid UUID.
 */
export async function findSongVersion(
  versionId: string,
): Promise<{ versionId: string; songId: string } | null> {
  if (!UUID_PATTERN.test(versionId)) {
    return null
  }

  const result = await query<{ versionId: string; songId: string }>(
    'SELECT id AS "versionId", song_id AS "songId" FROM song_versions WHERE id = $1',
    [versionId],
  )
  if (result.rows.length === 0) return null
  return result.rows[0]
}

/**
 * Filters personal repertoire case-insensitively on title or artist, capped at 50.
 */
export function filterApiRepertoire(items: Repertoire[], q?: string | null): ApiSongSummary[] {
  const queryText = q?.trim().toLowerCase()

  const filtered = queryText
    ? items.filter((item) => {
        const title = item.song?.title?.toLowerCase() ?? ''
        const artist = item.song?.artist?.toLowerCase() ?? ''
        return title.includes(queryText) || artist.includes(queryText)
      })
    : items

  return filtered.slice(0, 50).map((item) => ({
    versionId: item.version_id,
    songId: item.song_id,
    title: item.song?.title ?? '',
    artist: item.song?.artist ?? null,
    versionLabel: item.version_label ?? null,
    status: item.status,
    tuning: item.tuning ?? null,
  }))
}
