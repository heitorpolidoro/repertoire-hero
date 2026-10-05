import { useCallback, useEffect, useRef, useState } from 'react'
import { logger } from '@/lib/logger'
import { formatDownloadedAgo } from '@/lib/offlineFormat'
import type { PlaylistEntry } from '@/lib/playlistNav'
import {
  OFFLINE_STORE,
  type OfflinePlaylistSummary,
  type OfflineSongInput,
  type OfflineStore,
} from '@/lib/offlineStore'
import type { Repertoire, SongFile } from '@/types/database'

/**
 * The Server Actions the download reads through. Injected rather than imported,
 * so `src/hooks` never points back into the App Router tree (F21).
 * Required and never defaulted — a default would have to import that tree.
 *
 * Four existing actions, no new one and no new SQL. `getPersonalEntryForSong`
 * joined them in RH-83: the snapshot has to carry the member's own row or the
 * band-vs-personal lyrics badge lies offline. It is read once per song and only
 * in band context; the action already catches and returns `null`, so the read
 * is fail-soft and cannot break a download.
 *
 * `getTabs` takes a **song id** since RH-123, not a repertoire row id. That is
 * where the plan's recorded defect lived: in band context `entry.repertoireId`
 * is the *band* row, so the snapshot took the band's files and skipped the
 * member's own. Passing the song id to an action that resolves by the session's
 * `user_id` captures the downloader's own files instead.
 */
export interface OfflineDownloadActions {
  getPlaylistDetailsWithEntries: (
    playlistId: string,
    bandId?: string | null,
  ) => Promise<{ name: string; entries: PlaylistEntry[] }>
  getSongEntry: (repertoireId: string, bandId?: string | null) => Promise<Repertoire | null>
  getTabs: (songId: string) => Promise<SongFile[]>
  getPersonalEntryForSong: (songId: string) => Promise<Repertoire | null>
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

/** What the "Available offline" control renders. */
export interface OfflinePlaylistController {
  status: OfflineDownloadStatus
  progress: OfflineDownloadProgress
  /** The stored record's size and date; `null` unless `status` is `downloaded`. */
  summary: OfflinePlaylistSummary | null
  /**
   * How old the stored copy is, in words, measured when it was read — reading
   * the clock during render is a `react-hooks/purity` error.
   */
  downloadedAgo: string | null
  error: string | null
  /** Downloads, or re-downloads over the existing copy. */
  download: () => Promise<void>
  remove: () => Promise<void>
  dismissError: () => void
}

const NO_PROGRESS: OfflineDownloadProgress = { done: 0, total: 0 }

/**
 * What the inline alert says.
 *
 * A quota failure is named rather than reported verbatim, because the browser's
 * own message says nothing a musician can act on, and because the store has
 * already rolled the whole download back — "nothing was kept" is the fact worth
 * stating. The structural `name` read is deliberate: jsdom's `DOMException` is
 * not an `Error` subclass, so `instanceof` alone would miss it.
 */
function messageOf(error: unknown): string {
  if ((error as { name?: unknown } | null)?.name === 'QuotaExceededError') {
    return 'Not enough storage. Nothing from this playlist was kept — tap to try again.'
  }
  if (error instanceof Error) return error.message
  return 'Failed to make this playlist available offline'
}

/**
 * Reads everything one playlist needs offline, through the injected actions.
 *
 * An entry whose repertoire row cannot be read is skipped rather than failing
 * the download: it is a row the caller may not read in this owner context, and
 * Fast View could not show it online either.
 */
async function gatherSongs(
  actions: OfflineDownloadActions,
  entries: PlaylistEntry[],
  bandId: string | null,
): Promise<OfflineSongInput[]> {
  const songs: OfflineSongInput[] = []
  for (const entry of entries) {
    const repertoire = await actions.getSongEntry(entry.repertoireId, bandId)
    if (!repertoire) continue
    // The song id, never `entry.repertoireId`: in band context that is the
    // band's row, and the band holds no files at all now. Resolved by the
    // session's `user_id`, so this captures the downloader's own charts (RH-123).
    const tabs = await actions.getTabs(repertoire.song_id)
    // Only in band context: outside one there is no second version to capture,
    // and `repertoire` already *is* the member's own row.
    const personalRepertoire = bandId ? await actions.getPersonalEntryForSong(repertoire.song_id) : null
    songs.push({ entry, repertoire, personalRepertoire, tabs })
  }
  return songs
}

/**
 * The per-playlist download controller (RH-79).
 *
 * All-or-nothing by construction, because the store is: `status` only reaches
 * `downloaded` when `saveOfflinePlaylist` resolves, and that call either writes
 * the IndexedDB record last or unwinds everything it wrote and throws. A failed
 * refresh therefore lands back on `idle` — which is then true, since the store
 * discarded the previous copy too.
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
  const [downloadedAgo, setDownloadedAgo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The download reads through whatever `actions` is at the moment it runs, so
  // a re-rendered parent passing a fresh object cannot restart the mount read.
  const actionsRef = useRef(actions)
  useEffect(() => {
    actionsRef.current = actions
  })

  const readStored = useCallback(async () => {
    const rows = await store.listOfflinePlaylists()
    return rows.find((row) => row.playlistId === playlistId) ?? null
  }, [playlistId, store])

  useEffect(() => {
    let active = true
    readStored()
      .then((stored) => {
        if (!active || !stored) return
        setSummary(stored)
        setDownloadedAgo(formatDownloadedAgo(stored.savedAt, Date.now()))
        setStatus('downloaded')
      })
      .catch((cause: unknown) => logger.error('Failed to read the offline library', cause))
    return () => {
      active = false
    }
  }, [readStored])

  const download = useCallback(async () => {
    setError(null)
    setStatus('downloading')
    setProgress(NO_PROGRESS)
    try {
      const details = await actionsRef.current.getPlaylistDetailsWithEntries(playlistId, bandId)
      setProgress({ done: 0, total: details.entries.length })
      const songs = await gatherSongs(actionsRef.current, details.entries, bandId)
      const record = await store.saveOfflinePlaylist({
        playlistId,
        playlistName,
        bandId,
        savedAt: new Date().toISOString(),
        songs,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      setSummary(record)
      setDownloadedAgo(formatDownloadedAgo(record.savedAt, Date.now()))
      setStatus('downloaded')
    } catch (cause) {
      // The store already rolled everything back, so "not downloaded" is true.
      logger.error('Offline download failed', cause, { playlistId })
      setSummary(null)
      setDownloadedAgo(null)
      setStatus('idle')
      setError(messageOf(cause))
    }
  }, [bandId, playlistId, playlistName, store])

  const remove = useCallback(async () => {
    try {
      await store.removeOfflinePlaylist(playlistId)
      setSummary(null)
      setDownloadedAgo(null)
      setStatus('idle')
      setProgress(NO_PROGRESS)
    } catch (cause) {
      logger.error('Failed to remove the offline copy', cause, { playlistId })
      setError(messageOf(cause))
    }
  }, [playlistId, store])

  const dismissError = useCallback(() => setError(null), [])

  return { status, progress, summary, downloadedAgo, error, download, remove, dismissError }
}
