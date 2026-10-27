'use client'

import type { ToastTone } from '@/lib/uiTones'
import { CUSTOM_FIELD_VALUE_MAX } from '@/lib/customFieldRules'
import {
  useSongCustomFields,
  type SongCustomFieldsActions,
  type SongCustomFieldsController,
} from '@/hooks/useSongCustomFields'
import type { CustomFieldEntry } from '@/types/customField'

export interface CustomFieldsSectionProps {
  versionId: string
  /** Injected by the page (F21); module-level so its identity is stable. */
  actions: SongCustomFieldsActions
  /**
   * Offline only. A value needs no owner row and no band role (RH-186), so the
   * page passes `isOffline` here, never its own `readOnly`.
   */
  readOnly: boolean
  notify: (message: string, tone: ToastTone) => void
}

const BUTTON =
  'rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:hover:bg-transparent'

function FieldValue({ value }: { value: string | null }) {
  return value ? <span>{value}</span> : <span className="text-gray-400 italic">Not set</span>
}

function FieldEditor({ entry, fields }: { entry: CustomFieldEntry; fields: SongCustomFieldsController }) {
  const busy = fields.saving
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm text-gray-600 flex items-center gap-2">
        <span className="font-medium">{entry.name}:</span> <FieldValue value={entry.value} />
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label={`${entry.name} value`}
          value={fields.draft}
          maxLength={CUSTOM_FIELD_VALUE_MAX}
          onChange={(e) => fields.setDraft(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
        <button type="button" className={BUTTON} disabled={busy} onClick={() => void fields.submit()}>
          Save
        </button>
        <button type="button" className={BUTTON} disabled={busy} onClick={() => void fields.clear()}>
          Clear
        </button>
        <button type="button" className={BUTTON} disabled={busy} onClick={fields.cancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * The user's own custom fields under the song header (RH-186), with its
 * controller, as `AudioLibrarySection` does. With no definitions it renders
 * nothing; read-only (offline) it shows only the filled fields, each with its
 * Edit disabled, and nothing when none is filled.
 */
export function CustomFieldsSection({ versionId, actions, readOnly, notify }: CustomFieldsSectionProps) {
  const fields = useSongCustomFields({ versionId, actions, notify })
  const visible = readOnly ? fields.entries.filter((entry) => entry.value !== null) : fields.entries
  if (visible.length === 0) return null

  return (
    <section aria-label="Custom fields" className="flex flex-col gap-1.5">
      {visible.map((entry) => {
        if (!readOnly && fields.editingFieldId === entry.fieldId) {
          return <FieldEditor key={entry.fieldId} entry={entry} fields={fields} />
        }
        const label = entry.value ? 'Edit' : 'Set'
        return (
          <p key={entry.fieldId} className="text-sm text-gray-600 flex items-center gap-2">
            <span className="font-medium">{entry.name}:</span> <FieldValue value={entry.value} />
            <button
              type="button"
              className={BUTTON}
              aria-label={`${label} ${entry.name}`}
              disabled={readOnly || fields.saving}
              onClick={() => fields.openEditor(entry.fieldId)}
            >
              {label}
            </button>
          </p>
        )
      })}
    </section>
  )
}
