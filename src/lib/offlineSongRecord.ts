/**
 * The record id of a single downloaded song (RH-116), and the Fast View path
 * its document is stored under (RH-195).
 *
 * A downloaded song is an ordinary stored snapshot of one song, so it needs a
 * record id that can never collide with a playlist's. Playlist ids are UUIDs
 * and never contain a colon; a song id always starts with the reserved
 * `song:` marker, so the two namespaces are disjoint. The cache prefix is
 * `/__offline-tab/<id>/` (trailing slash), so no song prefix is a prefix of
 * another record's prefix either.
 *
 * The owner context is part of the id: the personal copy and a band-context
 * copy of one version hold different rows and must not overwrite each other.
 * Pure and client-safe; `isSongRecordId` derives the kind from the id, so no
 * stored field is added to the snapshot schema.
 */

const SONG_RECORD_MARKER = 'song:'

export function songRecordId(versionId: string, bandId: string | null): string {
  return bandId
    ? `${SONG_RECORD_MARKER}${versionId}:band:${bandId}`
    : `${SONG_RECORD_MARKER}${versionId}`
}

export function isSongRecordId(recordId: string): boolean {
  return recordId.startsWith(SONG_RECORD_MARKER)
}

/**
 * The Fast View address of a stored song in its owner context (RH-195):
 * `/songs/<versionId>/fast-view`, plus `?bandId=<bandId>` in band context.
 *
 * One spelling for two things that must agree byte for byte: the path a song
 * download stores the Fast View document under in `OFFLINE_PAGE_CACHE`, and
 * the link `/offline` opens it with. The worker answers a navigation from that
 * cache by URL, so a link spelled differently (say with `fastViewHref`'s bare
 * trailing `?`) would miss the stored document. It is also the spelling a
 * playlist row links with, so a document the worker stored online is the same
 * entry.
 */
export function offlineFastViewPath(versionId: string, bandId: string | null): string {
  return `/songs/${versionId}/fast-view${bandId ? `?bandId=${bandId}` : ''}`
}
