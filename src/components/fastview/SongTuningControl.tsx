'use client'

import { useState } from 'react'
import { TUNING_PRESETS, type SongTuningController } from '@/lib/songTuning'

export interface SongTuningControlProps {
  tuning: SongTuningController
  /** The page's offline / no-owner-row signal: Edit is disabled, never hidden. */
  readOnly?: boolean
}

const BUTTON =
  'rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:hover:bg-transparent'

/**
 * The "Tuning:" line of the Song details header and its editor (RH-146,
 * mock option B): preset buttons that save in one tap, plus a custom box.
 * Presentational only; the write belongs to `useSongTuning`. When nothing
 * resolves and the page is read-only there is nothing to show, so it renders
 * nothing.
 */
export function SongTuningControl({ tuning, readOnly = false }: SongTuningControlProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (!tuning.tuning && readOnly) return null

  const open = editing && !readOnly
  const busy = tuning.updating

  const commit = (value: string) => {
    tuning.save(value).catch(() => undefined)
    setEditing(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-gray-600 flex items-center gap-2">
        {tuning.tuning && (
          <>
            <span className="font-medium">Tuning:</span>
            <span>{tuning.tuning}</span>
          </>
        )}
        <button
          type="button"
          className={BUTTON}
          disabled={readOnly || busy}
          aria-label={tuning.tuning ? 'Edit tuning' : 'Set tuning'}
          onClick={() => {
            setDraft(tuning.tuning ?? '')
            setEditing(true)
          }}
        >
          {tuning.tuning ? 'Edit' : 'Set tuning'}
        </button>
      </p>

      {open && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {TUNING_PRESETS.map((preset) => (
              <button key={preset} type="button" className={BUTTON} disabled={busy} onClick={() => commit(preset)}>
                {preset}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Custom tuning"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. Eb Ab Db Gb Bb Eb"
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
            <button type="button" className={BUTTON} disabled={busy} onClick={() => commit(draft)}>
              Save
            </button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => commit('')}>
              Clear
            </button>
            <button type="button" className={BUTTON} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
