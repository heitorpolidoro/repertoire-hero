import { useCallback, useEffect, useState } from 'react'
import type { CustomField } from '@/types/customField'

/** The five definition Server Actions, injected so `src/hooks` never imports the App Router tree (F21). */
export interface CustomFieldSettingsActions {
  listCustomFields: () => Promise<CustomField[]>
  createCustomField: (name: string) => Promise<CustomField>
  renameCustomField: (fieldId: string, name: string) => Promise<CustomField>
  moveCustomField: (fieldId: string, direction: 'up' | 'down') => Promise<void>
  deleteCustomField: (fieldId: string) => Promise<void>
}

export interface UseCustomFieldSettingsOptions {
  actions: CustomFieldSettingsActions
}

export interface CustomFieldSettingsController {
  /** `null` while loading and after a failed load: the list is unknown, not empty. */
  fields: CustomField[] | null
  /** The one inline error under the add form. */
  error: string | null
  busy: boolean
  newName: string
  setNewName: (name: string) => void
  add: () => Promise<void>
  renamingId: string | null
  renameDraft: string
  setRenameDraft: (name: string) => void
  startRename: (fieldId: string) => void
  cancelRename: () => void
  saveRename: () => Promise<void>
  move: (fieldId: string, direction: 'up' | 'down') => Promise<void>
  pendingDelete: CustomField | null
  requestDelete: (fieldId: string) => void
  cancelDelete: () => void
  confirmDelete: () => Promise<void>
}

export const CUSTOM_FIELDS_LOAD_ERROR = 'Could not load your custom fields.'

function messageOf(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : undefined
  return message || fallback
}

/**
 * The Settings "Custom fields" controller (RH-186): the user's definitions, the
 * add form, an inline rename, move up/down and a two-step delete. Every
 * successful write reloads the list, so what is shown is the saved order.
 */
export function useCustomFieldSettings({ actions }: UseCustomFieldSettingsOptions): CustomFieldSettingsController {
  const [fields, setFields] = useState<CustomField[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    actions.listCustomFields().then(
      (loaded) => {
        if (alive) setFields(loaded)
      },
      () => {
        if (alive) setError(CUSTOM_FIELDS_LOAD_ERROR)
      },
    )
    return () => {
      alive = false
    }
  }, [actions])

  /** Runs one write, then reloads; answers whether the write succeeded. */
  const run = useCallback(
    async (write: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true)
      setError(null)
      try {
        await write()
      } catch (err) {
        setError(messageOf(err, 'Failed to save custom fields'))
        setBusy(false)
        return false
      }
      try {
        setFields(await actions.listCustomFields())
      } catch {
        setError(CUSTOM_FIELDS_LOAD_ERROR)
      }
      setBusy(false)
      return true
    },
    [actions],
  )

  const add = useCallback(async () => {
    if (!newName.trim()) return
    if (await run(() => actions.createCustomField(newName))) setNewName('')
  }, [actions, newName, run])

  const startRename = useCallback(
    (fieldId: string) => {
      setRenamingId(fieldId)
      setRenameDraft(fields?.find((field) => field.id === fieldId)?.name ?? '')
      setPendingDeleteId(null)
      setError(null)
    },
    [fields],
  )

  const cancelRename = useCallback(() => setRenamingId(null), [])

  const saveRename = useCallback(async () => {
    if (!renamingId) return
    const fieldId = renamingId
    if (await run(() => actions.renameCustomField(fieldId, renameDraft))) setRenamingId(null)
  }, [actions, renameDraft, renamingId, run])

  const move = useCallback(
    async (fieldId: string, direction: 'up' | 'down') => {
      await run(() => actions.moveCustomField(fieldId, direction))
    },
    [actions, run],
  )

  const requestDelete = useCallback((fieldId: string) => {
    setPendingDeleteId(fieldId)
    setRenamingId(null)
  }, [])

  const cancelDelete = useCallback(() => setPendingDeleteId(null), [])

  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteId) return
    const fieldId = pendingDeleteId
    if (await run(() => actions.deleteCustomField(fieldId))) setPendingDeleteId(null)
  }, [actions, pendingDeleteId, run])

  const pendingDelete = fields?.find((field) => field.id === pendingDeleteId) ?? null

  return {
    fields,
    error,
    busy,
    newName,
    setNewName,
    add,
    renamingId,
    renameDraft,
    setRenameDraft,
    startRename,
    cancelRename,
    saveRename,
    move,
    pendingDelete,
    requestDelete,
    cancelDelete,
    confirmDelete,
  }
}
