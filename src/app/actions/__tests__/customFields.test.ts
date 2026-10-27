/**
 * RH-186 - the custom field actions are thin: each passes the session user's id
 * first and the client's arguments unchanged, and takes no user id from the client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))
vi.mock('@/lib/customFields', () => ({
  listCustomFields: vi.fn(),
  createCustomField: vi.fn(),
  renameCustomField: vi.fn(),
  moveCustomField: vi.fn(),
  deleteCustomField: vi.fn(),
  getCustomFieldValues: vi.fn(),
  setCustomFieldValue: vi.fn(),
}))

import {
  createCustomFieldAction,
  deleteCustomFieldAction,
  getCustomFieldValuesAction,
  listCustomFieldsAction,
  moveCustomFieldAction,
  renameCustomFieldAction,
  setCustomFieldValueAction,
} from '../customFields'
import { getRequiredUserId } from '@/lib/auth-session'
import * as lib from '@/lib/customFields'

const FIELD = { id: 'field-1', name: 'Preset', position: 1 }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getRequiredUserId).mockResolvedValue('session-user')
})

describe('custom field actions', () => {
  it('lists the session user\'s fields', async () => {
    vi.mocked(lib.listCustomFields).mockResolvedValue([FIELD])
    expect(await listCustomFieldsAction()).toEqual([FIELD])
    expect(lib.listCustomFields).toHaveBeenCalledWith('session-user')
  })

  it('creates and renames for the session user', async () => {
    vi.mocked(lib.createCustomField).mockResolvedValue(FIELD)
    vi.mocked(lib.renameCustomField).mockResolvedValue({ ...FIELD, name: 'Pedal' })
    expect(await createCustomFieldAction('Preset')).toEqual(FIELD)
    expect(lib.createCustomField).toHaveBeenCalledWith('session-user', 'Preset')
    expect((await renameCustomFieldAction('field-1', 'Pedal')).name).toBe('Pedal')
    expect(lib.renameCustomField).toHaveBeenCalledWith('session-user', 'field-1', 'Pedal')
  })

  it('moves and deletes for the session user', async () => {
    await moveCustomFieldAction('field-1', 'down')
    expect(lib.moveCustomField).toHaveBeenCalledWith('session-user', 'field-1', 'down')
    await deleteCustomFieldAction('field-1')
    expect(lib.deleteCustomField).toHaveBeenCalledWith('session-user', 'field-1')
  })

  it('reads and sets values with no band id', async () => {
    vi.mocked(lib.getCustomFieldValues).mockResolvedValue([])
    vi.mocked(lib.setCustomFieldValue).mockResolvedValue('Lead 3B')
    await getCustomFieldValuesAction('version-1')
    expect(lib.getCustomFieldValues).toHaveBeenCalledWith('session-user', 'version-1')
    expect(await setCustomFieldValueAction('field-1', 'version-1', 'Lead 3B')).toBe('Lead 3B')
    expect(lib.setCustomFieldValue).toHaveBeenCalledWith('session-user', 'field-1', 'version-1', 'Lead 3B')
  })

  it('lets the lib error propagate unwrapped', async () => {
    vi.mocked(lib.createCustomField).mockRejectedValue(new Error('You already have a field with that name.'))
    await expect(createCustomFieldAction('preset')).rejects.toThrow('You already have a field with that name.')
  })
})
