'use client'

import {
  NOTE_INDEXES,
  filledNoteCount,
  noteTapLabel,
  statusAfterNoteTap,
  statusLabel,
} from '@/lib/statusNotes'
import type { SongStatus } from '@/types/database'

/**
 * RH-102 — the mastery control: four quarter notes and the stage name beside
 * them. It is cross-area (the dashboard row, the playlist row and Fast View all
 * render it), so it lives in `ui/`.
 *
 * Note *i* is filled when the status has reached stage *i*, and pressing one
 * writes its stage directly — upwards or downwards. Pressing the note that is
 * already current drops one stage, which from the first note clears the status.
 * Nothing cycles, so no tap can take a mastered row back to unassessed.
 *
 * The control is monochrome at every status: a filled note is `text-gray-900`,
 * an unfilled note `text-gray-400` and the stage name `text-gray-700`
 * (`text-gray-400` while unassessed). The glyphs paint from `currentColor`
 * only, so those three classes are the whole colour surface and nothing here
 * reads a per-stage colour.
 *
 * It renders four `<button>` elements in **every** state, so the DOM never
 * changes shape: `readOnly` (this viewer may not write this status) and `busy`
 * (a write is in flight) each add `disabled` and drop the hover affordance, and
 * nothing else. A disabled button keeps its accessible name, which is the whole
 * point of naming it after the outcome.
 */

/** The row size shares its width with the cover, title and artist; `stage` is the Fast View target. */
export type StatusNotesSize = 'row' | 'stage'

/** Glyph height in px — the two sizes the spec allows, and no third. */
const NOTE_HEIGHT_PX: Record<StatusNotesSize, number> = { row: 17, stage: 32 }

/**
 * The stage name's slot is a fixed width per size, so the notes keep the same
 * horizontal position whether the word is `Unknown` or `Practicing`.
 */
const LABEL_CLASS: Record<StatusNotesSize, string> = {
  row: 'w-[4.75rem] text-[11px]',
  stage: 'w-[7rem] text-base',
}

const GROUP_CLASS: Record<StatusNotesSize, string> = {
  row: 'gap-px',
  stage: 'gap-1',
}

export interface StatusNotesProps {
  status: SongStatus
  /** The status the tap asks for. The caller owns the write and its roll-back. */
  onChange: (status: SongStatus) => void
  size?: StatusNotesSize
  /** A permission: this viewer may not write this status (e.g. a non-admin band member). */
  readOnly?: boolean
  /** A write in flight. Independent of `readOnly`; either one disables the notes. */
  busy?: boolean
}

export function StatusNotes({
  status,
  onChange,
  size = 'row',
  readOnly = false,
  busy = false,
}: StatusNotesProps) {
  const filled = filledNoteCount(status)
  const locked = readOnly || busy
  const height = NOTE_HEIGHT_PX[size]

  return (
    <div
      role="group"
      aria-label="Mastery status"
      aria-busy={busy}
      className={`flex shrink-0 items-center ${GROUP_CLASS[size]}`}
    >
      {NOTE_INDEXES.map((index) => {
        const isFilled = index < filled
        return (
          <button
            key={index}
            type="button"
            disabled={locked}
            aria-pressed={isFilled}
            aria-label={noteTapLabel(status, index)}
            onClick={() => onChange(statusAfterNoteTap(status, index))}
            className={`flex shrink-0 items-center justify-center rounded p-0.5 focus:outline-none focus:ring-2 focus:ring-gray-400 ${
              isFilled ? 'text-gray-900' : 'text-gray-400'
            } ${locked ? 'cursor-default' : 'hover:opacity-60 transition-opacity'}`}
          >
            <svg
              viewBox="0 0 12 20"
              height={height}
              width={Math.round(height * 0.6)}
              aria-hidden="true"
              focusable="false"
            >
              {/* Stem, then notehead — both from `currentColor`. */}
              <path d="M8.1 2.2h1.3v12.2H8.1z" fill="currentColor" />
              <ellipse
                cx="4.9"
                cy="14.6"
                rx="4.3"
                ry="3.1"
                transform="rotate(-20 4.9 14.6)"
                fill={isFilled ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth={isFilled ? 0 : 1.4}
              />
            </svg>
          </button>
        )
      })}
      <span
        data-status-label
        className={`${LABEL_CLASS[size]} ml-1 shrink-0 truncate font-medium ${
          status === 'unknown' ? 'text-gray-400' : 'text-gray-700'
        }`}
      >
        {statusLabel(status)}
      </span>
    </div>
  )
}
