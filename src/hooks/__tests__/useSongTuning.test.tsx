// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useSongTuning, type SongTuningActions, type UseSongTuningOptions } from '@/hooks/useSongTuning'
import type { ResolvedSongEntry } from '@/types/database'

afterEach(cleanup)

const ENTRY: ResolvedSongEntry = {
  ownerRowId: 'rep-band',
  song_id: 'song-1',
  version_id: 'version-1',
  key: null,
  tuning: 'Standard',
  map: null,
  status: 'learning',
  tags: [],
  last_practiced: null,
  lyrics: null,
}

type Spies = { [K in keyof SongTuningActions]: Mock }

function setup(overrides: Partial<UseSongTuningOptions> = {}) {
  const actions: Spies = (overrides.actions as Spies | undefined) ?? {
    updateTuning: vi.fn().mockResolvedValue(undefined),
  }
  const notify = vi.fn()
  const onSaved = vi.fn()
  const view = renderHook((props: UseSongTuningOptions) => useSongTuning(props), {
    initialProps: { entry: ENTRY, bandId: 'band-1', onSaved, notify, ...overrides, actions },
  })
  return { ...view, actions, notify, onSaved }
}

describe('useSongTuning', () => {
  it('exposes the resolved tuning, null without an entry', () => {
    expect(setup().result.current.tuning).toBe('Standard')
    expect(setup({ entry: null }).result.current.tuning).toBeNull()
  })

  it('writes the trimmed value against the owner row id and the bandId option', async () => {
    const { result, actions, onSaved, notify } = setup()

    await act(async () => { await result.current.save('  Drop D ') })

    expect(actions.updateTuning).toHaveBeenCalledWith('rep-band', 'Drop D', 'band-1')
    expect(onSaved).toHaveBeenCalledWith('Drop D')
    expect(notify).toHaveBeenCalledWith('Tuning set to Drop D', 'success')
    expect(result.current.updating).toBe(false)
  })

  it('writes null for whitespace input', async () => {
    const { result, actions, onSaved, notify } = setup({ bandId: null })

    await act(async () => { await result.current.save('   ') })

    expect(actions.updateTuning).toHaveBeenCalledWith('rep-band', null, null)
    expect(onSaved).toHaveBeenCalledWith(null)
    expect(notify).toHaveBeenCalledWith('Tuning cleared', 'success')
  })

  it('reports a failure and leaves the shown value alone', async () => {
    const actions = { updateTuning: vi.fn().mockRejectedValue(new Error('denied')) }
    const { result, notify, onSaved } = setup({ actions })

    await act(async () => { await result.current.save('Drop D') })

    expect(notify).toHaveBeenCalledWith('Failed to update tuning', 'error')
    expect(onSaved).not.toHaveBeenCalled()
    expect(result.current.updating).toBe(false)
  })

  it('writes nothing when the owner holds no row or the entry is not loaded', async () => {
    for (const entry of [{ ...ENTRY, ownerRowId: null }, null]) {
      const { result, actions, notify, onSaved } = setup({ entry })

      await act(async () => { await result.current.save('Drop D') })

      expect(actions.updateTuning).not.toHaveBeenCalled()
      expect(onSaved).not.toHaveBeenCalled()
      expect(notify).not.toHaveBeenCalled()
    }
  })
})
