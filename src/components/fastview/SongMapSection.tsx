'use client'

import { ConfirmPanel } from '@/components/ui/ConfirmPanel'
import type { SongMapController } from '@/lib/songMap'

export interface SongMapSectionProps {
  controller: SongMapController
  /** The page's offline / no-owner-row signal: every control is disabled, never hidden. */
  readOnly?: boolean
}

const BUTTON =
  'rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:hover:bg-transparent'
const INPUT = 'rounded-md border border-gray-300 px-2 py-1 text-sm disabled:opacity-50'

function barsLabel(bars: number): string {
  return `${bars} ${bars === 1 ? 'bar' : 'bars'}`
}

function MapReadView({ controller }: { controller: SongMapController }) {
  const sections = controller.map?.sections ?? []
  if (sections.length === 0) return <p className="text-sm text-gray-500">No map yet</p>

  return (
    <ol className="flex flex-col gap-1">
      {sections.map((section, index) => (
        // Sections have no id; order is identity, and this list is read-only.
        <li key={index} className="flex flex-wrap items-baseline gap-2 text-sm text-gray-800">
          <span className="font-medium">{section.name}</span>
          {section.bars !== null && <span className="text-gray-500">{barsLabel(section.bars)}</span>}
          {section.note && <span className="text-gray-600">{section.note}</span>}
        </li>
      ))}
    </ol>
  )
}

function MapEditor({ controller, readOnly }: { controller: SongMapController; readOnly: boolean }) {
  const busy = controller.updating
  const locked = readOnly || busy
  const last = controller.draft.length - 1

  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-2">
        {controller.draft.map((section, index) => {
          const n = index + 1
          return (
            <li key={section.id} className="flex flex-wrap items-center gap-2">
              <input
                aria-label={`Section ${n} name`}
                value={section.name}
                disabled={locked}
                placeholder="Verse"
                onChange={(e) => controller.editSection(index, { name: e.target.value })}
                className={INPUT}
              />
              <input
                aria-label={`Section ${n} bars`}
                value={section.bars}
                disabled={locked}
                inputMode="numeric"
                placeholder="Bars"
                onChange={(e) => controller.editSection(index, { bars: e.target.value })}
                className={`${INPUT} w-16`}
              />
              <input
                aria-label={`Section ${n} note`}
                value={section.note}
                disabled={locked}
                placeholder="Note"
                onChange={(e) => controller.editSection(index, { note: e.target.value })}
                className={INPUT}
              />
              <button type="button" className={BUTTON} aria-label={`Move section ${n} up`} disabled={locked || index === 0} onClick={() => controller.moveSection(index, -1)}>
                &uarr;
              </button>
              <button type="button" className={BUTTON} aria-label={`Move section ${n} down`} disabled={locked || index === last} onClick={() => controller.moveSection(index, 1)}>
                &darr;
              </button>
              <button type="button" className={BUTTON} aria-label={`Remove section ${n}`} disabled={locked} onClick={() => controller.removeSection(index)}>
                Remove
              </button>
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BUTTON} disabled={locked} onClick={controller.addSection}>
          Add section
        </button>
        <button type="button" className={BUTTON} disabled={locked} onClick={() => void controller.save()} aria-label="Save map">
          Save
        </button>
        <button type="button" className={BUTTON} disabled={busy} onClick={controller.cancelEdit}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * The "Map" section of Fast View (RH-118): the resolved sections, an editor
 * with add / remove / rename / reorder, and "Use the original", which clears
 * the owner's override after a confirmation. Presentational only; every write
 * belongs to `useSongMap`. Controls are disabled, never hidden, when the page
 * is read-only (offline, or the owner holds no row at this version).
 */
export function SongMapSection({ controller, readOnly = false }: SongMapSectionProps) {
  const hasMap = (controller.map?.sections.length ?? 0) > 0

  return (
    <section aria-label="Map" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Map</h2>
          {controller.overridden && (
            <span className="text-[9px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
              Your map
            </span>
          )}
        </div>
        {!controller.editing && (
          <div className="flex items-center gap-2">
            {controller.overridden && !controller.confirmingReset && (
              <button type="button" className={BUTTON} disabled={readOnly || controller.updating} onClick={controller.requestReset}>
                Use the original
              </button>
            )}
            <button type="button" className={BUTTON} disabled={readOnly || controller.updating} onClick={controller.startEdit}>
              {hasMap ? 'Edit map' : 'Add map'}
            </button>
          </div>
        )}
      </div>

      {controller.confirmingReset && !controller.editing && (
        <ConfirmPanel
          message="Use the original map? Your own map for this song will be removed."
          confirmLabel="Use the original"
          tone="warning"
          busy={controller.updating}
          onConfirm={() => void controller.confirmReset()}
          onCancel={controller.cancelReset}
        />
      )}

      {controller.editing ? <MapEditor controller={controller} readOnly={readOnly} /> : <MapReadView controller={controller} />}
    </section>
  )
}
