import { useCallback, useState } from 'react'
import {
  shouldAutoPush,
  syncEndpoint,
  syncErrorMessage,
  syncRequestInit,
} from '@/lib/playlistSync'
import type { Playlist } from '@/types/database'

/**
 * What the controller needs from the page. `onError` and `onSynced` are bound
 * closures — the page's error banner and its playlist reload — which is why
 * this hook imports no Server Action and needs no injected actions bundle: the
 * sync itself is a POST to a route handler, not a Server Action.
 */
export interface SpotifySyncOptions {
  playlistId: string
  /** The loaded row, or `null` while it loads. Only the two sync fields are read. */
  playlist: Pick<Playlist, 'sync_with_spotify' | 'spotify_playlist_id'> | null
  /** The page's error banner; `null` clears it, which is how a pull starts. */
  onError: (message: string | null) => void
  /** Reloads the playlist after a successful pull rewrote it server-side. */
  onSynced: () => Promise<void>
}

/**
 * Commands only, no setter: the Sync button reads `syncing` and calls `pull`,
 * and the two local edit paths call `pushIfNeeded`.
 */
export interface SpotifySyncController {
  /** True only while a pull is in flight — a push never sets it. */
  syncing: boolean
  /** The Sync button: pull from Spotify, reload, and report a failure. */
  pull: () => Promise<void>
  /** Mirror a local edit up to Spotify, when the playlist auto-syncs. */
  pushIfNeeded: () => Promise<void>
}

/**
 * What a not-ok response describes, ready to throw. Both directions read the
 * failure the same way and differ only in what they say when the body says
 * nothing — a body that is not JSON at all reads as an empty one.
 */
async function syncFailure(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => ({}))
  return new Error(syncErrorMessage(body, fallback))
}

/**
 * RH-70 — the Spotify sync of `/playlists/[id]`, as one controller.
 *
 * The two directions are deliberately asymmetric, exactly as the page had them:
 *
 * - `pull` owns the `syncing` window, clears the banner on entry, reloads the
 *   playlist on success and **settles** on failure, reporting through
 *   `onError`.
 * - `pushIfNeeded` touches neither `syncing` nor the banner and **rejects** on
 *   failure, so its caller can attribute the failure — the picker records it
 *   against the row it was adding, `handleRemoveSong` puts it in the banner.
 *   Reporting it here would silently change both.
 */
export function useSpotifySync({
  playlistId,
  playlist,
  onError,
  onSynced,
}: SpotifySyncOptions): SpotifySyncController {
  const [syncing, setSyncing] = useState(false)
  const autoPushes = shouldAutoPush(playlist)

  const pull = useCallback(async () => {
    setSyncing(true)
    onError(null)
    try {
      const res = await fetch(syncEndpoint(playlistId), syncRequestInit('pull'))
      if (!res.ok) throw await syncFailure(res, 'Sync failed')
      await onSynced()
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }, [playlistId, onError, onSynced])

  const pushIfNeeded = useCallback(async () => {
    if (!autoPushes) return
    const res = await fetch(syncEndpoint(playlistId), syncRequestInit('push'))
    if (!res.ok) throw await syncFailure(res, 'Auto-sync to Spotify failed')
  }, [autoPushes, playlistId])

  return { syncing, pull, pushIfNeeded }
}
