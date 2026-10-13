import { describe, it, expect } from 'vitest'
import { formatDuration, versionLineText, versionYear } from '@/lib/songVersionLine'
import type { SearchVersionCandidate } from '@/lib/songSearchMerge'

function cand(overrides: Partial<SearchVersionCandidate> = {}): SearchVersionCandidate {
  return {
    versionId: 'v1',
    spotifyTrackId: null,
    rawTitle: 'Bad',
    albumName: 'Bad',
    albumType: 'album',
    releaseDate: '1987-08-31',
    label: null,
    durationSeconds: 257,
    createdAt: null,
    coverUrl: null,
    spotifyUrl: null,
    ...overrides,
  }
}

describe('formatDuration', () => {
  it('formats m:ss', () => {
    expect(formatDuration(257)).toBe('4:17')
    expect(formatDuration(61)).toBe('1:01')
  })
})

describe('versionYear', () => {
  it('takes the first four characters of YYYY, YYYY-MM and YYYY-MM-DD', () => {
    expect(versionYear('1987')).toBe('1987')
    expect(versionYear('1987-08')).toBe('1987')
    expect(versionYear('1987-08-31')).toBe('1987')
    expect(versionYear(null)).toBeNull()
  })
})

describe('versionLineText', () => {
  it('joins album, year and duration', () => {
    expect(versionLineText(cand())).toBe('Bad · 1987 · 4:17')
  })
  it('works for album only', () => {
    expect(versionLineText(cand({ releaseDate: null, durationSeconds: null }))).toBe('Bad')
  })
  it('omits a missing year with its separator', () => {
    expect(versionLineText(cand({ releaseDate: null }))).toBe('Bad · 4:17')
  })
  it('omits a missing duration with its separator', () => {
    expect(versionLineText(cand({ durationSeconds: null }))).toBe('Bad · 1987')
  })
  it('returns null when all three are missing', () => {
    expect(
      versionLineText(cand({ albumName: null, releaseDate: null, durationSeconds: null })),
    ).toBeNull()
  })
})
