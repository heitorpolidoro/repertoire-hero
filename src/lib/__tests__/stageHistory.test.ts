import { describe, it, expect } from 'vitest'
import { isStageHistoryEntry, stageHistoryState } from '@/lib/stageHistory'

describe('stageHistoryState', () => {
  it('stageHistoryState marks the entry Stage Mode pushed', () => {
    expect(stageHistoryState()).toEqual({ stageMode: true })
  })
})

describe('isStageHistoryEntry', () => {
  it('isStageHistoryEntry recognises the entry Stage Mode pushed', () => {
    expect(isStageHistoryEntry(stageHistoryState())).toBe(true)
    // A richer entry that still carries the marker: the browser is free to add
    // its own keys to the state it hands back.
    expect(isStageHistoryEntry({ ...stageHistoryState(), idx: 3 })).toBe(true)
  })

  it('isStageHistoryEntry rejects null, undefined and an unrelated entry', () => {
    expect(isStageHistoryEntry(null)).toBe(false)
    expect(isStageHistoryEntry(undefined)).toBe(false)
    expect(isStageHistoryEntry({})).toBe(false)
    expect(isStageHistoryEntry({ stageMode: false })).toBe(false)
    expect(isStageHistoryEntry({ stageMode: 'yes' })).toBe(false)
    expect(isStageHistoryEntry('stageMode')).toBe(false)
  })
})
