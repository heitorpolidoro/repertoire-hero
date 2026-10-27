// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CustomFieldsSettingsSection } from '@/components/settings/CustomFieldsSettingsSection'
import type { CustomFieldSettingsActions } from '@/hooks/useCustomFieldSettings'
import type { CustomField } from '@/types/customField'

afterEach(cleanup)

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
const names = () => screen.getAllByTestId('custom-field-name').map((el) => el.textContent)

/** An in-memory backend shaped like the real actions, so each write is followed by a reload. */
function fakeActions(initial: CustomField[] = []) {
  let fields = [...initial]
  let next = 10
  return {
    listCustomFields: vi.fn(async () => [...fields]),
    createCustomField: vi.fn(async (name: string) => {
      const trimmed = name.trim()
      if (fields.some((f) => f.name.toLowerCase() === trimmed.toLowerCase())) {
        throw new Error('You already have a field with that name.')
      }
      const field = { id: `f${next++}`, name: trimmed, position: fields.length + 1 }
      fields.push(field)
      return field
    }),
    renameCustomField: vi.fn(async (id: string, name: string) => {
      fields = fields.map((f) => (f.id === id ? { ...f, name: name.trim() } : f))
      return fields.find((f) => f.id === id)!
    }),
    moveCustomField: vi.fn(async (id: string, direction: 'up' | 'down') => {
      const index = fields.findIndex((f) => f.id === id)
      const other = index + (direction === 'up' ? -1 : 1)
      ;[fields[index], fields[other]] = [fields[other], fields[index]]
    }),
    deleteCustomField: vi.fn(async (id: string) => {
      fields = fields.filter((f) => f.id !== id)
    }),
  } satisfies CustomFieldSettingsActions
}

function addField(name: string) {
  fireEvent.change(screen.getByPlaceholderText('Field name, e.g. Preset'), { target: { value: name } })
  fireEvent.click(button('Add field'))
}

describe('CustomFieldsSettingsSection', () => {
  it('shows the heading, the explanation and the empty state', async () => {
    render(<CustomFieldsSettingsSection actions={fakeActions()} offline={false} />)
    expect(screen.getByRole('heading', { name: 'Custom fields' })).toBeDefined()
    expect(
      screen.getByText('Your own notes on every song, like the pedalboard preset you use. Only you see them.'),
    ).toBeDefined()
    await screen.findByText('No custom fields yet.')
    expect(button('Add field').disabled).toBe(true)
  })

  it('adds, renames and moves, showing the saved order (ER1)', async () => {
    const actions = fakeActions()
    render(<CustomFieldsSettingsSection actions={actions} offline={false} />)
    await screen.findByText('No custom fields yet.')
    addField('Preset')
    await waitFor(() => expect(names()).toEqual(['Preset']))
    addField('Amp')
    await waitFor(() => expect(names()).toEqual(['Preset', 'Amp']))

    fireEvent.click(button('Rename Amp'))
    const input = screen.getByRole('textbox', { name: 'New name for Amp' }) as HTMLInputElement
    expect(input.maxLength).toBe(40)
    fireEvent.change(input, { target: { value: 'Pedal' } })
    fireEvent.click(button('Save'))
    await waitFor(() => expect(names()).toEqual(['Preset', 'Pedal']))

    expect(button('Move Preset up').disabled).toBe(true)
    expect(button('Move Pedal down').disabled).toBe(true)
    fireEvent.click(button('Move Pedal up'))
    await waitFor(() => expect(names()).toEqual(['Pedal', 'Preset']))
  })

  it('cancelling a rename restores the row', async () => {
    render(<CustomFieldsSettingsSection actions={fakeActions([{ id: 'f1', name: 'Preset', position: 1 }])} offline={false} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Preset' }))
    fireEvent.click(button('Cancel'))
    expect(names()).toEqual(['Preset'])
  })

  it('shows a duplicate name as the inline error under the form (ER2)', async () => {
    render(<CustomFieldsSettingsSection actions={fakeActions([{ id: 'f1', name: 'Preset', position: 1 }])} offline={false} />)
    await screen.findByText('Preset')
    addField('preset')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('You already have a field with that name.')
  })

  it('deletes only through the confirmation panel (ER3)', async () => {
    const actions = fakeActions([{ id: 'f1', name: 'Preset', position: 1 }])
    render(<CustomFieldsSettingsSection actions={actions} offline={false} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Preset' }))
    const panel = screen.getByRole('alertdialog')
    expect(within(panel).getByText('Delete "Preset" and its value on every song?')).toBeDefined()
    expect(actions.deleteCustomField).not.toHaveBeenCalled()
    fireEvent.click(within(panel).getByRole('button', { name: 'Delete' }))
    await screen.findByText('No custom fields yet.')
    expect(actions.deleteCustomField).toHaveBeenCalledWith('f1')
  })

  it('a failed load shows the alert and not the empty state', async () => {
    const actions = { ...fakeActions(), listCustomFields: vi.fn().mockRejectedValue(new Error('down')) }
    render(<CustomFieldsSettingsSection actions={actions} offline={false} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Could not load your custom fields.')
    expect(screen.queryByText('No custom fields yet.')).toBeNull()
  })

  it('does not show the empty state while loading', () => {
    const actions = { ...fakeActions(), listCustomFields: vi.fn(() => new Promise<CustomField[]>(() => {})) }
    render(<CustomFieldsSettingsSection actions={actions} offline={false} />)
    expect(screen.queryByText('No custom fields yet.')).toBeNull()
  })

  it('disables every write control offline', async () => {
    render(
      <CustomFieldsSettingsSection
        actions={fakeActions([
          { id: 'f1', name: 'Preset', position: 1 },
          { id: 'f2', name: 'Amp', position: 2 },
        ])}
        offline
      />,
    )
    await screen.findByText('Preset')
    for (const name of ['Move Preset down', 'Move Amp up', 'Rename Preset', 'Delete Amp', 'Add field']) {
      expect(button(name).disabled).toBe(true)
    }
    expect((screen.getByPlaceholderText('Field name, e.g. Preset') as HTMLInputElement).disabled).toBe(true)
  })
})
