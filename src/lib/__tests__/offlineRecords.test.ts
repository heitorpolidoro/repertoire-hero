/**
 * RH-193 — how much of a playlist's live entries this device holds.
 *
 * The count is over the page's live list, never over the stored list: a song
 * added online after the download raises the total and nothing else.
 */
import { describe, it, expect } from 'vitest'
import { liveOfflineCount } from '@/lib/offlineRecords'
import { songRecordId } from '@/lib/offlineSongRecord'

function stored(entries: Array<[string, number]>, bandId: string | null): Map<string, number> {
  return new Map(entries.map(([versionId, bytes]) => [songRecordId(versionId, bandId), bytes]))
}

describe('liveOfflineCount', () => {
  it('counts the live entries stored in the playlist owner context and sums their bytes', () => {
    const count = liveOfflineCount(['v1', 'v2', 'v3'], 'band-1', stored([['v1', 100], ['v3', 50]], 'band-1'))

    expect(count).toEqual({ storedVersionIds: new Set(['v1', 'v3']), stored: 2, total: 3, bytes: 150 })
  })

  it('ignores a copy of the same version stored in another owner context', () => {
    const count = liveOfflineCount(['v1'], 'band-1', stored([['v1', 100]], null))

    expect(count).toEqual({ storedVersionIds: new Set(), stored: 0, total: 1, bytes: 0 })
  })

  it('ignores stored songs that are not live entries, and a new live entry raises only the total', () => {
    const songs = stored([['v1', 10], ['gone', 99]], null)

    expect(liveOfflineCount(['v1'], null, songs)).toMatchObject({ stored: 1, total: 1, bytes: 10 })
    expect(liveOfflineCount(['v1', 'v-new'], null, songs)).toMatchObject({ stored: 1, total: 2, bytes: 10 })
  })
})
