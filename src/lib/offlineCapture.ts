import type { PlaylistEntry } from '@/lib/playlistNav'
import type { OfflineSongInput } from '@/lib/offlineStore'
import type { Repertoire, ResolvedSongEntry, SongFile } from '@/types/database'
import type { CustomFieldEntry } from '@/types/customField'

/**
 * The four reads one captured song needs. `src/hooks/useOfflinePlaylist.ts`
 * extends this with the playlist read; both downloads share
 * `captureResolvedEntry` below (RH-116), so there is one copy of the capture.
 */
export interface OfflineCaptureActions {
  getResolvedEntryForVersion: (
    versionId: string,
    bandId?: string | null,
  ) => Promise<ResolvedSongEntry | null>
  getTabs: (songId: string) => Promise<SongFile[]>
  getPersonalEntryForSong: (songId: string) => Promise<Repertoire | null>
  /** The reader's own custom field values on the version (RH-186); no band id. */
  getCustomFieldValues: (versionId: string) => Promise<CustomFieldEntry[]>
}

/**
 * Reads the files, the member's own row and the reader's custom field values
 * for an already-resolved entry.
 *
 * The song id, never the owner row id: in band context that is the band's row,
 * and the band holds no files (RH-123). The member's own row is read only in
 * band context; outside one `resolved` already is it. Custom field values are
 * keyed by the version and always the reader's own (RH-186). A failure here is
 * not swallowed: it fails the whole download (all-or-nothing).
 */
export async function captureResolvedEntry(
  actions: OfflineCaptureActions,
  entry: PlaylistEntry,
  resolved: ResolvedSongEntry,
  bandId: string | null,
): Promise<OfflineSongInput> {
  const tabs = await actions.getTabs(resolved.song_id)
  const personalRepertoire = bandId
    ? await actions.getPersonalEntryForSong(resolved.song_id)
    : null
  const customFields = await actions.getCustomFieldValues(resolved.version_id)
  return { entry, repertoire: resolved, personalRepertoire, tabs, customFields }
}
