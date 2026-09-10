import type { Playlist } from '@/types/database'

/**
 * RH-70 — the client half of the Spotify playlist sync: the request the browser
 * sends to `src/app/api/spotify/playlists/[id]/sync/route.ts`, the gate that
 * decides whether a local edit is worth pushing, and the two labels the header
 * puts on the result.
 *
 * This module issues nothing and reads nothing: it describes a request and
 * answers questions about a response, which is what lets a `"use client"` file
 * import it. The server half of the same feature is the separate module the
 * route handler runs: that one reaches Postgres, and must never be pulled in
 * from here.
 */

/** Which way a sync runs: `pull` from Spotify, or `push` the local order up. */
type SyncDirection = 'pull' | 'push'

/** The route handler both directions post to. */
export function syncEndpoint(playlistId: string): string {
  return `/api/spotify/playlists/${playlistId}/sync`
}

/** The POST the browser sends, direction and all. */
export function syncRequestInit(direction: SyncDirection): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction }),
  }
}

/**
 * Whether a local add or remove should be mirrored to Spotify. Both fields have
 * to be set: a playlist can be linked without auto-syncing, and auto-sync means
 * nothing without a linked playlist to sync to.
 */
export function shouldAutoPush(
  playlist: Pick<Playlist, 'sync_with_spotify' | 'spotify_playlist_id'> | null,
): boolean {
  return Boolean(playlist?.sync_with_spotify && playlist?.spotify_playlist_id)
}

/**
 * What to report for a response that came back not-ok. The fallback fires for
 * anything that is not a non-empty string, so a body carrying `{ error: '' }`
 * cannot produce an empty error banner.
 */
export function syncErrorMessage(body: unknown, fallback: string): string {
  const reported = (body as { error?: unknown } | null | undefined)?.error
  return typeof reported === 'string' && reported.trim() !== '' ? reported : fallback
}

/** How the header labels `last_synced_at`: `just now`, `Nm`, `Nh` or `Nd ago`. */
export function formatSyncedAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  return `${Math.floor(diffHrs / 24)}d ago`
}
