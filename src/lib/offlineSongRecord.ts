/**
 * The record id of a single downloaded song (RH-116).
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
