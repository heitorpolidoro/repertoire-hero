/**
 * RH-186 - the reader's own custom field values travel in the offline snapshot
 * as an optional `customFields` on each song, so `OFFLINE_SCHEMA_VERSION` stays
 * 6: a song downloaded before RH-186 carries none, which is a fact, not a guess.
 */
import { describe, it, expect } from 'vitest'
import { OFFLINE_SCHEMA_VERSION, buildOfflineSnapshot, readValidSnapshot } from '@/lib/offlineSnapshot'
import type { ResolvedSongEntry } from '@/types/database'
import type { CustomFieldEntry } from '@/types/customField'

const PRESET: CustomFieldEntry = { fieldId: 'f-preset', name: 'Preset', value: 'Lead 3B' }
const CAPO: CustomFieldEntry = { fieldId: 'f-capo', name: 'Capo', value: null }

const RESOLVED: ResolvedSongEntry = {
  ownerRowId: null,
  song_id: 'song-1',
  version_id: 'version-1',
  key: null,
  tuning: null,
  map: null,
  status: null,
  tags: [],
  last_practiced: null,
  lyrics: null,
}

function snapshotWith(customFields: CustomFieldEntry[]) {
  return buildOfflineSnapshot({
    playlistId: 'song:version-1',
    playlistName: 'One song',
    bandId: null,
    savedAt: '2026-10-27T12:00:00.000Z',
    songs: [
      {
        entry: { repertoireId: null, versionId: 'version-1', songId: 'song-1', title: 'Song', artist: null },
        repertoire: RESOLVED,
        personalRepertoire: null,
        customFields,
        tabs: [],
      },
    ],
  })
}

/** The stored value with the first song's `customFields` replaced, or removed when `undefined`. */
function withStored(customFields: unknown) {
  const stored = JSON.parse(JSON.stringify(snapshotWith([PRESET])))
  if (customFields === undefined) delete stored.songs[0].customFields
  else stored.songs[0].customFields = customFields
  return stored
}

describe('custom fields in the offline snapshot (RH-186)', () => {
  it('survive buildOfflineSnapshot and a readValidSnapshot round trip', () => {
    const snapshot = snapshotWith([PRESET, CAPO])
    expect(snapshot.songs[0].customFields).toEqual([PRESET, CAPO])
    const read = readValidSnapshot(JSON.parse(JSON.stringify(snapshot)))
    expect(read?.songs[0].customFields).toEqual([PRESET, CAPO])
  })

  it('validates a song captured without them (before RH-186)', () => {
    const read = readValidSnapshot(withStored(undefined))
    expect(read).not.toBeNull()
    expect(read!.songs[0].customFields).toBeUndefined()
  })

  it('refuses a present customFields that is not an array of { fieldId, name, value }', () => {
    for (const bad of [
      'Lead 3B',
      null,
      [7],
      [{ fieldId: 'f', name: 'Preset' }],
      [{ fieldId: 'f', name: 'Preset', value: 7 }],
      [{ fieldId: 1, name: 'Preset', value: null }],
      [{ fieldId: 'f', name: null, value: 'x' }],
    ]) {
      expect(readValidSnapshot(withStored(bad))).toBeNull()
    }
  })

  it('leaves OFFLINE_SCHEMA_VERSION at 6', () => {
    expect(OFFLINE_SCHEMA_VERSION).toBe(6)
  })
})
