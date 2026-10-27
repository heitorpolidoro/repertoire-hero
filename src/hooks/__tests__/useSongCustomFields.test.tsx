// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useSongCustomFields, type SongCustomFieldsActions } from '@/hooks/useSongCustomFields'
import type { CustomFieldEntry } from '@/types/customField'

afterEach(cleanup)

const PRESET: CustomFieldEntry = { fieldId: 'f-preset', name: 'Preset', value: 'Lead 3B' }
const CAPO: CustomFieldEntry = { fieldId: 'f-capo', name: 'Capo', value: null }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(actions: SongCustomFieldsActions, versionId = 'v1') {
  const notify = vi.fn()
  const view = renderHook((props: { versionId: string }) => useSongCustomFields({ ...props, actions, notify }), {
    initialProps: { versionId },
  })
  return { ...view, notify }
}

describe('useSongCustomFields', () => {
  it('loads the entries of the route version', async () => {
    const actions = {
      getCustomFieldValues: vi.fn().mockResolvedValue([PRESET, CAPO]),
      setCustomFieldValue: vi.fn(),
    }
    const { result } = setup(actions)
    await waitFor(() => expect(result.current.entries).toEqual([PRESET, CAPO]))
    expect(actions.getCustomFieldValues).toHaveBeenCalledWith('v1')
  })

  it('reloads on a version change and discards an answer for a version no longer on screen', async () => {
    const first = deferred<CustomFieldEntry[]>()
    const second = deferred<CustomFieldEntry[]>()
    const actions = {
      getCustomFieldValues: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
      setCustomFieldValue: vi.fn(),
    }
    const { result, rerender } = setup(actions)
    rerender({ versionId: 'v2' })
    await act(async () => second.resolve([{ ...PRESET, value: null }]))
    await act(async () => first.resolve([PRESET]))
    expect(actions.getCustomFieldValues).toHaveBeenLastCalledWith('v2')
    expect(result.current.entries).toEqual([{ ...PRESET, value: null }])
  })

  it('shows nothing of the previous version while the next one loads', async () => {
    const next = deferred<CustomFieldEntry[]>()
    const actions = {
      getCustomFieldValues: vi.fn().mockResolvedValueOnce([PRESET]).mockReturnValueOnce(next.promise),
      setCustomFieldValue: vi.fn(),
    }
    const { result, rerender } = setup(actions)
    await waitFor(() => expect(result.current.entries).toEqual([PRESET]))
    rerender({ versionId: 'v2' })
    expect(result.current.entries).toEqual([])
  })

  it('a failed load notifies and leaves the entries as they were', async () => {
    const actions = {
      getCustomFieldValues: vi.fn().mockRejectedValue(new Error('Failed to load custom field values: boom')),
      setCustomFieldValue: vi.fn(),
    }
    const { result, notify } = setup(actions)
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Failed to load custom field values: boom', 'error'))
    expect(result.current.entries).toEqual([])
  })

  it('a failed load for a version no longer on screen is discarded', async () => {
    const first = deferred<CustomFieldEntry[]>()
    const actions = {
      getCustomFieldValues: vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce([CAPO]),
      setCustomFieldValue: vi.fn(),
    }
    const { result, rerender, notify } = setup(actions)
    rerender({ versionId: 'v2' })
    await waitFor(() => expect(result.current.entries).toEqual([CAPO]))
    await act(async () => first.reject(new Error('late')))
    expect(notify).not.toHaveBeenCalled()
  })

  it('opens the editor prefilled, saves, patches that one entry and closes', async () => {
    const actions = {
      getCustomFieldValues: vi.fn().mockResolvedValue([PRESET, CAPO]),
      setCustomFieldValue: vi.fn().mockResolvedValue('2'),
    }
    const { result } = setup(actions)
    await waitFor(() => expect(result.current.entries).toHaveLength(2))

    act(() => result.current.openEditor('f-preset'))
    expect(result.current.editingFieldId).toBe('f-preset')
    expect(result.current.draft).toBe('Lead 3B')

    act(() => result.current.openEditor('f-capo'))
    expect(result.current.draft).toBe('')
    act(() => result.current.setDraft(' 2 '))
    await act(async () => { await result.current.submit() })

    expect(actions.setCustomFieldValue).toHaveBeenCalledWith('f-capo', 'v1', ' 2 ')
    expect(result.current.entries).toEqual([PRESET, { ...CAPO, value: '2' }])
    expect(result.current.editingFieldId).toBeNull()
    expect(result.current.saving).toBe(false)
  })

  it('clear saves a blank value and the entry reads null', async () => {
    const actions = {
      getCustomFieldValues: vi.fn().mockResolvedValue([PRESET]),
      setCustomFieldValue: vi.fn().mockResolvedValue(null),
    }
    const { result } = setup(actions)
    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    act(() => result.current.openEditor('f-preset'))
    await act(async () => { await result.current.clear() })
    expect(actions.setCustomFieldValue).toHaveBeenCalledWith('f-preset', 'v1', '')
    expect(result.current.entries).toEqual([{ ...PRESET, value: null }])
    expect(result.current.editingFieldId).toBeNull()
  })

  it('a failed save notifies, keeps the old value and leaves the editor open', async () => {
    const actions = {
      getCustomFieldValues: vi.fn().mockResolvedValue([PRESET]),
      setCustomFieldValue: vi.fn().mockRejectedValue(new Error('Value must be at most 200 characters.')),
    }
    const { result, notify } = setup(actions)
    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    act(() => result.current.openEditor('f-preset'))
    act(() => result.current.setDraft('x'))
    await act(async () => { await result.current.submit() })
    expect(notify).toHaveBeenCalledWith('Value must be at most 200 characters.', 'error')
    expect(result.current.entries).toEqual([PRESET])
    expect(result.current.editingFieldId).toBe('f-preset')
  })

  it('cancel closes the editor and a submit without one open does nothing', async () => {
    const actions = {
      getCustomFieldValues: vi.fn().mockResolvedValue([PRESET]),
      setCustomFieldValue: vi.fn(),
    }
    const { result } = setup(actions)
    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    act(() => result.current.openEditor('f-preset'))
    act(() => result.current.cancel())
    expect(result.current.editingFieldId).toBeNull()
    await act(async () => { await result.current.submit() })
    expect(actions.setCustomFieldValue).not.toHaveBeenCalled()
  })

  it('a version change closes the editor', async () => {
    const actions = {
      getCustomFieldValues: vi.fn().mockResolvedValue([PRESET]),
      setCustomFieldValue: vi.fn(),
    }
    const { result, rerender } = setup(actions)
    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    act(() => result.current.openEditor('f-preset'))
    rerender({ versionId: 'v2' })
    expect(result.current.editingFieldId).toBeNull()
  })

  it('a save answered after the version changed patches nothing on the new version', async () => {
    const saved = deferred<string | null>()
    const actions = {
      getCustomFieldValues: vi.fn().mockResolvedValueOnce([PRESET]).mockResolvedValueOnce([{ ...PRESET, value: null }]),
      setCustomFieldValue: vi.fn().mockReturnValue(saved.promise),
    }
    const { result, rerender } = setup(actions)
    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    act(() => result.current.openEditor('f-preset'))
    act(() => result.current.setDraft('Lead 9Z'))
    let pending!: Promise<void>
    act(() => { pending = result.current.submit() })
    rerender({ versionId: 'v2' })
    await waitFor(() => expect(result.current.entries).toEqual([{ ...PRESET, value: null }]))
    await act(async () => {
      saved.resolve('Lead 9Z')
      await pending
    })
    expect(result.current.entries).toEqual([{ ...PRESET, value: null }])
  })
})
