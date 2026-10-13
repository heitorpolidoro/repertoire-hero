/**
 * RH-167 - the setlist player's pure decisions: which source a queue entry
 * plays, which entry comes next, and the texts the bar shows. No browser API,
 * no React, no network: the entry's sources and the Spotify facts are inputs.
 */
import type { SongQueueEntry } from '@/lib/songQueue'
import { decidePlayback, type PlaybackFacts } from '@/lib/spotifyPlayback'
import { spotifyTrackUriFromUrl } from '@/lib/spotifyTrackUri'
import { youtubeVideoId } from '@/lib/youtubeEmbed'

export type SourceKind = 'file' | 'spotify' | 'youtube'

/** What the server knows about one queue entry's own audio, from the caller's rows only. */
export interface QueueSources {
  audio?: { fileUrl: string; title: string }
  spotifyUrl?: string
  youtubeUrl?: string
}

export type PickedSource =
  | { kind: 'file'; url: string }
  | { kind: 'spotify'; trackUri: string }
  | { kind: 'youtube'; videoId: string }

interface PickInputs {
  sources: QueueSources
  offline: boolean
  /** `null` until the playback-token facts arrived (or when they were never asked for). */
  facts: PlaybackFacts | null
}

/**
 * One precedence per song: uploaded audio, then a Spotify track Spotify says
 * is `ready`, then the YouTube video. `null` offline and when nothing plays.
 */
export function pickSource({ sources, offline, facts }: PickInputs): PickedSource | null {
  if (offline) return null
  if (sources.audio) return { kind: 'file', url: sources.audio.fileUrl }

  const trackUri = sources.spotifyUrl ? spotifyTrackUriFromUrl(sources.spotifyUrl) : null
  const decision = decidePlayback({ trackUri, offline, facts })
  if (decision.kind === 'ready') return { kind: 'spotify', trackUri: decision.trackUri }

  const videoId = sources.youtubeUrl ? youtubeVideoId(sources.youtubeUrl) : null
  return videoId ? { kind: 'youtube', videoId } : null
}

/** True when Spotify readiness can matter: a track uri and no uploaded audio. */
export function needsSpotifyFacts(sources: QueueSources): boolean {
  return !sources.audio && !!sources.spotifyUrl && spotifyTrackUriFromUrl(sources.spotifyUrl) !== null
}

/** The neighbouring index in `direction`, or `null` past either end (no wraparound). */
export function stepIndex(index: number, total: number, direction: 1 | -1): number | null {
  const next = index + direction
  return next >= 0 && next < total ? next : null
}

interface AdvanceInputs {
  entries: SongQueueEntry[]
  /** The first index to consider, itself included. */
  from: number
  direction: 1 | -1
  resolve: (entry: SongQueueEntry) => Promise<PickedSource | null>
  /** Called with the title of every entry passed over for lack of a source. */
  onSkip: (title: string) => void
}

/**
 * The first playable entry from `from` in `direction`, resolving one entry at a
 * time. `null` when the queue ends first: it never wraps.
 */
export async function advance({
  entries,
  from,
  direction,
  resolve,
  onSkip,
}: AdvanceInputs): Promise<{ index: number; source: PickedSource } | null> {
  let index: number | null = from >= 0 && from < entries.length ? from : null
  while (index !== null) {
    const source = await resolve(entries[index])
    if (source) return { index, source }
    onSkip(entries[index].title)
    index = stepIndex(index, entries.length, direction)
  }
  return null
}

export const OFFLINE_TEXT = 'Playback is not available offline'
export function skippedText(title: string): string {
  return `Skipped: ${title} (no audio or video)`
}

export function tapToPlayText(title: string): string {
  return `Tap to play ${title}`
}

export function counterText(index: number, total: number): string {
  return `${index + 1} / ${total}`
}
