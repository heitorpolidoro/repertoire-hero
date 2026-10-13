'use client'

import type { SongLink } from '@/types/database'
import { pickYoutubeVideoId, youtubeEmbedUrl } from '@/lib/youtubeEmbed'

export const VIDEO_OFFLINE_MESSAGE = 'Video is not available offline'

export interface YoutubeEmbedProps {
  /** The loaded song, or nothing before it has loaded. */
  song?: { links?: SongLink[] } | null
  /** The page's offline signal: video is never in the offline snapshot (RH-163). */
  offline?: boolean
}

/**
 * The song's linked YouTube video (RH-163). Nothing when there is no usable
 * link; offline, the note instead of a frame that could not load. The url has
 * no `autoplay`: playback starts on the user's tap on YouTube's own button.
 */
export function YoutubeEmbed({ song, offline = false }: YoutubeEmbedProps) {
  const videoId = pickYoutubeVideoId(song?.links ?? [])
  if (!videoId) return null

  return (
    <section aria-label="Video" className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Video</h2>
      {offline ? (
        <p
          data-testid="video-offline-state"
          className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
        >
          {VIDEO_OFFLINE_MESSAGE}
        </p>
      ) : (
        <iframe
          src={youtubeEmbedUrl(videoId)}
          title="Song video"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="encrypted-media; picture-in-picture"
          allowFullScreen
          className="w-full aspect-video rounded-xl border border-gray-200"
        />
      )}
    </section>
  )
}
