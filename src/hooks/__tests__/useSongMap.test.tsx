// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useSongMap, type SongMapActions, type UseSongMapOptions } from '@/hooks/useSongMap'
import type { ResolvedSongEntry, SongMap } from '@/types/database'

afterEach(cleanup)

const MAP: SongMap = { sections: [{ name: 'Intro', bars: 4, note: null }] }

const ENTRY: ResolvedSongEntry = {
  ownerRowId: 'rep-1',
  song_id: 'song-1',
  version_id: 'version-1',
  key: null,
  tuning: null,
  map: MAP,
  mapOverridden: true,
  status: 'learning',
  tags: [],
  last_practiced: null,
  lyrics: null,
}

type Spies = { [K in keyof SongMapActions]: Mock }

function setup(overrides: Partial<UseSongMapOptions> = {}) {
  const actions: Spies = (overrides.actions as Spies | undefined) ?? {
    updateMap: vi.fn().mockResolvedValue(undefined),
  }
  const notify = vi.fn()
  const onSaved = vi.fn()
  const view = renderHook((props: UseSongMapOptions) => useSongMap(props), {
    initialProps: { entry: ENTRY, bandId: 'band-1', onSaved, notify, ...overrides, actions },
  })
  return { ...view, actions, notify, onSaved }
}

describe('useSongMap', () => {
  it('exposes the parsed map and the override marker', () => {
    const { result } = setup()
    expect(result.current.map).toEqual(MAP)
    expect(result.current.overridden).toBe(true)
  })

  it('exposes null for no entry, a foreign blob, and no marker when absent', () => {
    expect(setup({ entry: null }).result.current.map).toBeNull()
    const foreign = { ...ENTRY, map: { intro: 4 } as unknown as SongMap, mapOverridden: undefined }
    const { result } = setup({ entry: foreign })
    expect(result.current.map).toBeNull()
    expect(result.current.overridden).toBe(false)
  })

  it('saves the normalised draft against the owner row and the bandId option (ER2)', async () => {
    const { result, actions, onSaved, notify } = setup()

    act(() => result.current.startEdit())
    expect(result.current.editing).toBe(true)
    expect(result.current.draft).toHaveLength(1)
    act(() => result.current.editSection(0, { name: ' Verse ', bars: '8' }))
    act(() => result.current.addSection())
    act(() => result.current.moveSection(1, -1))
    act(() => result.current.removeSection(0))
    await act(async () => { await result.current.save() })

    expect(actions.updateMap).toHaveBeenCalledWith('rep-1', { sections: [{ name: 'Verse', bars: 8, note: null }] }, 'band-1')
    expect(onSaved).toHaveBeenCalledWith({ sections: [{ name: 'Verse', bars: 8, note: null }] })
    expect(notify).toHaveBeenCalledWith('Map saved', 'success')
    expect(result.current.editing).toBe(false)
    expect(result.current.updating).toBe(false)
  })

  it('saves an empty draft as null', async () => {
    const { result, actions, onSaved, notify } = setup({ bandId: null })

    act(() => result.current.startEdit())
    act(() => result.current.removeSection(0))
    await act(async () => { await result.current.save() })

    expect(actions.updateMap).toHaveBeenCalledWith('rep-1', null, null)
    expect(onSaved).toHaveBeenCalledWith(null)
    expect(notify).toHaveBeenCalledWith('Map cleared', 'success')
  })

  it('reports a failure, keeps the editor open and does not patch', async () => {
    const actions = { updateMap: vi.fn().mockRejectedValue(new Error('nope')) }
    const { result, onSaved, notify } = setup({ actions })

    act(() => result.current.startEdit())
    await act(async () => { await result.current.save() })

    expect(onSaved).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('Failed to update map', 'error')
    expect(result.current.editing).toBe(true)
    expect(result.current.updating).toBe(false)
  })

  it('Cancel discards the draft and writes nothing (ER7)', () => {
    const { result, actions } = setup()

    act(() => result.current.startEdit())
    act(() => result.current.editSection(0, { name: 'Changed' }))
    act(() => result.current.cancelEdit())

    expect(result.current.editing).toBe(false)
    expect(actions.updateMap).not.toHaveBeenCalled()
    expect(result.current.map).toEqual(MAP)
  })

  it('refuses to edit or write when the owner holds no row', async () => {
    const { result, actions, notify } = setup({ entry: { ...ENTRY, ownerRowId: null } })

    act(() => result.current.startEdit())
    expect(result.current.editing).toBe(false)
    act(() => result.current.requestReset())
    expect(result.current.confirmingReset).toBe(false)
    await act(async () => { await result.current.save() })
    await act(async () => { await result.current.confirmReset() })

    expect(actions.updateMap).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('resets after confirmation by writing null', async () => {
    const { result, actions, onSaved, notify } = setup()

    act(() => result.current.requestReset())
    expect(result.current.confirmingReset).toBe(true)
    await act(async () => { await result.current.confirmReset() })

    expect(actions.updateMap).toHaveBeenCalledWith('rep-1', null, 'band-1')
    expect(onSaved).toHaveBeenCalledWith(null)
    expect(notify).toHaveBeenCalledWith('Map cleared', 'success')
    expect(result.current.confirmingReset).toBe(false)
  })

  it('cancelling the confirmation writes nothing', () => {
    const { result, actions } = setup()

    act(() => result.current.requestReset())
    act(() => result.current.cancelReset())

    expect(result.current.confirmingReset).toBe(false)
    expect(actions.updateMap).not.toHaveBeenCalled()
  })

  it('reports a failed reset and closes the confirmation', async () => {
    const actions = { updateMap: vi.fn().mockRejectedValue(new Error('nope')) }
    const { result, onSaved, notify } = setup({ actions })

    act(() => result.current.requestReset())
    await act(async () => { await result.current.confirmReset() })

    expect(onSaved).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('Failed to update map', 'error')
    expect(result.current.confirmingReset).toBe(false)
  })
})
