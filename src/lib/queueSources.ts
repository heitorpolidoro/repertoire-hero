/**
 * RH-167 - the sources behind one queue entry, read from the caller's own rows.
 *
 * Uploaded audio is owned by the reader alone (RH-162): the query is keyed on
 * `user_id`, so another user's audio on the same song can never come back. The
 * Spotify and YouTube links belong to the song and are the same for everyone.
 * Which source plays is decided elsewhere (`pickSource`); this only reads.
 */
import { query } from '@/lib/db'
import type { QueueSources } from '@/lib/setlistPlayer'
import { spotifyTrackUriFromUrl } from '@/lib/spotifyTrackUri'

interface AudioRow {
  file_url: string
  title: string
}
interface LinkRow {
  url: string
  provider: string
}

export async function resolveVersionSources(userId: string, versionId: string): Promise<QueueSources> {
  const audio = await query<AudioRow>(
    `SELECT sf.file_url, sf.title
       FROM song_files sf
       JOIN song_versions sv ON sv.song_id = sf.song_id
      WHERE sv.id = $1 AND sf.user_id = $2 AND sf.content_type LIKE 'audio/%'
      ORDER BY sf.created_at DESC, sf.id DESC
      LIMIT 1`,
    [versionId, userId],
  )
  const links = await query<LinkRow>(
    `SELECT sl.url, sl.provider
       FROM song_links sl
       JOIN song_versions sv ON sv.song_id = sl.song_id
      WHERE sv.id = $1 AND sl.provider IN ('spotify', 'youtube')
      ORDER BY sl.position, sl.created_at, sl.id`,
    [versionId],
  )

  const sources: QueueSources = {}
  if (audio.rows[0]) sources.audio = { fileUrl: audio.rows[0].file_url, title: audio.rows[0].title }
  // The first Spotify link that names a track: a short link has no uri and is no source.
  const spotify = links.rows.find((l) => l.provider === 'spotify' && spotifyTrackUriFromUrl(l.url))
  if (spotify) sources.spotifyUrl = spotify.url
  const youtube = links.rows.find((l) => l.provider === 'youtube')
  if (youtube) sources.youtubeUrl = youtube.url
  return sources
}
