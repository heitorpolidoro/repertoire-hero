// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CustomFieldsSection } from '@/components/fastview/CustomFieldsSection'
import type { SongCustomFieldsActions } from '@/hooks/useSongCustomFields'
import type { CustomFieldEntry } from '@/types/customField'

afterEach(cleanup)

const PRESET: CustomFieldEntry = { fieldId: 'f-preset', name: 'Preset', value: 'Lead 3B' }
const CAPO: CustomFieldEntry = { fieldId: 'f-capo', name: 'Capo', value: null }

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
const textOf = (element: HTMLElement) => (element.textContent ?? '').replace(/\s+/g, ' ')

function renderSection(entries: CustomFieldEntry[], readOnly = false, saved: string | null = 'Lead 3B') {
  const actions = {
    getCustomFieldValues: vi.fn().mockResolvedValue(entries),
    setCustomFieldValue: vi.fn().mockResolvedValue(saved),
  } satisfies SongCustomFieldsActions
  const view = render(<CustomFieldsSection versionId="v1" actions={actions} readOnly={readOnly} notify={vi.fn()} />)
  return { ...view, actions }
}

describe('CustomFieldsSection', () => {
  it('renders nothing when the user has no definitions', async () => {
    const { container, actions } = renderSection([])
    await waitFor(() => expect(actions.getCustomFieldValues).toHaveBeenCalledWith('v1'))
    expect(container.textContent).toBe('')
    expect(screen.queryByRole('region', { name: 'Custom fields' })).toBeNull()
  })

  it('shows a filled field with Edit and an empty one as Not set with Set, both enabled', async () => {
    renderSection([PRESET, CAPO])
    const section = await screen.findByRole('region', { name: 'Custom fields' })
    expect(textOf(section)).toContain('Preset: Lead 3B')
    expect(textOf(section)).toContain('Capo: Not set')
    expect(button('Edit Preset').disabled).toBe(false)
    expect(button('Set Capo').disabled).toBe(false)
  })

  it('saves a value through the inline editor (ER4)', async () => {
    const { actions } = renderSection([{ ...PRESET, value: null }])
    fireEvent.click(await screen.findByRole('button', { name: 'Set Preset' }))
    const input = screen.getByRole('textbox', { name: 'Preset value' }) as HTMLInputElement
    expect(input.maxLength).toBe(200)
    fireEvent.change(input, { target: { value: 'Lead 3B' } })
    fireEvent.click(button('Save'))
    await screen.findByText('Lead 3B')
    expect(actions.setCustomFieldValue).toHaveBeenCalledWith('f-preset', 'v1', 'Lead 3B')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('clear saves a blank value and the field reads Not set again (ER5)', async () => {
    const { actions } = renderSection([PRESET], false, null)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Preset' }))
    expect((screen.getByRole('textbox', { name: 'Preset value' }) as HTMLInputElement).value).toBe('Lead 3B')
    fireEvent.click(button('Clear'))
    await screen.findByText('Not set')
    expect(actions.setCustomFieldValue).toHaveBeenCalledWith('f-preset', 'v1', '')
  })

  it('cancel closes the editor without saving', async () => {
    const { actions } = renderSection([PRESET])
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Preset' }))
    fireEvent.click(button('Cancel'))
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(actions.setCustomFieldValue).not.toHaveBeenCalled()
  })

  it('read-only (offline) shows only the filled fields, with Edit disabled (ER8)', async () => {
    renderSection([PRESET, CAPO], true)
    const section = await screen.findByRole('region', { name: 'Custom fields' })
    expect(textOf(section)).toContain('Preset: Lead 3B')
    expect(textOf(section)).not.toContain('Capo')
    expect(button('Edit Preset').disabled).toBe(true)
  })

  it('read-only with no filled field renders nothing', async () => {
    const { container, actions } = renderSection([CAPO], true)
    await waitFor(() => expect(actions.getCustomFieldValues).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})
