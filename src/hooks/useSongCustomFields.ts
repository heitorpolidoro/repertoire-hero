import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ToastTone } from '@/lib/uiTones'
import { awaitSongWindow, cachedSong } from '@/lib/songWindow'
import type { CustomFieldEntry } from '@/types/customField'

/** The two custom field Server Actions, injected so `src/hooks` never imports the App Router tree (F21). */
export interface SongCustomFieldsActions {
  getCustomFieldValues: (versionId: string) => Promise<CustomFieldEntry[]>
  setCustomFieldValue: (fieldId: string, versionId: string, value: string) => Promise<string | null>
}

export interface UseSongCustomFieldsOptions {
  /** The route's `song_versions.id`: a value is keyed by the version, never by an owner row. */
  versionId: string
  /**
   * The page's `?bandId=`. It only addresses the window cache (RH-134): no
   * custom field read or write takes a band id, the values are the reader's own.
   */
  bandId?: string | null
  actions: SongCustomFieldsActions
  /** `showToast` from the page's `useToast`. */
  notify: (message: string, tone: ToastTone) => void
  /**
   * Called after a successful save or clear with the version the save was
   * started on, even if the route has moved on; never after a failed one.
   */
  onSaved?: (versionId: string) => void
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
 * Read through the RH-134 song window (RH-190): each window record carries the
 * signed-in user's `customFields`, so the hook waits for a window fetch already
 * filling its song and uses the cached copy, and only a miss calls
 * `getCustomFieldValues`. A cached song is answered from the first render for
 * its version, so the section never collapses and comes back. The cache is a
 * seed, not the source: once applied the entries live in this hook's state, so
 * another write dropping the cached copy does not empty the section. A
 * successful save calls `onSaved` with the version it was started on, which the
 * page wires to the window invalidation.
 *
 * Must be called in the page, after `useSongWindow`: effects run in call order,
 * so the window fetch is registered before this hook looks for it.
 *
 * Everything is tagged with the version it belongs to, so an answer (or a
 * failure) for a version no longer on screen is discarded and the previous
 * version's values never show on the next one.
 */
export function useSongCustomFields({
  versionId,
  bandId = null,
  actions,
  notify,
  onSaved,
}: UseSongCustomFieldsOptions): SongCustomFieldsController {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  // The first-render seed: a cached song is adopted while rendering, so the
  // first committed render for this version already carries its fields.
  if (loaded?.versionId !== versionId) {
    const cached = cachedSong(bandId, versionId)
    if (cached) setLoaded({ versionId, entries: cached.customFields })
  }

  useEffect(() => {
    let current = true
    const load = async () => {
      await awaitSongWindow(bandId, versionId)
      const cached = cachedSong(bandId, versionId)
      return cached ? cached.customFields : actions.getCustomFieldValues(versionId)
    }
    load().then(
      (entries) => {
        // What this version already holds - the seed, or a save on it - wins.
        if (current) setLoaded((prev) => (prev?.versionId === versionId ? prev : { versionId, entries }))
      },
      (error: unknown) => {
        // A failed load leaves whatever was shown; the section is optional chrome.
        if (current) notify(messageOf(error, 'Failed to load custom fields'), 'error')
      },
    )
    return () => {
      current = false
    }
  }, [actions, bandId, notify, versionId])

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
        onSaved?.(target)
      } catch (error) {
        notify(messageOf(error, 'Failed to save custom field'), 'error')
      } finally {
        setSaving(false)
      }
    },
    [actions, editingFieldId, notify, onSaved, versionId],
  )

  const submit = useCallback(() => save(draft), [draft, save])
  const clear = useCallback(() => save(''), [save])

  return { entries, editingFieldId, draft, saving, openEditor, setDraft, cancel, submit, clear }
}
