import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { logger } from '@/lib/logger'
import { formatDownloadedAgo } from '@/lib/offlineFormat'
import { OFFLINE_STORE, type OfflineStore } from '@/lib/offlineStore'
import {
  liveOfflineCount,
  setlistSummary,
  type OfflinePlaylistSummary,
  type OfflineSetlistRecord,
  type OfflineSongRecord,
} from '@/lib/offlineRecords'
import { songRecordId } from '@/lib/offlineSongRecord'
import {
  downloadPlaylist,
  type OfflineDownloadActions,
  type OfflineDownloadProgress,
  type PlaylistRunOutcome,
} from '@/lib/offlinePlaylistDownload'

// The download run moved to `@/lib/offlinePlaylistDownload` (RH-193); its
// public names stay importable from here, where every caller already reads them.
export { PLAYLIST_READ_FAILED_KEPT } from '@/lib/offlinePlaylistDownload'
export type { OfflineDownloadActions, OfflineDownloadProgress } from '@/lib/offlinePlaylistDownload'

export interface UseOfflinePlaylistOptions {
  playlistId: string
  playlistName: string
  bandId: string | null
  /**
   * The page's live list (RH-193): every entry's `version_id`, in playlist
   * order. The counts are over these, never over the stored list.
   */
  versionIds: string[]
  /** Required, never defaulted — see `src/app/offlineActions.ts` (F21). */
  actions: OfflineDownloadActions
  /** Defaults to the real `OFFLINE_STORE`; a test injects its own. */
  store?: OfflineStore
}

export type OfflineDownloadStatus = 'idle' | 'downloading' | 'downloaded'

/**
 * What the playlist page's offline control and its song rows render (RH-188,
 * RH-192, RH-193). One instance per page, owned by `PlaylistDetailView`.
 */
export interface OfflinePlaylistController {
  status: OfflineDownloadStatus
  progress: OfflineDownloadProgress
  /** The stored list's name and date; `null` unless a list is stored. */
  summary: OfflinePlaylistSummary | null
  /** Whether this playlist's list is stored (it stays true while a refresh runs). */
  downloaded: boolean
  /** The live `version_id`s stored on this device in the playlist's owner context. */
  storedVersionIds: ReadonlySet<string>
  /** How many live entries are stored. */
  stored: number
  /** How many live entries there are. */
  total: number
  /** The stored songs' bytes, over the live entries. */
  bytes: number
  /**
   * How old the stored copy is, in words, measured when it was read — reading
   * the clock during render is a `react-hooks/purity` error.
   */
  downloadedAgo: string | null
  error: string | null
  /** Whether "Try again" applies to `error`: true for a download, false for a removal. */
  errorRetryable: boolean
  /** "Make available offline", "Download N missing songs" and "Try again": only the songs not on the device. */
  download: () => Promise<void>
  /** "Refresh offline copy": refetches every song of the playlist. */
  refresh: () => Promise<void>
  remove: () => Promise<void>
  /** Removes one song from this device; the playlist and its stored list are untouched. */
  removeSong: (versionId: string, title: string) => Promise<void>
  dismissError: () => void
}

interface OfflineFailure {
  message: string
  retryable: boolean
}

/** Shown when "Remove offline copy" fails (RH-192 copy). */
const PLAYLIST_REMOVE_FAILED = 'Could not remove this playlist from this device.'

function songRemoveFailed(title: string): string {
  return `Could not remove ${title} from this device.`
}

const NO_PROGRESS: OfflineDownloadProgress = { done: 0, total: 0 }

function bytesById(songs: OfflineSongRecord[]): Map<string, number> {
  return new Map(songs.map((song) => [song.playlistId, song.bytes]))
}

interface StoredSetlist {
  setlist: OfflineSetlistRecord | null
  songs: OfflineSongRecord[]
}

/**
 * The per-playlist download controller (RH-79, RH-192); the run itself is
 * `downloadPlaylist` in `@/lib/offlinePlaylistDownload`.
 *
 * RH-193: the page's one instance also answers for its song rows. It counts
 * the **live** entries (`versionIds`) stored on this device and removes one
 * song from the device, re-reading the store after every write and whenever
 * the live list changes, so a row mark and the header count change together.
 *
 * `store` carries a default (the real `OFFLINE_STORE`); `actions` does not, and
 * cannot, because a default would import the App Router tree.
 */
export function useOfflinePlaylist({
  playlistId,
  playlistName,
  bandId,
  versionIds,
  actions,
  store = OFFLINE_STORE,
}: UseOfflinePlaylistOptions): OfflinePlaylistController {
  const [status, setStatus] = useState<OfflineDownloadStatus>('idle')
  const [progress, setProgress] = useState<OfflineDownloadProgress>(NO_PROGRESS)
  const [summary, setSummary] = useState<OfflinePlaylistSummary | null>(null)
  /** Every stored song's record id and bytes; the live count is derived from it. */
  const [songBytes, setSongBytes] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [downloadedAgo, setDownloadedAgo] = useState<string | null>(null)
  const [failure, setFailure] = useState<OfflineFailure | null>(null)

  // The live list as a value, so a parent re-rendering a fresh but equal array
  // neither re-reads the store nor recomputes the count.
  const liveKey = versionIds.join('\n')
  const live = useMemo(
    () => liveOfflineCount(liveKey === '' ? [] : liveKey.split('\n'), bandId, songBytes),
    [bandId, liveKey, songBytes],
  )

  // The download reads through whatever `actions` is at the moment it runs, so
  // a re-rendered parent passing a fresh object cannot restart the mount read.
  const actionsRef = useRef(actions)
  useEffect(() => {
    actionsRef.current = actions
  })
  // True while a download runs: a re-read then refreshes the stored set only,
  // so it cannot flip the busy control back to a resting state.
  const busyRef = useRef(false)

  const readStored = useCallback(async (): Promise<StoredSetlist> => {
    const [setlists, songs] = await Promise.all([store.listOfflineSetlists(), store.listOfflineSongs()])
    return { setlist: setlists.find((row) => row.playlistId === playlistId) ?? null, songs }
  }, [playlistId, store])

  /** Publishes what is stored now. */
  const publish = useCallback(({ setlist, songs }: StoredSetlist): void => {
    setSongBytes(bytesById(songs))
    if (!setlist) {
      setSummary(null)
      setDownloadedAgo(null)
      setStatus('idle')
      return
    }
    setSummary(setlistSummary(setlist, songs))
    setDownloadedAgo(formatDownloadedAgo(setlist.savedAt, Date.now()))
    setStatus('downloaded')
  }, [])

  /** Re-reads and publishes; `false` when the read itself failed (logged). */
  const republish = useCallback(async (): Promise<boolean> => {
    try {
      publish(await readStored())
      return true
    } catch (cause) {
      logger.error('Failed to read the offline library', cause, { playlistId })
      return false
    }
  }, [playlistId, publish, readStored])

  // On mount, and again whenever the live list changes (a song added or
  // removed online): `liveKey` is the trigger, not an input.
  useEffect(() => {
    let active = true
    readStored()
      .then((stored) => {
        if (!active) return
        if (busyRef.current) setSongBytes(bytesById(stored.songs))
        else publish(stored)
      })
      .catch((cause: unknown) => logger.error('Failed to read the offline library', cause))
    return () => {
      active = false
    }
  }, [liveKey, publish, readStored])

  const run = useCallback(
    async (refetchAll: boolean) => {
      busyRef.current = true
      setFailure(null)
      setStatus('downloading')
      setProgress(NO_PROGRESS)
      let outcome: PlaylistRunOutcome
      try {
        outcome = await downloadPlaylist(
          { actions: actionsRef.current, store, playlistId, playlistName, bandId },
          refetchAll,
          setProgress,
        )
      } finally {
        busyRef.current = false
      }
      // Whatever the run did or did not write, the store is the answer.
      if (!(await republish())) setStatus(outcome.wasDownloaded ? 'downloaded' : 'idle')
      if (outcome.message) setFailure({ message: outcome.message, retryable: true })
    },
    [bandId, playlistId, playlistName, republish, store],
  )

  const download = useCallback(() => run(false), [run])
  const refresh = useCallback(() => run(true), [run])

  const remove = useCallback(async () => {
    setFailure(null)
    try {
      await store.removeOfflinePlaylist(playlistId)
    } catch (cause) {
      logger.error('Failed to remove the offline copy', cause, { playlistId })
      setFailure({ message: PLAYLIST_REMOVE_FAILED, retryable: false })
      return
    }
    setProgress(NO_PROGRESS)
    if (!(await republish())) publish({ setlist: null, songs: [] })
  }, [playlistId, publish, republish, store])

  const removeSong = useCallback(
    async (versionId: string, title: string) => {
      setFailure(null)
      try {
        await store.removeOfflineSong(versionId, bandId)
      } catch (cause) {
        // The song is still stored, so its row keeps its mark.
        logger.error('Failed to remove a song from this device', cause, { playlistId, versionId })
        setFailure({ message: songRemoveFailed(title), retryable: false })
        return
      }
      if (await republish()) return
      const gone = songRecordId(versionId, bandId)
      setSongBytes((previous) => new Map([...previous].filter(([id]) => id !== gone)))
    },
    [bandId, playlistId, republish, store],
  )

  const dismissError = useCallback(() => setFailure(null), [])

  return {
    status,
    progress,
    summary,
    downloaded: summary !== null,
    storedVersionIds: live.storedVersionIds,
    stored: live.stored,
    total: live.total,
    bytes: live.bytes,
    downloadedAgo,
    error: failure?.message ?? null,
    errorRetryable: failure?.retryable ?? false,
    download,
    refresh,
    remove,
    removeSong,
    dismissError,
  }
}
