// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import {
  CUSTOM_FIELDS_LOAD_ERROR,
  useCustomFieldSettings,
  type CustomFieldSettingsActions,
} from '@/hooks/useCustomFieldSettings'
import type { CustomField } from '@/types/customField'

afterEach(cleanup)

const PRESET: CustomField = { id: 'f1', name: 'Preset', position: 1 }
const AMP: CustomField = { id: 'f2', name: 'Amp', position: 2 }

/** A tiny in-memory backend, so every write is followed by a real reload. */
function fakeActions(initial: CustomField[] = []) {
  let fields = [...initial]
  let next = 10
  const actions = {
    listCustomFields: vi.fn(async () => [...fields]),
    createCustomField: vi.fn(async (name: string) => {
      if (fields.some((f) => f.name.toLowerCase() === name.trim().toLowerCase())) {
        throw new Error('You already have a field with that name.')
      }
      const field = { id: `f${next++}`, name: name.trim(), position: fields.length + 1 }
      fields.push(field)
      return field
    }),
    renameCustomField: vi.fn(async (id: string, name: string) => {
      fields = fields.map((f) => (f.id === id ? { ...f, name } : f))
      return fields.find((f) => f.id === id)!
    }),
    moveCustomField: vi.fn(async (id: string, direction: 'up' | 'down') => {
      const index = fields.findIndex((f) => f.id === id)
      const other = index + (direction === 'up' ? -1 : 1)
      if (other < 0 || other >= fields.length) return
      ;[fields[index], fields[other]] = [fields[other], fields[index]]
    }),
    deleteCustomField: vi.fn(async (id: string) => {
      fields = fields.filter((f) => f.id !== id)
    }),
  } satisfies CustomFieldSettingsActions
  return actions
}

async function setup(actions: CustomFieldSettingsActions) {
  const view = renderHook(() => useCustomFieldSettings({ actions }))
  await waitFor(() => expect(actions.listCustomFields).toHaveBeenCalled())
  return view
}

describe('useCustomFieldSettings', () => {
  it('starts unknown (null) and loads the list', async () => {
    const actions = fakeActions([PRESET])
    const { result } = renderHook(() => useCustomFieldSettings({ actions }))
    expect(result.current.fields).toBeNull()
    await waitFor(() => expect(result.current.fields).toEqual([PRESET]))
  })

  it('a failed load surfaces the error and keeps the list unknown', async () => {
    const actions = { ...fakeActions(), listCustomFields: vi.fn().mockRejectedValue(new Error('down')) }
    const { result } = await setup(actions)
    await waitFor(() => expect(result.current.error).toBe(CUSTOM_FIELDS_LOAD_ERROR))
    expect(result.current.fields).toBeNull()
  })

  it('adds a field, clears the input and shows the saved order (ER1)', async () => {
    const actions = fakeActions()
    const { result } = await setup(actions)
    act(() => result.current.setNewName('Preset'))
    await act(async () => { await result.current.add() })
    act(() => result.current.setNewName('Amp'))
    await act(async () => { await result.current.add() })
    expect(result.current.fields?.map((f) => f.name)).toEqual(['Preset', 'Amp'])
    expect(result.current.newName).toBe('')

    const amp = result.current.fields![1]
    act(() => result.current.startRename(amp.id))
    expect(result.current.renameDraft).toBe('Amp')
    act(() => result.current.setRenameDraft('Pedal'))
    await act(async () => { await result.current.saveRename() })
    expect(result.current.renamingId).toBeNull()
    await act(async () => { await result.current.move(amp.id, 'up') })
    expect(result.current.fields?.map((f) => f.name)).toEqual(['Pedal', 'Preset'])
    expect(actions.renameCustomField).toHaveBeenCalledWith(amp.id, 'Pedal')
    expect(actions.moveCustomField).toHaveBeenCalledWith(amp.id, 'up')
  })

  it('does not add a blank name', async () => {
    const actions = fakeActions()
    const { result } = await setup(actions)
    act(() => result.current.setNewName('   '))
    await act(async () => { await result.current.add() })
    expect(actions.createCustomField).not.toHaveBeenCalled()
  })

  it('surfaces a duplicate as the inline error and keeps the typed name (ER2)', async () => {
    const actions = fakeActions([PRESET])
    const { result } = await setup(actions)
    act(() => result.current.setNewName('preset'))
    await act(async () => { await result.current.add() })
    expect(result.current.error).toBe('You already have a field with that name.')
    expect(result.current.newName).toBe('preset')
    expect(result.current.busy).toBe(false)
  })

  it('deletes only after a two-step confirmation (ER3)', async () => {
    const actions = fakeActions([PRESET, AMP])
    const { result } = await setup(actions)
    await waitFor(() => expect(result.current.fields).toHaveLength(2))
    act(() => result.current.requestDelete(PRESET.id))
    expect(result.current.pendingDelete).toEqual(PRESET)
    expect(actions.deleteCustomField).not.toHaveBeenCalled()

    act(() => result.current.cancelDelete())
    expect(result.current.pendingDelete).toBeNull()

    act(() => result.current.requestDelete(PRESET.id))
    await act(async () => { await result.current.confirmDelete() })
    expect(actions.deleteCustomField).toHaveBeenCalledWith(PRESET.id)
    expect(result.current.pendingDelete).toBeNull()
    expect(result.current.fields).toEqual([AMP])
  })

  it('a failed delete keeps the confirmation open and shows the error', async () => {
    const actions = { ...fakeActions([PRESET]), deleteCustomField: vi.fn().mockRejectedValue(new Error('Custom field not found')) }
    const { result } = await setup(actions)
    await waitFor(() => expect(result.current.fields).toHaveLength(1))
    act(() => result.current.requestDelete(PRESET.id))
    await act(async () => { await result.current.confirmDelete() })
    expect(result.current.error).toBe('Custom field not found')
    expect(result.current.pendingDelete).toEqual(PRESET)
  })

  it('opening a rename closes a pending delete and the other way round, and clears the error', async () => {
    const actions = fakeActions([PRESET])
    const { result } = await setup(actions)
    await waitFor(() => expect(result.current.fields).toHaveLength(1))
    act(() => result.current.requestDelete(PRESET.id))
    act(() => result.current.startRename(PRESET.id))
    expect(result.current.pendingDelete).toBeNull()
    act(() => result.current.requestDelete(PRESET.id))
    expect(result.current.renamingId).toBeNull()
    act(() => result.current.startRename(PRESET.id))
    act(() => result.current.cancelRename())
    expect(result.current.renamingId).toBeNull()
  })

  it('a confirm or save with nothing open does nothing', async () => {
    const actions = fakeActions([PRESET])
    const { result } = await setup(actions)
    await act(async () => {
      await result.current.confirmDelete()
      await result.current.saveRename()
    })
    expect(actions.deleteCustomField).not.toHaveBeenCalled()
    expect(actions.renameCustomField).not.toHaveBeenCalled()
  })

  it('a failed reload after a write shows the load error', async () => {
    const actions = fakeActions([PRESET])
    const { result } = await setup(actions)
    await waitFor(() => expect(result.current.fields).toHaveLength(1))
    actions.listCustomFields.mockRejectedValueOnce(new Error('down'))
    await act(async () => { await result.current.move(PRESET.id, 'down') })
    expect(result.current.error).toBe(CUSTOM_FIELDS_LOAD_ERROR)
  })
})
