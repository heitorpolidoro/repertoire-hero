// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useSongLinks, type SongLinksActions, type UseSongLinksOptions } from '@/hooks/useSongLinks'
import type { Song, ResolvedSongEntry, SongLink } from '@/types/database'

afterEach(cleanup)

const LINKS: SongLink[] = [
  { label: 'Chords', url: 'https://cifraclub.com.br/black-dog' },
  { label: 'Video', url: 'https://youtube.com/watch?v=1' },
]

const SONG: Song = {
  id: 'song-1',
  title: 'Black Dog',
  artist: 'Led Zeppelin',
  album: 'IV',
  standard_key: 'A',
  cover_url: null,
  duration_seconds: null,
  links: LINKS,
  created_at: '2026-01-01T00:00:00.000Z',
}

const ENTRY: ResolvedSongEntry = {
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
  song: SONG,
}

type ActionSpies = { [K in keyof SongLinksActions]: Mock }

function makeActions(): ActionSpies {
  return {
    updateLinks: vi.fn().mockResolvedValue({ success: true }),
    fetchUrlTitle: vi.fn().mockResolvedValue('Fetched Title'),
  }
}

function setup(overrides: Partial<UseSongLinksOptions> = {}) {
  const actions = (overrides.actions as ActionSpies | undefined) ?? makeActions()
  const notify = vi.fn()
  const onLinksSaved = vi.fn()
  const initialProps: UseSongLinksOptions = {
    entry: ENTRY,
    onLinksSaved,
    notify,
    ...overrides,
    actions,
  }
  const view = renderHook((props: UseSongLinksOptions) => useSongLinks(props), { initialProps })
  return { ...view, actions, notify, onLinksSaved, initialProps }
}

/** Fills the add form the way the two inputs of `AddLinkForm` do. */
function fillForm(
  result: { current: ReturnType<typeof useSongLinks> },
  label: string,
  url: string,
) {
  act(() => result.current.startAdding())
  act(() => result.current.setLabel(label))
  act(() => result.current.setUrl(url))
}

describe('useSongLinks', () => {
  it('exposes the links of the entry and starts with the add form closed', () => {
    const { result } = setup()

    expect(result.current.links).toEqual(LINKS)
    expect(result.current.isAdding).toBe(false)
    expect(setup({ entry: null }).result.current.links).toEqual([])
  })

  it('opens and cancels the add form, clearing both inputs', () => {
    const { result } = setup()
    fillForm(result, 'My tab', 'https://example.com/tab')
    expect(result.current.isAdding).toBe(true)

    act(() => result.current.cancelAdding())

    expect(result.current.isAdding).toBe(false)
    expect(result.current.label).toBe('')
    expect(result.current.url).toBe('')
  })

  it('refuses a duplicate url and does not call the action', async () => {
    const { result, actions, notify } = setup()
    fillForm(result, '', ' https://youtube.com/watch?v=1 ')

    await act(async () => { await result.current.submit() })

    expect(notify).toHaveBeenCalledWith('This URL is already in the links list.', 'warning')
    expect(actions.updateLinks).not.toHaveBeenCalled()
    expect(actions.fetchUrlTitle).not.toHaveBeenCalled()
    expect(result.current.saving).toBe(false)
  })

  it('adds a link with the label the musician typed', async () => {
    const { result, actions, onLinksSaved, notify } = setup()
    fillForm(result, 'My tab', ' https://example.com/tab ')

    await act(async () => { await result.current.submit() })

    expect(actions.fetchUrlTitle).not.toHaveBeenCalled()
    expect(actions.updateLinks).toHaveBeenCalledWith('rep-band', [
      ...LINKS,
      { label: 'My tab', url: 'https://example.com/tab' },
    ])
    expect(onLinksSaved).toHaveBeenCalledWith([...LINKS, { label: 'My tab', url: 'https://example.com/tab' }])
    expect(notify).toHaveBeenCalledWith('Link added successfully!', 'success')
  })

  it('auto-fills a blank label from the fetched url title', async () => {
    const { result, actions } = setup()
    fillForm(result, '  ', 'https://example.com/tab')

    await act(async () => { await result.current.submit() })

    expect(actions.fetchUrlTitle).toHaveBeenCalledWith('https://example.com/tab')
    expect(actions.updateLinks).toHaveBeenCalledWith('rep-band', [
      ...LINKS,
      { label: 'Fetched Title', url: 'https://example.com/tab' },
    ])
  })

  it('falls back to the url when the fetched title is empty', async () => {
    const actions = makeActions()
    actions.fetchUrlTitle.mockResolvedValue('')
    const { result } = setup({ actions })
    fillForm(result, '', 'https://example.com/tab')

    await act(async () => { await result.current.submit() })

    expect(actions.updateLinks).toHaveBeenCalledWith('rep-band', [
      ...LINKS,
      { label: 'https://example.com/tab', url: 'https://example.com/tab' },
    ])
  })

  it('closes and clears the add form after a successful add', async () => {
    const { result } = setup()
    fillForm(result, 'My tab', 'https://example.com/tab')

    await act(async () => { await result.current.submit() })

    expect(result.current.isAdding).toBe(false)
    expect(result.current.label).toBe('')
    expect(result.current.url).toBe('')
    expect(result.current.saving).toBe(false)
  })

  it('reports the action error message when adding a link fails', async () => {
    const actions = makeActions()
    actions.updateLinks.mockRejectedValue(new Error('Link rejected by the catalog'))
    const { result, notify } = setup({ actions })
    fillForm(result, 'My tab', 'https://example.com/tab')

    await act(async () => { await result.current.submit() })

    expect(notify).toHaveBeenCalledWith('Link rejected by the catalog', 'error')
    expect(result.current.isAdding).toBe(true)
    expect(result.current.saving).toBe(false)
  })

  it('falls back to a generic message when the add throws a non-error', async () => {
    const actions = makeActions()
    actions.updateLinks.mockRejectedValue('boom')
    const { result, notify } = setup({ actions })
    fillForm(result, 'My tab', 'https://example.com/tab')

    await act(async () => { await result.current.submit() })

    expect(notify).toHaveBeenCalledWith('Failed to add link.', 'error')
  })

  // RH-99 ER6 — the safety net, not the fix: offline the `+ Add Link` trigger
  // and the `Add` submit are disabled, so this path is unreachable there. It
  // exists because `submit` fabricating success out of a refusal envelope is
  // wrong on every path — the link was never written, whatever the reason.
  it('does not report success when updateLinks refuses with a success:false envelope', async () => {
    const actions = makeActions()
    actions.updateLinks.mockResolvedValue({
      success: false,
      error: 'You are offline. This change cannot be saved until you reconnect.',
    })
    const { result, notify, onLinksSaved } = setup({ actions })
    fillForm(result, 'My tab', 'https://example.com/tab')

    await act(async () => { await result.current.submit() })

    expect(onLinksSaved).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalledWith('Link added successfully!', 'success')
    expect(notify).toHaveBeenCalledWith(
      'You are offline. This change cannot be saved until you reconnect.',
      'error',
    )
    // The form stays open with the typed values, so nothing the musician wrote
    // is thrown away by a write that never happened.
    expect(result.current.isAdding).toBe(true)
    expect(result.current.url).toBe('https://example.com/tab')
    expect(result.current.saving).toBe(false)
  })

  it('falls back to a generic message when the refusal envelope carries no error text', async () => {
    const actions = makeActions()
    actions.updateLinks.mockResolvedValue({ success: false })
    const { result, notify, onLinksSaved } = setup({ actions })
    fillForm(result, 'My tab', 'https://example.com/tab')

    await act(async () => { await result.current.submit() })

    expect(onLinksSaved).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('Failed to add link.', 'error')
  })

  it('still reports success for a queued (pending) catalog edit', async () => {
    const actions = makeActions()
    actions.updateLinks.mockResolvedValue({ success: true, pending: true })
    const { result, notify, onLinksSaved } = setup({ actions })
    fillForm(result, 'My tab', 'https://example.com/tab')

    await act(async () => { await result.current.submit() })

    expect(onLinksSaved).toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('Link added successfully!', 'success')
  })

  it('does not submit before the entry has loaded', async () => {
    const { result, actions } = setup({ entry: null })

    await act(async () => { await result.current.submit() })

    expect(actions.updateLinks).not.toHaveBeenCalled()
  })

  it('deletes a link and reports it with the Link deleted toast', async () => {
    const { result, actions, onLinksSaved, notify } = setup()

    act(() => result.current.requestDelete('https://youtube.com/watch?v=1'))
    expect(result.current.pendingDeleteUrl).toBe('https://youtube.com/watch?v=1')

    await act(async () => { await result.current.confirmDelete() })

    expect(actions.updateLinks).toHaveBeenCalledWith('rep-band', [LINKS[0]])
    expect(onLinksSaved).toHaveBeenCalledWith([LINKS[0]])
    expect(notify).toHaveBeenCalledWith('Link deleted.', 'info')
    expect(result.current.pendingDeleteUrl).toBeNull()
    expect(result.current.deleteBusy).toBe(false)
  })

  it('keeps the link and warns when the removal is queued for review', async () => {
    const actions = makeActions()
    actions.updateLinks.mockResolvedValue({ success: true, pending: true })
    const { result, onLinksSaved, notify } = setup({ actions })

    act(() => result.current.requestDelete('https://youtube.com/watch?v=1'))
    await act(async () => { await result.current.confirmDelete() })

    expect(notify).toHaveBeenCalledWith(
      'Link removal submitted for review. It stays visible until an admin approves it.',
      'warning',
    )
    expect(onLinksSaved).not.toHaveBeenCalled()
    expect(result.current.pendingDeleteUrl).toBeNull()
  })

  it('reports a delete failure with the Failed to delete link toast', async () => {
    const actions = makeActions()
    actions.updateLinks.mockRejectedValue(new Error('offline'))
    const { result, onLinksSaved, notify } = setup({ actions })

    act(() => result.current.requestDelete('https://youtube.com/watch?v=1'))
    await act(async () => { await result.current.confirmDelete() })

    expect(notify).toHaveBeenCalledWith('Failed to delete link.', 'error')
    expect(onLinksSaved).not.toHaveBeenCalled()
    expect(result.current.pendingDeleteUrl).toBeNull()
    expect(result.current.deleteBusy).toBe(false)
  })

  it('cancelDelete closes the confirmation without calling the action', async () => {
    const { result, actions } = setup()

    act(() => result.current.requestDelete('https://youtube.com/watch?v=1'))
    act(() => result.current.cancelDelete())

    expect(result.current.pendingDeleteUrl).toBeNull()

    await act(async () => { await result.current.confirmDelete() })

    expect(actions.updateLinks).not.toHaveBeenCalled()
  })

  it('clears the confirmation of an entry whose song never loaded', async () => {
    const { result, actions } = setup({ entry: { ...ENTRY, song: undefined } })

    act(() => result.current.requestDelete('https://youtube.com/watch?v=1'))
    await act(async () => { await result.current.confirmDelete() })

    expect(actions.updateLinks).not.toHaveBeenCalled()
    expect(result.current.pendingDeleteUrl).toBeNull()
  })
})

/**
 * RH-132 ER9 — both link writes target the owner row, and refuse a null one.
 *
 * `updateSongLinksAction` resolves the owner server-side from the row id
 * alone, so this hook needs no `bandId` option — only the `entry.id` to
 * `entry.ownerRowId` swap and a guard, because `ownerRowId` is `null` exactly
 * when the addressed owner holds no row at this version.
 */
describe('useSongLinks against the owner row (RH-132 ER9)', () => {
  it('adds a link against the owner row id, never the version id', async () => {
    const { result, actions } = setup()

    act(() => result.current.startAdding())
    act(() => result.current.setLabel('Tab'))
    act(() => result.current.setUrl('https://songsterr.com/black-dog'))
    await act(async () => { await result.current.submit() })

    expect(actions.updateLinks).toHaveBeenCalledTimes(1)
    expect(actions.updateLinks.mock.calls[0][0]).toBe('rep-band')
    expect(actions.updateLinks.mock.calls[0][0]).not.toBe('version-1')
  })

  it('deletes a link against the owner row id', async () => {
    const { result, actions } = setup()

    act(() => result.current.requestDelete(LINKS[0].url))
    await act(async () => { await result.current.confirmDelete() })

    expect(actions.updateLinks).toHaveBeenCalledTimes(1)
    expect(actions.updateLinks.mock.calls[0][0]).toBe('rep-band')
  })

  it('writes nothing, on either path, when the owner holds no row', async () => {
    const noRow: ResolvedSongEntry = { ...ENTRY, ownerRowId: null, status: null, tags: [] }
    const { result, actions, onLinksSaved } = setup({ entry: noRow })

    act(() => result.current.startAdding())
    act(() => result.current.setUrl('https://songsterr.com/black-dog'))
    await act(async () => { await result.current.submit() })

    act(() => result.current.requestDelete(LINKS[0].url))
    await act(async () => { await result.current.confirmDelete() })

    expect(actions.updateLinks).not.toHaveBeenCalled()
    expect(onLinksSaved).not.toHaveBeenCalled()
    // The links themselves still render: inherited data is readable.
    expect(result.current.links).toEqual(LINKS)
  })
})
