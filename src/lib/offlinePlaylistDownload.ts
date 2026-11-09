/**
 * One playlist download run (RH-79, RH-192), out of `useOfflinePlaylist` so
 * the hook keeps only its state (RH-193).
 *
 * The playlist's songs are stored one by one, once per owner context, and the
 * playlist itself as its ordered list. "Make available offline", "Download N
 * missing songs" and "Try again" fetch only the songs missing from the device;
 * "Refresh offline copy" refetches them all. The list is saved when the run
 * ends if any of its songs is on the device, if the playlist was already
 * downloaded, or if nothing failed. A failed playlist read leaves everything
 * stored untouched.
 *
 * Client-safe: no `@/lib/db`, and the Server Actions arrive injected (F21).
 */

import { logger } from '@/lib/logger'
import { captureResolvedEntry, type OfflineCaptureActions } from '@/lib/offlineCapture'
import type { OfflineSongRecord } from '@/lib/offlineRecords'
import { songRecordId } from '@/lib/offlineSongRecord'
import type { OfflineStore } from '@/lib/offlineStore'
import type { PlaylistEntry } from '@/lib/playlistNav'

/**
 * The Server Actions the download reads through. Injected rather than imported,
 * so `src/hooks` and `src/lib` never point back into the App Router tree (F21).
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

/** How far a download has got, in songs. */
export interface OfflineDownloadProgress {
  done: number
  total: number
}

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

interface SongsOutcome {
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
): Promise<SongsOutcome> {
  const outcome: SongsOutcome = { failed: 0, attempted: targets.length, quota: false }
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

export interface PlaylistRunContext {
  actions: OfflineDownloadActions
  store: OfflineStore
  playlistId: string
  playlistName: string
  bandId: string | null
}

/** What one run left behind: whether a list was stored before it, and its alert. */
export interface PlaylistRunOutcome {
  wasDownloaded: boolean
  message: string | null
}

/**
 * One run. Never throws: every failure is logged and returned as the alert to
 * show, and the caller re-reads the store for everything else.
 */
export async function downloadPlaylist(
  context: PlaylistRunContext,
  refetchAll: boolean,
  onProgress: (progress: OfflineDownloadProgress) => void,
): Promise<PlaylistRunOutcome> {
  const { actions, store, playlistId, playlistName, bandId } = context
  const before = await store.listOfflineSongs().catch((): OfflineSongRecord[] => [])
  const wasDownloaded = await store
    .listOfflineSetlists()
    .then((setlists) => setlists.some((row) => row.playlistId === playlistId))
    .catch(() => false)
  let details: { entries: PlaylistEntry[] }
  try {
    details = await actions.getPlaylistDetailsWithEntries(playlistId, bandId)
  } catch (cause) {
    // Nothing was written yet, so whatever was stored is exactly as it was.
    logger.error('Offline download could not read the playlist', cause, { playlistId })
    return { wasDownloaded, message: wasDownloaded ? PLAYLIST_READ_FAILED_KEPT : nothingKeptMessage(isQuota(cause)) }
  }
  const stored = new Set(before.map((song) => song.playlistId))
  const targets = refetchAll
    ? details.entries
    : details.entries.filter((entry) => !stored.has(songRecordId(entry.versionId, bandId)))
  onProgress({ done: 0, total: targets.length })
  const outcome = await downloadSongs({ actions, store }, targets, bandId, (done) =>
    onProgress({ done, total: targets.length }),
  )
  try {
    const present = new Set((await store.listOfflineSongs()).map((song) => song.playlistId))
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
    if (outcome.failed === 0) return { wasDownloaded, message: null }
    const message =
      anyOnDevice || wasDownloaded
        ? partialMessage(outcome.failed, outcome.attempted, outcome.quota)
        : nothingKeptMessage(outcome.quota)
    return { wasDownloaded, message }
  } catch (cause) {
    logger.error('Offline download could not store the playlist', cause, { playlistId })
    return { wasDownloaded, message: listFailedMessage(cause) }
  }
}
