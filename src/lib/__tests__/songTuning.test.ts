import { describe, it, expect } from 'vitest'
import {
  TUNING_OFFSETS,
  canonicalTuning,
  formatTuningDisplay,
  normalizeTuning,
  parseCanonicalTuning,
  tuningPositionLabel,
  tuningReferenceStrings,
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

describe('canonicalTuning and parseCanonicalTuning', () => {
  it('round-trips all 16 canonical values through parse and canonical', () => {
    const seen = new Set<string>()
    for (const drop of [false, true]) {
      for (const offset of TUNING_OFFSETS) {
        const value = canonicalTuning(offset, drop)
        seen.add(value)
        expect(parseCanonicalTuning(value)).toEqual({ offset, drop })
      }
    }
    expect(seen.size).toBe(16)
  })

  it('parses custom, legacy, case-mismatched, and padded values as null', () => {
    expect(parseCanonicalTuning('DADGAD')).toBeNull()
    expect(parseCanonicalTuning('Half step down')).toBeNull()
    expect(parseCanonicalTuning('e')).toBeNull()
    expect(parseCanonicalTuning('Eb ')).toBeNull()
    expect(parseCanonicalTuning(null)).toBeNull()
  })
})

describe('tuningPositionLabel and tuningReferenceStrings', () => {
  it.each([
    { value: 'E', offset: 0, drop: false, label: 'E', ref: 'E A D G B E' },
    { value: 'Eb', offset: -1, drop: false, label: 'Eb (-0.5)', ref: 'Eb Ab Db Gb Bb Eb' },
    { value: 'Db', offset: -3, drop: false, label: 'Db (-1.5)', ref: 'Db Gb B E Ab Db' },
    { value: 'Bb', offset: -6, drop: false, label: 'Bb (-3)', ref: 'Bb Eb Ab Db F Bb' },
    { value: 'F', offset: 1, drop: false, label: 'F (+0.5)', ref: 'F Bb Eb Ab C F' },
    { value: 'B', offset: -5, drop: false, label: 'B (-2.5)', ref: 'B E A D Gb B' },
    { value: 'Drop D', offset: 0, drop: true, label: 'Drop D', ref: 'D A D G B E' },
    { value: 'Drop Db', offset: -1, drop: true, label: 'Drop Db (-0.5)', ref: 'Db Ab Db Gb Bb Eb' },
    { value: 'Drop Eb', offset: 1, drop: true, label: 'Drop Eb (+0.5)', ref: 'Eb Bb Eb Ab C F' },
    { value: 'Drop Ab', offset: -6, drop: true, label: 'Drop Ab (-3)', ref: 'Ab Eb Ab Db F Bb' },
  ] as const)('formats $value -> label "$label" and ref "$ref"', ({ value, offset, drop, label, ref }) => {
    expect(canonicalTuning(offset, drop)).toBe(value)
    expect(tuningPositionLabel(offset, drop)).toBe(label)
    expect(tuningReferenceStrings(offset, drop)).toBe(ref)
    expect(formatTuningDisplay(value)).toBe(label)
  })

  it('shows custom values as stored in formatTuningDisplay', () => {
    expect(formatTuningDisplay('DADGAD')).toBe('DADGAD')
  })
})

describe('tuningSavedMessage', () => {
  it('uses the label for a canonical value, raw text for custom, and cleared for null', () => {
    expect(tuningSavedMessage('Eb')).toBe('Tuning set to Eb (-0.5)')
    expect(tuningSavedMessage('Drop D')).toBe('Tuning set to Drop D')
    expect(tuningSavedMessage('DADGAD')).toBe('Tuning set to DADGAD')
    expect(tuningSavedMessage(null)).toBe('Tuning cleared')
  })
})

describe('withTuning', () => {
  const entry = { ownerRowId: 'r', tuning: 'E' } as ResolvedSongEntry

  it('returns a new entry carrying the tuning', () => {
    expect(withTuning(entry, 'Drop D')?.tuning).toBe('Drop D')
    expect(entry.tuning).toBe('E')
  })

  it('keeps null as null', () => {
    expect(withTuning(null, 'Drop D')).toBeNull()
  })
})

