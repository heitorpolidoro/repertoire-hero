import { useCallback, useEffect, useRef, useState } from 'react'
import { logger } from '@/lib/logger'
import { formatDownloadedAgo } from '@/lib/offlineFormat'
import type { PlaylistEntry } from '@/lib/playlistNav'
import { OFFLINE_STORE, type OfflineStore } from '@/lib/offlineStore'
import {
  setlistSongIds,
  setlistSummary,
  type OfflinePlaylistSummary,
  type OfflineSetlistRecord,
  type OfflineSongRecord,
} from '@/lib/offlineRecords'
import { songRecordId } from '@/lib/offlineSongRecord'
import { captureResolvedEntry, type OfflineCaptureActions } from '@/lib/offlineCapture'

/**
 * The Server Actions the download reads through. Injected rather than imported,
 * so `src/hooks` never points back into the App Router tree (F21).
 * Required and never defaulted — a default would have to import that tree.
 *
 * `getTabs` takes a **song id** (RH-123) and the entry read is
 * version-addressed (RH-132), so every entry of the playlist is capturable —
 * the ones whose owner holds no row included.
 */
export interface OfflineDownloadActions extends OfflineCaptureActions {
  getPlaylistDetailsWithEntries: (
    playlistId: string,
    bandId?: string | null,
  ) => Promise<{ name: string; entries: PlaylistEntry[] }>
}

export interface UseOfflinePlaylistOptions {
  playlistId: string
  playlistName: string
  bandId: string | null
  /** Required, never defaulted — see `src/app/offlineActions.ts` (F21). */
  actions: OfflineDownloadActions
  /** Defaults to the real `OFFLINE_STORE`; a test injects its own. */
  store?: OfflineStore
}

/** How far a download has got, in songs. */
export interface OfflineDownloadProgress {
  done: number
  total: number
}

export type OfflineDownloadStatus = 'idle' | 'downloading' | 'downloaded'

/** How many of the stored list's songs are on this device (RH-192). */
export interface OfflineSetlistCount {
  onDevice: number
  total: number
}

/** What the "Make available offline" control renders (RH-188, RH-192). */
export interface OfflinePlaylistController {
  status: OfflineDownloadStatus
  progress: OfflineDownloadProgress
  /** The stored list's size and date; `null` unless `status` is `downloaded`. */
  summary: OfflinePlaylistSummary | null
  /** `null` until a list is stored. */
  count: OfflineSetlistCount | null
  /**
   * How old the stored copy is, in words, measured when it was read — reading
   * the clock during render is a `react-hooks/purity` error.
   */
  downloadedAgo: string | null
  error: string | null
  /** "Make available offline" and "Try again": fetches only the songs not on the device. */
  download: () => Promise<void>
  /** "Refresh offline copy": refetches every song of the playlist. */
  refresh: () => Promise<void>
  remove: () => Promise<void>
  dismissError: () => void
}

const NO_PROGRESS: OfflineDownloadProgress = { done: 0, total: 0 }

/** Shown when the playlist read fails over a list already stored: nothing was touched. */
export const PLAYLIST_READ_FAILED_KEPT =
  'Could not reach this playlist. Your offline copy was not changed.'

function isQuota(error: unknown): boolean {
  // Structural: jsdom's `DOMException` is not an `Error` subclass.
  return (error as { name?: unknown } | null)?.name === 'QuotaExceededError'
}

/** Nothing of this playlist was stored, and nothing was before. */
function nothingKeptMessage(quota: boolean): string {
  return quota
    ? 'Not enough storage. Nothing from this playlist was kept.'
    : 'Could not download this playlist. Nothing from this playlist was kept.'
}

/** The songs are stored but the list itself could not be written. */
function listFailedMessage(error: unknown): string {
  return isQuota(error)
    ? 'Not enough storage to save this playlist offline.'
    : 'Could not save this playlist offline.'
}

/** Some songs of this run failed; the others are stored. */
function partialMessage(failed: number, attempted: number, quota: boolean): string {
  const counted = `${failed} of ${attempted} songs could not be downloaded.`
  return quota ? `Not enough storage. ${counted}` : counted
}

function countOf(setlist: OfflineSetlistRecord, songs: OfflineSongRecord[]): OfflineSetlistCount {
  const stored = new Set(songs.map((song) => song.playlistId))
  const ids = setlistSongIds(setlist)
  return { onDevice: ids.filter((id) => stored.has(id)).length, total: ids.length }
}

interface StoredSetlist {
  setlist: OfflineSetlistRecord | null
  songs: OfflineSongRecord[]
}

interface RunOutcome {
  failed: number
  attempted: number
  quota: boolean
}

/**
 * Downloads each target song on its own (RH-192): one song's network or quota
 * failure is counted and logged, and never stops or rolls back the others.
 * A null entry read counts as a failure too — the song is then missing.
 */
async function downloadSongs(
  { actions, store }: { actions: OfflineDownloadActions; store: OfflineStore },
  targets: PlaylistEntry[],
  bandId: string | null,
  onStep: (done: number) => void,
): Promise<RunOutcome> {
  const outcome: RunOutcome = { failed: 0, attempted: targets.length, quota: false }
  const savedAt = new Date().toISOString()
  for (const [index, entry] of targets.entries()) {
    try {
      const resolved = await actions.getResolvedEntryForVersion(entry.versionId, bandId)
      if (!resolved) throw new Error('This song could not be read, so it was not downloaded')
      const song = await captureResolvedEntry(actions, entry, resolved, bandId)
      await store.saveOfflineSong({ song, bandId, savedAt })
    } catch (cause) {
      logger.error('A song failed during the offline playlist download', cause, {
        versionId: entry.versionId,
      })
      outcome.failed += 1
      outcome.quota ||= isQuota(cause)
    }
    onStep(index + 1)
  }
  return outcome
}

/**
 * The per-playlist download controller (RH-79, RH-192).
 *
 * The playlist's songs are stored one by one, once per owner context, and the
 * playlist itself as its ordered list. "Make available offline" and "Try again"
 * fetch only the songs missing from the device; "Refresh offline copy"
 * refetches them all. The list is saved when the run ends if any of its songs
 * is on the device, if the playlist was already downloaded, or if nothing
 * failed. A failed playlist read leaves everything stored untouched.
 *
 * `store` carries a default (the real `OFFLINE_STORE`); `actions` does not, and
 * cannot, because a default would import the App Router tree.
 */
export function useOfflinePlaylist({
  playlistId,
  playlistName,
  bandId,
  actions,
  store = OFFLINE_STORE,
}: UseOfflinePlaylistOptions): OfflinePlaylistController {
  const [status, setStatus] = useState<OfflineDownloadStatus>('idle')
  const [progress, setProgress] = useState<OfflineDownloadProgress>(NO_PROGRESS)
  const [summary, setSummary] = useState<OfflinePlaylistSummary | null>(null)
  const [count, setCount] = useState<OfflineSetlistCount | null>(null)
  const [downloadedAgo, setDownloadedAgo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The download reads through whatever `actions` is at the moment it runs, so
  // a re-rendered parent passing a fresh object cannot restart the mount read.
  const actionsRef = useRef(actions)
  useEffect(() => {
    actionsRef.current = actions
  })

  const readStored = useCallback(async (): Promise<StoredSetlist> => {
    const [setlists, songs] = await Promise.all([store.listOfflineSetlists(), store.listOfflineSongs()])
    return { setlist: setlists.find((row) => row.playlistId === playlistId) ?? null, songs }
  }, [playlistId, store])

  /** Publishes what is stored now; `false` when no list is. */
  const publish = useCallback(({ setlist, songs }: StoredSetlist): boolean => {
    if (!setlist) {
      setSummary(null)
      setCount(null)
      setDownloadedAgo(null)
      setStatus('idle')
      return false
    }
    setSummary(setlistSummary(setlist, songs))
    setCount(countOf(setlist, songs))
    setDownloadedAgo(formatDownloadedAgo(setlist.savedAt, Date.now()))
    setStatus('downloaded')
    return true
  }, [])

  useEffect(() => {
    let active = true
    readStored()
      .then((stored) => {
        if (active && stored.setlist) publish(stored)
      })
      .catch((cause: unknown) => logger.error('Failed to read the offline library', cause))
    return () => {
      active = false
    }
  }, [publish, readStored])

  const run = useCallback(
    async (refetchAll: boolean) => {
      setError(null)
      setStatus('downloading')
      setProgress(NO_PROGRESS)
      const before = await readStored().catch((): StoredSetlist => ({ setlist: null, songs: [] }))
      const wasDownloaded = before.setlist !== null
      let details: { entries: PlaylistEntry[] }
      try {
        details = await actionsRef.current.getPlaylistDetailsWithEntries(playlistId, bandId)
      } catch (cause) {
        // Nothing was written yet, so whatever was stored is exactly as it was.
        logger.error('Offline download could not read the playlist', cause, { playlistId })
        setStatus(wasDownloaded ? 'downloaded' : 'idle')
        setError(wasDownloaded ? PLAYLIST_READ_FAILED_KEPT : nothingKeptMessage(isQuota(cause)))
        return
      }
      const stored = new Set(before.songs.map((song) => song.playlistId))
      const targets = refetchAll
        ? details.entries
        : details.entries.filter((entry) => !stored.has(songRecordId(entry.versionId, bandId)))
      setProgress({ done: 0, total: targets.length })
      const outcome = await downloadSongs({ actions: actionsRef.current, store }, targets, bandId, (done) =>
        setProgress({ done, total: targets.length }),
      )
      try {
        const after = await store.listOfflineSongs()
        const present = new Set(after.map((song) => song.playlistId))
        const anyOnDevice = details.entries.some((entry) => present.has(songRecordId(entry.versionId, bandId)))
        if (anyOnDevice || wasDownloaded || outcome.failed === 0) {
          await store.saveOfflineSetlist({
            playlistId,
            playlistName,
            bandId,
            savedAt: new Date().toISOString(),
            entries: details.entries.map(({ versionId, title, artist }) => ({ versionId, title, artist })),
          })
        }
        publish(await readStored())
        if (outcome.failed > 0) {
          setError(
            anyOnDevice || wasDownloaded
              ? partialMessage(outcome.failed, outcome.attempted, outcome.quota)
              : nothingKeptMessage(outcome.quota),
          )
        }
      } catch (cause) {
        logger.error('Offline download could not store the playlist', cause, { playlistId })
        setStatus(wasDownloaded ? 'downloaded' : 'idle')
        setError(listFailedMessage(cause))
      }
    },
    [bandId, playlistId, playlistName, publish, readStored, store],
  )

  const download = useCallback(() => run(false), [run])
  const refresh = useCallback(() => run(true), [run])

  const remove = useCallback(async () => {
    try {
      await store.removeOfflinePlaylist(playlistId)
      publish({ setlist: null, songs: [] })
      setProgress(NO_PROGRESS)
    } catch (cause) {
      logger.error('Failed to remove the offline copy', cause, { playlistId })
      setError(cause instanceof Error ? cause.message : 'Failed to remove the offline copy')
    }
  }, [playlistId, publish, store])

  const dismissError = useCallback(() => setError(null), [])

  return {
    status,
    progress,
    summary,
    count,
    downloadedAgo,
    error,
    download,
    refresh,
    remove,
    dismissError,
  }
}
