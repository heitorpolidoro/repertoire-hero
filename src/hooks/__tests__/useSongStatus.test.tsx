// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useSongStatus, type SongStatusActions, type UseSongStatusOptions } from '@/hooks/useSongStatus'
import type { ResolvedSongEntry } from '@/types/database'

afterEach(cleanup)

const BAND_ENTRY: ResolvedSongEntry = {
  ownerRowId: 'rep-band',
  song_id: 'song-1',
  version_id: 'version-1',
  key: null,
  tuning: null,
  map: null,
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
    bandId: 'band-1',
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

  // RH-102: the four notes are always on screen, so the controller has no open
  // state left to keep — it is the status, the in-flight flag and the write.
  it('exposes no dropdown open state', () => {
    const { result } = setup()

    expect(Object.keys(result.current).sort()).toEqual(['change', 'status', 'updating'])
  })

  /**
   * RH-132 ER10 — all three arguments pinned.
   *
   * The first is the entry's `ownerRowId`, never the route's `versionId`:
   * `updateSongStatusAction` writes `WHERE id = $1` against an owner row. The
   * third is the hook's own `bandId` option, never `undefined` and never
   * omitted: with it absent the action resolves the owner as `{ userId }` and
   * the `UPDATE user_songs ... WHERE id = <the band row's id>` matches no row,
   * so a band admin tapping a mastery note gets a silent no-op.
   */
  it('writes the new status against the owner row id and the bandId option', async () => {
    const { result, actions, onStatusSaved } = setup()

    await act(async () => { await result.current.change('mastered') })

    expect(actions.updateStatus).toHaveBeenCalledTimes(1)
    expect(actions.updateStatus.mock.calls[0]).toHaveLength(3)
    expect(actions.updateStatus).toHaveBeenCalledWith('rep-band', 'mastered', 'band-1')
    expect(onStatusSaved).toHaveBeenCalledWith('mastered')
    expect(result.current.updating).toBe(false)
  })

  it('writes the bandId option even when it differs from anything on the entry', async () => {
    const { result, actions } = setup({ bandId: 'band-from-the-query' })

    await act(async () => { await result.current.change('polishing') })

    expect(actions.updateStatus).toHaveBeenCalledWith('rep-band', 'polishing', 'band-from-the-query')
  })

  it('passes a null bandId through outside a band context', async () => {
    const { result, actions } = setup({ bandId: null })

    await act(async () => { await result.current.change('polishing') })

    expect(actions.updateStatus.mock.calls[0]).toEqual(['rep-band', 'polishing', null])
  })

  /** RH-132 §3c — the addressed owner holds no row: nothing may be written. */
  it('writes nothing when the entry carries no owner row', async () => {
    const { result, actions, notify, onStatusSaved } = setup({
      entry: { ...BAND_ENTRY, ownerRowId: null, status: null },
    })

    await act(async () => { await result.current.change('mastered') })

    expect(actions.updateStatus).not.toHaveBeenCalled()
    expect(onStatusSaved).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('reports status unknown when the owner holds no row', () => {
    const { result } = setup({ entry: { ...BAND_ENTRY, ownerRowId: null, status: null } })

    expect(result.current.status).toBe('unknown')
  })

  it('reports the new status label in a success toast', async () => {
    const { result, notify } = setup()

    await act(async () => { await result.current.change('mastered') })

    expect(notify).toHaveBeenCalledWith('Status updated to Mastered', 'success')
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
