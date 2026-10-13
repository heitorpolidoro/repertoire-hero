import { useCallback, useEffect, useRef, useState } from 'react'
import { logger } from '@/lib/logger'
import { captureResolvedEntry, type OfflineCaptureActions } from '@/lib/offlineCapture'
import { formatDownloadedAgo } from '@/lib/offlineFormat'
import { songRecordId } from '@/lib/offlineSongRecord'
import { OFFLINE_STORE, type OfflinePlaylistSummary, type OfflineStore } from '@/lib/offlineStore'
import type { PlaylistEntry } from '@/lib/playlistNav'
import type {
  OfflineDownloadProgress,
  OfflineDownloadStatus,
} from '@/hooks/useOfflinePlaylist'

export interface UseOfflineSongOptions {
  versionId: string
  /** The page's `?bandId=` owner context; `null` for the personal repertoire. */
  bandId: string | null
  /** Required, never defaulted — see `src/app/offlineActions.ts` (F21). */
  actions: OfflineCaptureActions
  /** Defaults to the real `OFFLINE_STORE`; a test injects its own. */
  store?: OfflineStore
}

/** What the single-song "Available offline" control renders (RH-116). */
export interface OfflineSongController {
  status: OfflineDownloadStatus
  progress: OfflineDownloadProgress
  summary: OfflinePlaylistSummary | null
  downloadedAgo: string | null
  error: string | null
  download: () => Promise<void>
  remove: () => Promise<void>
  dismissError: () => void
}

const NO_PROGRESS: OfflineDownloadProgress = { done: 0, total: 0 }
const ONE_SONG: OfflineDownloadProgress = { done: 0, total: 1 }

function messageOf(error: unknown): string {
  if ((error as { name?: unknown } | null)?.name === 'QuotaExceededError') {
    return 'Not enough storage. Nothing from this song was kept — tap to try again.'
  }
  if (error instanceof Error) return error.message
  return 'Failed to make this song available offline'
}

/**
 * The per-song download controller (RH-116).
 *
 * A downloaded song is an ordinary one-song snapshot stored through the same
 * all-or-nothing `saveOfflinePlaylist`, under a record id from
 * `songRecordId` that cannot collide with a playlist's. The capture is the
 * playlist download's own (`captureResolvedEntry`): resolved entry, then
 * `getTabs(song id)`, then in band context the member's own row. Unlike the
 * playlist loop nothing is skipped — there is no other song to carry on with —
 * so a null or throwing entry read fails the download.
 */
export function useOfflineSong({
  versionId,
  bandId,
  actions,
  store = OFFLINE_STORE,
}: UseOfflineSongOptions): OfflineSongController {
  const recordId = songRecordId(versionId, bandId)
  const [status, setStatus] = useState<OfflineDownloadStatus>('idle')
  const [progress, setProgress] = useState<OfflineDownloadProgress>(NO_PROGRESS)
  const [summary, setSummary] = useState<OfflinePlaylistSummary | null>(null)
  const [downloadedAgo, setDownloadedAgo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const actionsRef = useRef(actions)
  useEffect(() => {
    actionsRef.current = actions
  })

  useEffect(() => {
    let active = true
    store
      .listOfflinePlaylists()
      .then((rows) => {
        const stored = rows.find((row) => row.playlistId === recordId)
        if (!active || !stored) return
        setSummary(stored)
        setDownloadedAgo(formatDownloadedAgo(stored.savedAt, Date.now()))
        setStatus('downloaded')
      })
      .catch((cause: unknown) => logger.error('Failed to read the offline library', cause))
    return () => {
      active = false
    }
  }, [recordId, store])

  const download = useCallback(async () => {
    setError(null)
    setStatus('downloading')
    setProgress(ONE_SONG)
    try {
      const resolved = await actionsRef.current.getResolvedEntryForVersion(versionId, bandId)
      if (!resolved) throw new Error('This song could not be read, so it was not downloaded')
      const entry: PlaylistEntry = {
        repertoireId: resolved.ownerRowId,
        versionId: resolved.version_id,
        songId: resolved.song_id,
        title: resolved.song?.title ?? '',
        artist: resolved.song?.artist ?? null,
      }
      const song = await captureResolvedEntry(actionsRef.current, entry, resolved, bandId)
      const record = await store.saveOfflinePlaylist({
        playlistId: recordId,
        playlistName: entry.title,
        bandId,
        savedAt: new Date().toISOString(),
        songs: [song],
        onProgress: (done, total) => setProgress({ done, total }),
      })
      setSummary(record)
      setDownloadedAgo(formatDownloadedAgo(record.savedAt, Date.now()))
      setStatus('downloaded')
    } catch (cause) {
      // The store already rolled everything back, so "not downloaded" is true.
      logger.error('Offline song download failed', cause, { versionId })
      setSummary(null)
      setDownloadedAgo(null)
      setStatus('idle')
      setError(messageOf(cause))
    }
  }, [bandId, recordId, store, versionId])

  const remove = useCallback(async () => {
    try {
      await store.removeOfflinePlaylist(recordId)
      setSummary(null)
      setDownloadedAgo(null)
      setStatus('idle')
      setProgress(NO_PROGRESS)
    } catch (cause) {
      logger.error('Failed to remove the offline song copy', cause, { versionId })
      setError(messageOf(cause))
    }
  }, [recordId, store, versionId])

  const dismissError = useCallback(() => setError(null), [])

  return { status, progress, summary, downloadedAgo, error, download, remove, dismissError }
}
