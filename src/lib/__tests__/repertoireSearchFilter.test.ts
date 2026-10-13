/**
 * RH-151 — the dashboard's repertoire-aware filter over merged search rows.
 */

import { describe, it, expect } from 'vitest'
import { heldRepertoire, withoutHeldRows } from '@/lib/repertoireSearchFilter'
import { songIdentityKey } from '@/lib/songTitle'
import type { SearchVersionCandidate, SongSearchRow } from '@/lib/songSearchMerge'
import type { Repertoire } from '@/types/database'

function candidate(overrides: Partial<SearchVersionCandidate>): SearchVersionCandidate {
  return {
    versionId: null,
    spotifyTrackId: null,
    rawTitle: 'Bad',
    albumName: null,
    albumType: null,
    releaseDate: null,
    label: null,
    durationSeconds: null,
    createdAt: null,
    coverUrl: null,
    spotifyUrl: null,
    ...overrides,
  }
}

function row(versions: SearchVersionCandidate[], songId: string | null = 'song-1'): SongSearchRow {
  return {
    id: songIdentityKey('Bad', 'Michael Jackson'),
    title: 'Bad',
    artist: 'Michael Jackson',
    coverUrl: null,
    album: null,
    songId,
    versions,
  }
}

const HELD_ENTRY = {
  version_id: 'v-held',
  song: { title: 'Bad', artist: 'Michael Jackson' },
} as unknown as Repertoire

const catalogHeld = candidate({ versionId: 'v-held' })
const catalogFree = candidate({ versionId: 'v-free' })
const spotifyOnly = candidate({ spotifyTrackId: 'sp-1' })

describe('heldRepertoire', () => {
  it('collects version ids and song keys, skipping entries without either', () => {
    const held = heldRepertoire([
      HELD_ENTRY,
      { version_id: '', song: undefined } as unknown as Repertoire,
    ])
    expect([...held.versionIds]).toEqual(['v-held'])
    expect([...held.songKeys]).toEqual([songIdentityKey('Bad', 'Michael Jackson')])
  })
})

describe('withoutHeldRows', () => {
  const held = heldRepertoire([HELD_ENTRY])

  it('drops a held catalog version and keeps an unheld sibling of the same song', () => {
    const result = withoutHeldRows([row([catalogHeld, catalogFree])], held)
    expect(result).toHaveLength(1)
    expect(result[0].versions.map((v) => v.versionId)).toEqual(['v-free'])
  })

  it('drops a row whose only catalog version is held', () => {
    expect(withoutHeldRows([row([catalogHeld])], held)).toEqual([])
  })

  it('drops the Spotify-only leftover of a held song', () => {
    expect(withoutHeldRows([row([catalogHeld, spotifyOnly])], held)).toEqual([])
    expect(withoutHeldRows([row([spotifyOnly], null)], held)).toEqual([])
  })

  it('keeps a Spotify-only row for a song that is not held', () => {
    const other = { ...row([spotifyOnly], null), id: songIdentityKey('Thriller', 'Michael Jackson') }
    expect(withoutHeldRows([other], held)).toEqual([other])
  })

  it('keeps a version-less catalog row', () => {
    const versionLess = row([])
    expect(withoutHeldRows([versionLess], held)).toEqual([versionLess])
  })
})
