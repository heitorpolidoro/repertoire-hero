// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useSongStatus, type SongStatusActions, type UseSongStatusOptions } from '@/hooks/useSongStatus'
import type { Repertoire } from '@/types/database'

afterEach(cleanup)

const BAND_ENTRY: Repertoire = {
  id: 'rep-band',
  user_id: null,
  band_id: 'band-1',
  song_id: 'song-1',
  personal_key: null,
  status: 'learning',
  tags: [],
  last_practiced: null,
  lyrics: null,
}

type ActionSpies = { [K in keyof SongStatusActions]: Mock }

function makeActions(): ActionSpies {
  return { updateStatus: vi.fn().mockResolvedValue(undefined) }
}

function setup(overrides: Partial<UseSongStatusOptions> = {}) {
  const actions = (overrides.actions as ActionSpies | undefined) ?? makeActions()
  const notify = vi.fn()
  const onStatusSaved = vi.fn()
  const initialProps: UseSongStatusOptions = {
    entry: BAND_ENTRY,
    onStatusSaved,
    notify,
    ...overrides,
    actions,
  }
  const view = renderHook((props: UseSongStatusOptions) => useSongStatus(props), { initialProps })
  return { ...view, actions, notify, onStatusSaved, initialProps }
}

describe('useSongStatus', () => {
  it('exposes the entry status and falls back to unknown without an entry', () => {
    expect(setup().result.current.status).toBe('learning')
    expect(setup({ entry: null }).result.current.status).toBe('unknown')
  })

  it('toggles the status dropdown open and closed', () => {
    const { result } = setup()
    expect(result.current.isDropdownOpen).toBe(false)

    act(() => result.current.toggleDropdown())
    expect(result.current.isDropdownOpen).toBe(true)

    act(() => result.current.toggleDropdown())
    expect(result.current.isDropdownOpen).toBe(false)

    act(() => result.current.toggleDropdown())
    act(() => result.current.closeDropdown())
    expect(result.current.isDropdownOpen).toBe(false)
  })

  it('writes the new status against the entry id and its band id', async () => {
    const { result, actions, onStatusSaved } = setup()

    await act(async () => { await result.current.change('mastered') })

    expect(actions.updateStatus).toHaveBeenCalledWith('rep-band', 'mastered', 'band-1')
    expect(onStatusSaved).toHaveBeenCalledWith('mastered')
    expect(result.current.updating).toBe(false)
  })

  it('reports the new status label in a success toast and closes the dropdown', async () => {
    const { result, notify } = setup()
    act(() => result.current.toggleDropdown())

    await act(async () => { await result.current.change('mastered') })

    expect(notify).toHaveBeenCalledWith('Status updated to Mastered', 'success')
    expect(result.current.isDropdownOpen).toBe(false)
  })

  it('reports a status write failure with the Failed to update status toast', async () => {
    const actions = makeActions()
    actions.updateStatus.mockRejectedValue(new Error('offline'))
    const { result, notify, onStatusSaved } = setup({ actions })

    await act(async () => { await result.current.change('mastered') })

    expect(notify).toHaveBeenCalledWith('Failed to update status', 'error')
    expect(onStatusSaved).not.toHaveBeenCalled()
    expect(result.current.updating).toBe(false)
  })

  it('does not write anything before the entry has loaded', async () => {
    const { result, actions, notify } = setup({ entry: null })

    await act(async () => { await result.current.change('mastered') })

    expect(actions.updateStatus).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })
})
