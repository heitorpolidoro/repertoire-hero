/**
 * RH-69 — the pure tag decisions the two editing sites of `/playlists/[id]`
 * used to take inline, and took differently: the playlist bar stripped trailing
 * commas, the song row did not.
 *
 * This file carries no environment directive on purpose — `src/lib/tagEditor.ts`
 * imports no DOM API, so it runs in the default node environment.
 */

import { describe, it, expect } from 'vitest'
import { addTag, hasTag, normalizeTag, removeTag } from '@/lib/tagEditor'

describe('normalizeTag', () => {
  it('trims the surrounding whitespace and lowercases the tag', () => {
    expect(normalizeTag('  Encore  ')).toBe('encore')
    expect(normalizeTag('ENCORE')).toBe('encore')
  })

  it('strips every trailing comma and the whitespace behind it', () => {
    expect(normalizeTag('rock,')).toBe('rock')
    expect(normalizeTag('Rock ,,,')).toBe('rock')
    expect(normalizeTag('  rock,,  ')).toBe('rock')
  })

  it('normalises a tag of only whitespace and commas to the empty string', () => {
    expect(normalizeTag('   ')).toBe('')
    expect(normalizeTag(',,,')).toBe('')
    expect(normalizeTag('')).toBe('')
  })
})

describe('hasTag', () => {
  it('reports whether the list already carries the tag', () => {
    expect(hasTag(['encore', 'fast'], 'fast')).toBe(true)
    expect(hasTag(['encore', 'fast'], 'slow')).toBe(false)
    expect(hasTag([], 'encore')).toBe(false)
  })
})

describe('addTag', () => {
  it('appends the normalised tag to the list', () => {
    expect(addTag(['encore'], '  Fast ')).toEqual(['encore', 'fast'])
    expect(addTag([], 'encore')).toEqual(['encore'])
  })

  it('returns null when the normalised tag is empty', () => {
    expect(addTag(['encore'], '   ')).toBeNull()
    expect(addTag(['encore'], ',,')).toBeNull()
  })

  it('returns null when the list already carries the tag', () => {
    expect(addTag(['encore', 'fast'], 'fast')).toBeNull()
  })

  it('treats a tag that differs only in case or trailing commas as already present', () => {
    expect(addTag(['encore'], 'ENCORE')).toBeNull()
    expect(addTag(['encore'], 'Encore,,')).toBeNull()
  })

  it('does not mutate the list it appends to', () => {
    const tags = ['encore']
    const next = addTag(tags, 'fast')

    expect(tags).toEqual(['encore'])
    expect(next).not.toBe(tags)
  })
})

describe('removeTag', () => {
  it('removes the tag and leaves the other tags in their order', () => {
    expect(removeTag(['encore', 'fast', 'slow'], 'fast')).toEqual(['encore', 'slow'])
  })

  it('returns an equal list when the tag is not there', () => {
    expect(removeTag(['encore', 'fast'], 'missing')).toEqual(['encore', 'fast'])
  })

  it('does not mutate the list it removes from', () => {
    const tags = ['encore', 'fast']
    const next = removeTag(tags, 'fast')

    expect(tags).toEqual(['encore', 'fast'])
    expect(next).not.toBe(tags)
  })
})
