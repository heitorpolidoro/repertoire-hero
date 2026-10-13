import { describe, it, expect } from 'vitest'
import {
  TUNING_PRESETS,
  isTuningPreset,
  normalizeTuning,
  tuningSavedMessage,
  withTuning,
} from '@/lib/songTuning'
import type { ResolvedSongEntry } from '@/types/database'

describe('normalizeTuning', () => {
  it('trims the value', () => {
    expect(normalizeTuning('  Drop D  ')).toBe('Drop D')
  })

  it('turns empty and whitespace-only input into null', () => {
    expect(normalizeTuning('')).toBeNull()
    expect(normalizeTuning('   \t ')).toBeNull()
  })
})

describe('isTuningPreset', () => {
  it('matches a preset and nothing else', () => {
    expect(isTuningPreset(TUNING_PRESETS[0])).toBe(true)
    expect(isTuningPreset('Eb Ab Db Gb Bb Eb (custom)')).toBe(false)
    expect(isTuningPreset(null)).toBe(false)
  })

  it('has no duplicate preset', () => {
    expect(new Set(TUNING_PRESETS).size).toBe(TUNING_PRESETS.length)
  })
})

describe('tuningSavedMessage', () => {
  it('names the saved value or the clearing', () => {
    expect(tuningSavedMessage('Drop D')).toBe('Tuning set to Drop D')
    expect(tuningSavedMessage(null)).toBe('Tuning cleared')
  })
})

describe('withTuning', () => {
  const entry = { ownerRowId: 'r', tuning: 'Standard' } as ResolvedSongEntry

  it('returns a new entry carrying the tuning', () => {
    expect(withTuning(entry, 'Drop D')?.tuning).toBe('Drop D')
    expect(entry.tuning).toBe('Standard')
  })

  it('keeps null as null', () => {
    expect(withTuning(null, 'Drop D')).toBeNull()
  })
})
