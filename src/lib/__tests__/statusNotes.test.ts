/**
 * RH-102 — the pure decisions behind the four-note mastery control.
 *
 * The control itself is a `<div role="group">` of four buttons; everything it
 * has to decide — how many notes are filled, which stage a note stands for,
 * what a tap on it produces and how that tap is named — is decided here, with
 * no React and no DOM.
 */

import { describe, it, expect } from 'vitest'
import {
  NOTE_INDEXES,
  filledNoteCount,
  noteStatus,
  noteTapLabel,
  statusAfterNoteTap,
  statusLabel,
} from '@/lib/statusNotes'
import { STATUS_ORDER } from '@/lib/statusConfig'
import type { SongStatus } from '@/types/database'

describe('NOTE_INDEXES', () => {
  it('is the four note positions, one per mastery stage', () => {
    expect(NOTE_INDEXES).toEqual([0, 1, 2, 3])
    expect(NOTE_INDEXES).toHaveLength(STATUS_ORDER.length)
  })
})

describe('filledNoteCount', () => {
  it('fills no note for an unassessed row', () => {
    expect(filledNoteCount('unknown')).toBe(0)
  })

  it('fills one note per stage reached', () => {
    expect(filledNoteCount('learning')).toBe(1)
    expect(filledNoteCount('practicing')).toBe(2)
    expect(filledNoteCount('polishing')).toBe(3)
    expect(filledNoteCount('mastered')).toBe(4)
  })
})

describe('noteStatus', () => {
  it('maps each note index to its mastery stage', () => {
    expect(NOTE_INDEXES.map(noteStatus)).toEqual([
      'learning',
      'practicing',
      'polishing',
      'mastered',
    ])
  })
})

describe('statusAfterNoteTap', () => {
  it('sets the tapped stage when the note is not the current one, upwards', () => {
    expect(statusAfterNoteTap('unknown', 0)).toBe('learning')
    expect(statusAfterNoteTap('unknown', 3)).toBe('mastered')
    expect(statusAfterNoteTap('learning', 2)).toBe('polishing')
    expect(statusAfterNoteTap('practicing', 3)).toBe('mastered')
  })

  it('sets the tapped stage when the note is not the current one, downwards', () => {
    expect(statusAfterNoteTap('mastered', 0)).toBe('learning')
    expect(statusAfterNoteTap('mastered', 1)).toBe('practicing')
    expect(statusAfterNoteTap('polishing', 0)).toBe('learning')
  })

  it('drops one stage on a tap on the note that is already current', () => {
    expect(statusAfterNoteTap('practicing', 1)).toBe('learning')
    expect(statusAfterNoteTap('polishing', 2)).toBe('practicing')
    expect(statusAfterNoteTap('mastered', 3)).toBe('polishing')
  })

  it('clears the status on a tap on the first note while it is current', () => {
    expect(statusAfterNoteTap('learning', 0)).toBe('unknown')
  })

  it('never wraps past the top: no tap on a mastered row produces unknown', () => {
    for (const index of NOTE_INDEXES) {
      expect(statusAfterNoteTap('mastered', index)).not.toBe('unknown')
    }
  })
})

describe('noteTapLabel', () => {
  it('names the outcome of a note that is not current', () => {
    expect(noteTapLabel('unknown', 0)).toBe('Set status to Learning')
    expect(noteTapLabel('unknown', 2)).toBe('Set status to Polishing')
    expect(noteTapLabel('mastered', 1)).toBe('Set status to Practicing')
  })

  it('names the drop of the current note', () => {
    expect(noteTapLabel('practicing', 1)).toBe('Drop status to Learning')
    expect(noteTapLabel('polishing', 2)).toBe('Drop status to Practicing')
    expect(noteTapLabel('mastered', 3)).toBe('Drop status to Polishing')
  })

  it('names the clearing tap on the first note of a learning row', () => {
    expect(noteTapLabel('learning', 0)).toBe('Clear status')
  })

  it('gives every note of every status a distinct, non-empty name', () => {
    for (const status of ['unknown', 'learning', 'practicing', 'polishing', 'mastered'] as const) {
      const names = NOTE_INDEXES.map((index) => noteTapLabel(status, index))
      expect(new Set(names).size).toBe(4)
      for (const name of names) expect(name.length).toBeGreaterThan(0)
    }
  })
})

describe('statusLabel', () => {
  it('falls back to the raw value for a status with no config, as the Toast does', () => {
    expect(statusLabel('retired' as SongStatus)).toBe('retired')
  })

  it('is the stage name the control shows beside the notes', () => {
    expect(statusLabel('unknown')).toBe('Unknown')
    expect(statusLabel('learning')).toBe('Learning')
    expect(statusLabel('practicing')).toBe('Practicing')
    expect(statusLabel('polishing')).toBe('Polishing')
    expect(statusLabel('mastered')).toBe('Mastered')
  })
})
