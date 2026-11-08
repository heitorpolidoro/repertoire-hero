import { useCallback, useEffect, useRef, useState } from 'react'
import { logger } from '@/lib/logger'
import { captureResolvedEntry, type OfflineCaptureActions } from '@/lib/offlineCapture'
import { formatDownloadedAgo } from '@/lib/offlineFormat'
import { songRecordId } from '@/lib/offlineSongRecord'
import { songSummary, type OfflinePlaylistSummary } from '@/lib/offlineRecords'
import { OFFLINE_STORE, type OfflineStore } from '@/lib/offlineStore'
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
 * The per-song download controller (RH-116, RH-192).
 *
 * The song is stored once per owner context through `saveOfflineSong`, under
 * `songRecordId(versionId, bandId)` — the same record a setlist download of it
 * writes, so a song already on the device through a setlist reads as
 * downloaded here too. A tap on the **idle** control marks it
 * `individualDownload: true`, which a later setlist removal respects; a refresh
 * of a stored copy leaves the flag as it was. Removing it here deletes that one
 * song and keeps every setlist list.
 *
 * The capture is the playlist download's own (`captureResolvedEntry`). Nothing
 * is skipped — there is no other song to carry on with — so a null or throwing
 * entry read fails the download, and a failure keeps any stored copy.
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
      .listOfflineSongs()
      .then((rows) => {
        const stored = rows.find((row) => row.playlistId === recordId)
        if (!active || !stored) return
        setSummary(songSummary(stored))
        setDownloadedAgo(formatDownloadedAgo(stored.savedAt, Date.now()))
        setStatus('downloaded')
      })
      .catch((cause: unknown) => logger.error('Failed to read the offline library', cause))
    return () => {
      active = false
    }
  }, [recordId, store])

  const download = useCallback(async () => {
    // Only a tap on the idle control downloads the song individually (RH-192).
    const individualDownload = summary === null
    const previous = summary
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
      const record = await store.saveOfflineSong({
        song,
        bandId,
        savedAt: new Date().toISOString(),
        individualDownload,
      })
      setProgress({ done: 1, total: 1 })
      setSummary(songSummary(record))
      setDownloadedAgo(formatDownloadedAgo(record.savedAt, Date.now()))
      setStatus('downloaded')
    } catch (cause) {
      // The store unwound this attempt; a copy stored before it is still there.
      logger.error('Offline song download failed', cause, { versionId })
      setStatus(previous ? 'downloaded' : 'idle')
      setError(messageOf(cause))
    }
  }, [bandId, store, summary, versionId])

  const remove = useCallback(async () => {
    try {
      await store.removeOfflineSong(versionId, bandId)
      setSummary(null)
      setDownloadedAgo(null)
      setStatus('idle')
      setProgress(NO_PROGRESS)
    } catch (cause) {
      logger.error('Failed to remove the offline song copy', cause, { versionId })
      setError(messageOf(cause))
    }
  }, [bandId, store, versionId])

  const dismissError = useCallback(() => setError(null), [])

  return { status, progress, summary, downloadedAgo, error, download, remove, dismissError }
}
