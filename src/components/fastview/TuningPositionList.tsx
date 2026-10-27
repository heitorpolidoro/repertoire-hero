'use client'

import { useState } from 'react'
import {
  TUNING_OFFSETS,
  canonicalTuning,
  parseCanonicalTuning,
  tuningPositionLabel,
  tuningReferenceStrings,
} from '@/lib/songTuning'

export interface TuningPositionListProps {
  currentTuning: string | null
  disabled: boolean
  onSelect: (canonical: string) => void
}

/**
 * The Drop toggle and the 8 half-step position buttons with 6-string reference
 * lines inside the Fast View tuning editor (RH-185).
 */
export function TuningPositionList({ currentTuning, disabled, onSelect }: TuningPositionListProps) {
  const [drop, setDrop] = useState(() => parseCanonicalTuning(currentTuning)?.drop ?? false)

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={drop} onChange={(e) => setDrop(e.target.checked)} />
        Drop (6th string one more whole step down)
      </label>
      <div className="flex flex-col gap-1">
        {TUNING_OFFSETS.map((offset) => {
          const value = canonicalTuning(offset, drop)
          const label = tuningPositionLabel(offset, drop)
          const selected = value === currentTuning
          const border = selected ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 hover:bg-gray-100'
          return (
            <button
              key={value}
              type="button"
              aria-label={label}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onSelect(value)}
              className={`w-full flex justify-between items-center rounded-md border px-3 py-2 text-sm text-gray-700 disabled:opacity-50 disabled:hover:bg-transparent ${border}`}
            >
              <span className="font-medium">{label}</span>
              <span className="font-mono text-xs text-gray-500">{tuningReferenceStrings(offset, drop)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
