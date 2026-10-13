/**
 * RH-170 - the pure half of the hand-picked selection: pick order, the built
 * queue, and the first Fast View href.
 */
import { describe, it, expect } from 'vitest'
import {
  buildPickedQueue,
  pickedFastViewHref,
  togglePick,
  PICKED_QUEUE_LABEL,
  type PickRow,
} from '../pickedSelection'

const ROWS: PickRow[] = [
  { versionId: 'a', title: 'Alpha', artist: 'AA' },
  { versionId: 'b', title: 'Beta', artist: null },
  { versionId: 'c', title: 'Gamma', artist: 'CC' },
]
const BY_ID = new Map(ROWS.map((r) => [r.versionId, r]))

describe('togglePick', () => {
  it('appends in tap order', () => {
    expect(togglePick(togglePick(togglePick([], 'c'), 'a'), 'b')).toEqual(['c', 'a', 'b'])
  })

  it('removes a picked id so later picks shift down, and a re-pick goes last', () => {
    const picks = ['c', 'a', 'b']
    const removed = togglePick(picks, 'c')
    expect(removed).toEqual(['a', 'b'])
    expect(togglePick(removed, 'c')).toEqual(['a', 'b', 'c'])
  })

  it('never mutates its input and never duplicates', () => {
    const picks = ['a']
    togglePick(picks, 'b')
    expect(picks).toEqual(['a'])
    expect(new Set(togglePick(togglePick(picks, 'b'), 'b')).size).toBe(togglePick(togglePick(picks, 'b'), 'b').length)
  })
})

describe('buildPickedQueue', () => {
  it('has entries of exactly versionId, title and artist in pick order', () => {
    const queue = buildPickedQueue(['b', 'a'], BY_ID, { type: 'personal' }, '/')
    expect(queue.entries).toEqual([
      { versionId: 'b', title: 'Beta', artist: null },
      { versionId: 'a', title: 'Alpha', artist: 'AA' },
    ])
    expect(Object.keys(queue.entries[0]).sort()).toEqual(['artist', 'title', 'versionId'])
  })

  it('carries owner, originHref and the label for personal and band', () => {
    expect(buildPickedQueue(['a'], BY_ID, { type: 'personal' }, '/')).toMatchObject({
      owner: { type: 'personal' },
      originHref: '/',
      label: PICKED_QUEUE_LABEL,
    })
    expect(buildPickedQueue(['a'], BY_ID, { type: 'band', bandId: 'b1' }, '/bands/b1')).toMatchObject({
      owner: { type: 'band', bandId: 'b1' },
      originHref: '/bands/b1',
      label: 'Hand-picked selection',
    })
  })

  it('skips a pick whose row is gone', () => {
    expect(buildPickedQueue(['zzz', 'a'], BY_ID, { type: 'personal' }, '/').entries.map((e) => e.versionId)).toEqual(['a'])
  })
})

describe('pickedFastViewHref', () => {
  it('opens the first entry, with bandId in band context', () => {
    const personal = buildPickedQueue(['c', 'a'], BY_ID, { type: 'personal' }, '/')
    expect(pickedFastViewHref(personal)).toBe('/songs/c/fast-view')
    const band = buildPickedQueue(['c', 'a'], BY_ID, { type: 'band', bandId: 'b1' }, '/bands/b1')
    expect(pickedFastViewHref(band)).toBe('/songs/c/fast-view?bandId=b1')
  })

  it('is null for an empty queue', () => {
    expect(pickedFastViewHref(buildPickedQueue([], BY_ID, { type: 'personal' }, '/'))).toBeNull()
  })
})
