import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ToastTone } from '@/lib/uiTones'
import type { CustomFieldEntry } from '@/types/customField'

/** The two custom field Server Actions, injected so `src/hooks` never imports the App Router tree (F21). */
export interface SongCustomFieldsActions {
  getCustomFieldValues: (versionId: string) => Promise<CustomFieldEntry[]>
  setCustomFieldValue: (fieldId: string, versionId: string, value: string) => Promise<string | null>
}

export interface UseSongCustomFieldsOptions {
  /** The route's `song_versions.id`: a value is keyed by the version, never by an owner row. */
  versionId: string
  actions: SongCustomFieldsActions
  /** `showToast` from the page's `useToast`. */
  notify: (message: string, tone: ToastTone) => void
}

export interface SongCustomFieldsController {
  /** The user's definitions with their value on this version; `[]` until loaded. */
  entries: CustomFieldEntry[]
  /** The field whose inline editor is open, or `null`. */
  editingFieldId: string | null
  draft: string
  saving: boolean
  openEditor: (fieldId: string) => void
  setDraft: (draft: string) => void
  cancel: () => void
  /** Saves the draft; a blank draft clears the value. */
  submit: () => Promise<void>
  /** Saves a blank value, which deletes it. */
  clear: () => Promise<void>
}

interface Loaded {
  versionId: string
  entries: CustomFieldEntry[]
}

interface Editing {
  versionId: string
  fieldId: string
}

function messageOf(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : undefined
  return message || fallback
}

/**
 * Fast View's custom fields controller (RH-186): the user's own values on the
 * route's version and the inline editor that writes one.
 *
 * A separate per-version read, **not** part of the RH-134 song window: the
 * window cache holds nothing about custom fields, so a save goes through no
 * `afterWrite` / `invalidateCurrent`. Everything is tagged with the version it
 * belongs to, so an answer (or a failure) for a version no longer on screen is
 * discarded and the previous version's values never show on the next one.
 */
export function useSongCustomFields({
  versionId,
  actions,
  notify,
}: UseSongCustomFieldsOptions): SongCustomFieldsController {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let current = true
    actions.getCustomFieldValues(versionId).then(
      (entries) => {
        if (current) setLoaded({ versionId, entries })
      },
      (error: unknown) => {
        // A failed load leaves whatever was shown; the section is optional chrome.
        if (current) notify(messageOf(error, 'Failed to load custom fields'), 'error')
      },
    )
    return () => {
      current = false
    }
  }, [actions, notify, versionId])

  const entries = useMemo(() => (loaded?.versionId === versionId ? loaded.entries : []), [loaded, versionId])
  const editingFieldId = editing?.versionId === versionId ? editing.fieldId : null

  const openEditor = useCallback(
    (fieldId: string) => {
      setEditing({ versionId, fieldId })
      setDraft(entries.find((entry) => entry.fieldId === fieldId)?.value ?? '')
    },
    [entries, versionId],
  )

  const cancel = useCallback(() => setEditing(null), [])

  const save = useCallback(
    async (value: string) => {
      if (!editingFieldId) return
      const fieldId = editingFieldId
      const target = versionId
      setSaving(true)
      try {
        const stored = await actions.setCustomFieldValue(fieldId, target, value)
        setLoaded((prev) =>
          prev?.versionId === target
            ? {
                ...prev,
                entries: prev.entries.map((entry) => (entry.fieldId === fieldId ? { ...entry, value: stored } : entry)),
              }
            : prev,
        )
        setEditing((prev) => (prev?.versionId === target && prev.fieldId === fieldId ? null : prev))
      } catch (error) {
        notify(messageOf(error, 'Failed to save custom field'), 'error')
      } finally {
        setSaving(false)
      }
    },
    [actions, editingFieldId, notify, versionId],
  )

  const submit = useCallback(() => save(draft), [draft, save])
  const clear = useCallback(() => save(''), [save])

  return { entries, editingFieldId, draft, saving, openEditor, setDraft, cancel, submit, clear }
}
