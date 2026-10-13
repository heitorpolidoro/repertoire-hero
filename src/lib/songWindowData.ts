import { getResolvedEntryForVersion, type RepertoireOwner } from '@/lib/ownerSongs'
import { listTabs } from '@/lib/tabs'
import { WINDOW_SIZE, type SongWindowRecord } from '@/lib/songWindow'

/** The message `getResolvedEntryForVersion` raises for an id that is not a version. */
const VERSION_NOT_FOUND = 'Song version not found'

/**
 * One record of the window. A version that does not exist answers `entry: null`
 * and `files: []` for itself only; any other failure propagates, because a
 * database error is not "this song is absent".
 */
async function songWindowRecord(
  owner: RepertoireOwner,
  userId: string,
  versionId: string,
): Promise<SongWindowRecord> {
  try {
    const entry = await getResolvedEntryForVersion(owner, versionId)
    // The caller's own files: a file belongs to the person, not to the band (RH-123).
    const files = await listTabs(userId, entry.song_id)
    return { versionId, entry, files }
  } catch (error) {
    if (error instanceof Error && error.message.includes(VERSION_NOT_FOUND)) {
      return { versionId, entry: null, files: [] }
    }
    throw error
  }
}

/**
 * The content of a window of up to three song versions, assembled for one owner
 * (RH-134). The owner is resolved - and band membership asserted - once, by the
 * caller; this only reads, through the same functions the single-song reads use.
 */
export async function getSongWindow(
  owner: RepertoireOwner,
  userId: string,
  versionIds: string[],
): Promise<SongWindowRecord[]> {
  if (versionIds.length > WINDOW_SIZE) {
    throw new Error(`A song window holds at most ${WINDOW_SIZE} versions`)
  }
  return Promise.all(versionIds.map((versionId) => songWindowRecord(owner, userId, versionId)))
}
