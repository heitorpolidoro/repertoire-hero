import { describe, it, expect } from 'vitest'
import {
  canDeleteVersion,
  canSplit,
  countsPhrase,
  deleteDisabledReason,
  deleteVersionMessage,
  radiusSummary,
  mergeSongsMessage,
  mergeVersionsMessage,
  splitMessage,
  sumRadii,
  versionDisplayLabel,
} from '../catalogAdminPlan'

describe('countsPhrase', () => {
  it('pluralises each count on its own', () => {
    expect(countsPhrase({ repertoires: 1, playlists: 0 })).toBe('1 repertoire and 0 playlists')
    expect(countsPhrase({ repertoires: 2, playlists: 1 })).toBe('2 repertoires and 1 playlist')
  })
})

describe('canDeleteVersion', () => {
  it('is true only for a loaded 0/0 radius', () => {
    expect(canDeleteVersion({ status: 'ready', radius: { repertoires: 0, playlists: 0 } })).toBe(true)
    expect(canDeleteVersion({ status: 'ready', radius: { repertoires: 1, playlists: 0 } })).toBe(false)
    expect(canDeleteVersion({ status: 'ready', radius: { repertoires: 0, playlists: 2 } })).toBe(false)
    expect(canDeleteVersion({ status: 'loading' })).toBe(false)
    expect(canDeleteVersion({ status: 'error', message: 'x' })).toBe(false)
    expect(canDeleteVersion(undefined)).toBe(false)
  })
})

describe('radiusSummary and deleteDisabledReason', () => {
  it('formats the compact line', () => {
    expect(radiusSummary({ repertoires: 1, playlists: 2 })).toBe('1 repertoire · 2 playlists')
  })

  it('explains each disabled state and is null when delete is allowed', () => {
    expect(deleteDisabledReason({ status: 'ready', radius: { repertoires: 0, playlists: 0 } })).toBeNull()
    expect(deleteDisabledReason({ status: 'loading' })).toMatch(/loading/)
    expect(deleteDisabledReason(undefined)).toMatch(/loading/)
    expect(deleteDisabledReason({ status: 'error', message: 'x' })).toMatch(/could not/)
    expect(deleteDisabledReason({ status: 'ready', radius: { repertoires: 1, playlists: 0 } })).toMatch(
      /referenced/,
    )
  })
})

describe('canSplit', () => {
  it('needs at least one chosen version and never all of them', () => {
    expect(canSplit(0, 3)).toBe(false)
    expect(canSplit(1, 3)).toBe(true)
    expect(canSplit(2, 3)).toBe(true)
    expect(canSplit(3, 3)).toBe(false)
  })
})

describe('sumRadii', () => {
  it('adds both counts', () => {
    expect(
      sumRadii([
        { repertoires: 1, playlists: 2 },
        { repertoires: 3, playlists: 0 },
      ]),
    ).toEqual({ repertoires: 4, playlists: 2 })
    expect(sumRadii([])).toEqual({ repertoires: 0, playlists: 0 })
  })
})

describe('versionDisplayLabel', () => {
  it('prefers the label, then the album, then Original', () => {
    expect(versionDisplayLabel({ label: 'Live', albumName: 'A' })).toBe('Live')
    expect(versionDisplayLabel({ label: null, albumName: 'A' })).toBe('A')
    expect(versionDisplayLabel({ label: '', albumName: null })).toBe('Original')
  })
})

describe('messages', () => {
  const radius = { repertoires: 2, playlists: 1 }

  it('names source, target, counts and the winner rule for a version merge', () => {
    const msg = mergeVersionsMessage('Live', 'Studio', radius)
    expect(msg).toContain('Live')
    expect(msg).toContain('Studio')
    expect(msg).toContain('2 repertoires and 1 playlist')
    expect(msg).toContain('Studio row wins')
  })

  it('says "up to" for a split and counts the versions', () => {
    const msg = splitMessage(2, radius, 'a new song')
    expect(msg).toContain('2 versions')
    expect(msg).toContain('up to 2 repertoires and 1 playlist')
    expect(splitMessage(1, radius, 'x')).toContain('1 version ')
  })

  it('names both songs and the counts for a song merge', () => {
    const msg = mergeSongsMessage('Bad', 'Bad (dup)', radius)
    expect(msg).toContain('Bad')
    expect(msg).toContain('Bad (dup)')
    expect(msg).toContain('2 repertoires and 1 playlist')
  })

  it('states the zero counts for a delete', () => {
    expect(deleteVersionMessage('Live')).toContain('0 repertoires and 0 playlists reference this version')
  })
})
