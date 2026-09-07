// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useLyricsEditor, type LyricsEditorActions, type UseLyricsEditorOptions } from '@/hooks/useLyricsEditor'
import { stageHistoryState } from '@/lib/stageHistory'
import type { Repertoire } from '@/types/database'

afterEach(cleanup)
afterEach(() => vi.restoreAllMocks())

const BAND_ENTRY: Repertoire = {
  id: 'band-rep',
  user_id: null,
  band_id: 'band-1',
  song_id: 'song-1',
  personal_key: null,
  status: 'learning',
  tags: [],
  last_practiced: null,
  lyrics: 'band words',
}

const PERSONAL_ENTRY: Repertoire = {
  ...BAND_ENTRY,
  id: 'personal-rep',
  user_id: 'user-1',
  band_id: null,
  lyrics: 'my words',
}

type ActionSpies = { [K in keyof LyricsEditorActions]: Mock }

function makeActions(): ActionSpies {
  return {
    updateLyrics: vi.fn().mockResolvedValue(undefined),
    fetchLyrics: vi.fn().mockResolvedValue('imported'),
    addSong: vi.fn().mockResolvedValue(PERSONAL_ENTRY),
  }
}

function setup(overrides: Partial<UseLyricsEditorOptions> = {}) {
  const actions = (overrides.actions as ActionSpies | undefined) ?? makeActions()
  const notify = vi.fn()
  const onEntryLyricsSaved = vi.fn()
  const onPersonalLyricsSaved = vi.fn()
  const onPersonalEntryCreated = vi.fn()
  const initialProps: UseLyricsEditorOptions = {
    entry: BAND_ENTRY,
    personalEntry: PERSONAL_ENTRY,
    songTitle: 'Song Title',
    artist: 'Artist Name',
    onEntryLyricsSaved,
    onPersonalLyricsSaved,
    onPersonalEntryCreated,
    notify,
    ...overrides,
    actions,
  }
  const view = renderHook((props: UseLyricsEditorOptions) => useLyricsEditor(props), { initialProps })
  return {
    ...view,
    actions,
    notify,
    onEntryLyricsSaved,
    onPersonalLyricsSaved,
    onPersonalEntryCreated,
    initialProps,
  }
}

describe('useLyricsEditor', () => {
  it('starts with the band lyrics, not editing and not in Stage Mode', () => {
    const { result } = setup()

    expect(result.current.displayedLyrics).toBe('band words')
    expect(result.current.isBandEntry).toBe(true)
    expect(result.current.hasDifferentPersonalLyrics).toBe(true)
    expect(result.current.showPersonalLyrics).toBe(false)
    expect(result.current.isEditing).toBe(false)
    expect(result.current.draft).toBe('')
    expect(result.current.saving).toBe(false)
    expect(result.current.fetching).toBe(false)
    expect(result.current.isStageOpen).toBe(false)
    expect(result.current.fontSize).toBe(18)
    expect(result.current.isDarkMode).toBe(false)
  })

  it('seeds the draft from the displayed lyrics when editing starts', () => {
    const { result } = setup()

    act(() => result.current.startEditing())

    expect(result.current.isEditing).toBe(true)
    expect(result.current.draft).toBe('band words')

    // An entry with no lyrics at all seeds an empty draft, never `null`.
    const empty = setup({ entry: { ...BAND_ENTRY, lyrics: null }, personalEntry: null })
    act(() => empty.result.current.startEditing())
    expect(empty.result.current.draft).toBe('')
  })

  it('cancelling editing restores the draft from the displayed lyrics', () => {
    const { result } = setup()

    act(() => result.current.startEditing())
    act(() => result.current.setDraft('half-typed verse'))
    expect(result.current.draft).toBe('half-typed verse')

    act(() => result.current.cancelEditing())

    expect(result.current.isEditing).toBe(false)
    expect(result.current.draft).toBe('band words')
  })

  it('saves the band lyrics against the entry id and its band id', async () => {
    const { result, actions, notify, onEntryLyricsSaved, onPersonalLyricsSaved } = setup()

    act(() => result.current.startEditing())
    act(() => result.current.setDraft('new band words'))
    await act(async () => {
      await result.current.save()
    })

    expect(actions.updateLyrics).toHaveBeenCalledWith('band-rep', 'new band words', 'band-1')
    expect(actions.addSong).not.toHaveBeenCalled()
    expect(onEntryLyricsSaved).toHaveBeenCalledWith('new band words')
    expect(onPersonalLyricsSaved).not.toHaveBeenCalled()
    expect(result.current.isEditing).toBe(false)
    expect(result.current.saving).toBe(false)
    expect(notify).toHaveBeenCalledWith('Lyrics saved successfully!', 'success')
  })

  it('saves the personal lyrics against the personal entry with a null band id', async () => {
    const { result, actions, onEntryLyricsSaved, onPersonalLyricsSaved } = setup()

    act(() => result.current.toggleVersion())
    act(() => result.current.startEditing())
    act(() => result.current.setDraft('new personal words'))
    await act(async () => {
      await result.current.save()
    })

    expect(actions.updateLyrics).toHaveBeenCalledWith('personal-rep', 'new personal words', null)
    expect(actions.addSong).not.toHaveBeenCalled()
    expect(onPersonalLyricsSaved).toHaveBeenCalledWith('new personal words')
    expect(onEntryLyricsSaved).not.toHaveBeenCalled()
  })

  it('creates the personal entry before saving when the member has none', async () => {
    const { result, actions, onPersonalEntryCreated, onPersonalLyricsSaved } = setup({ personalEntry: null })

    act(() => result.current.toggleVersion())
    act(() => result.current.startEditing())
    act(() => result.current.setDraft('my first version'))
    await act(async () => {
      await result.current.save()
    })

    expect(actions.addSong).toHaveBeenCalledWith('song-1')
    expect(onPersonalEntryCreated).toHaveBeenCalledWith(PERSONAL_ENTRY)
    expect(actions.updateLyrics).toHaveBeenCalledWith('personal-rep', 'my first version', null)
    expect(onPersonalLyricsSaved).toHaveBeenCalledWith('my first version')
  })

  it('reports a save failure with the Failed to save lyrics toast', async () => {
    const actions = makeActions()
    actions.updateLyrics.mockRejectedValue(new Error('offline'))
    const { result, notify, onEntryLyricsSaved } = setup({ actions: actions as unknown as LyricsEditorActions })

    act(() => result.current.startEditing())
    await act(async () => {
      await result.current.save()
    })

    expect(notify).toHaveBeenCalledWith('Failed to save lyrics', 'error')
    expect(onEntryLyricsSaved).not.toHaveBeenCalled()
    // The editor stays open with the draft intact, so a retry is one more click.
    expect(result.current.isEditing).toBe(true)
    expect(result.current.saving).toBe(false)
  })

  it('refuses to auto-import without an artist and says so', async () => {
    const { result, actions, notify } = setup({ artist: '' })

    await act(async () => {
      await result.current.autoImport()
    })

    expect(notify).toHaveBeenCalledWith('Artist name is required to search for lyrics.', 'warning')
    expect(actions.fetchLyrics).not.toHaveBeenCalled()
  })

  it('auto-imports lyrics into the draft and reports success', async () => {
    const { result, actions, notify } = setup()

    await act(async () => {
      await result.current.autoImport()
    })

    expect(actions.fetchLyrics).toHaveBeenCalledWith('Artist Name', 'Song Title')
    expect(result.current.draft).toBe('imported')
    expect(result.current.fetching).toBe(false)
    expect(notify).toHaveBeenCalledWith('Lyrics imported online!', 'success')
  })

  it('reports lyrics not found online with the song title and artist in the toast', async () => {
    const actions = makeActions()
    actions.fetchLyrics.mockResolvedValue(null)
    const { result, notify } = setup({ actions: actions as unknown as LyricsEditorActions })

    await act(async () => {
      await result.current.autoImport()
    })

    expect(notify).toHaveBeenCalledWith(
      'Lyrics not found online for "Song Title" by "Artist Name". You can still paste them below.',
      'warning',
    )
    expect(result.current.draft).toBe('')
  })

  it('reports an auto-import failure and keeps the draft', async () => {
    const actions = makeActions()
    actions.fetchLyrics.mockRejectedValue(new Error('lyrics.ovh is down'))
    const { result, notify } = setup({ actions: actions as unknown as LyricsEditorActions })

    act(() => result.current.startEditing())
    act(() => result.current.setDraft('typed by hand'))
    await act(async () => {
      await result.current.autoImport()
    })

    expect(notify).toHaveBeenCalledWith(
      'Failed to import lyrics from web. You can still paste them below.',
      'error',
    )
    expect(result.current.draft).toBe('typed by hand')
    expect(result.current.fetching).toBe(false)
  })

  it('switches between the band and the personal lyrics version', () => {
    const { result } = setup()

    act(() => result.current.toggleVersion())

    expect(result.current.showPersonalLyrics).toBe(true)
    expect(result.current.displayedLyrics).toBe('my words')

    act(() => result.current.toggleVersion())

    expect(result.current.showPersonalLyrics).toBe(false)
    expect(result.current.displayedLyrics).toBe('band words')
  })

  it('raises the stage font size by two up to 36 and no further', () => {
    const { result } = setup()

    act(() => result.current.increaseFont())
    expect(result.current.fontSize).toBe(20)

    for (let i = 0; i < 20; i++) act(() => result.current.increaseFont())
    expect(result.current.fontSize).toBe(36)
  })

  it('lowers the stage font size by two down to 12 and no further', () => {
    const { result } = setup()

    act(() => result.current.decreaseFont())
    expect(result.current.fontSize).toBe(16)

    for (let i = 0; i < 20; i++) act(() => result.current.decreaseFont())
    expect(result.current.fontSize).toBe(12)
  })

  it('toggles the stage dark mode', () => {
    const { result } = setup()

    act(() => result.current.toggleDarkMode())
    expect(result.current.isDarkMode).toBe(true)

    act(() => result.current.toggleDarkMode())
    expect(result.current.isDarkMode).toBe(false)
  })

  it('pushes exactly one history entry when the lyrics stage opens', () => {
    const pushState = vi.spyOn(window.history, 'pushState')
    const { result, rerender, initialProps } = setup()

    act(() => result.current.openStage())
    rerender({ ...initialProps })

    expect(result.current.isStageOpen).toBe(true)
    expect(pushState).toHaveBeenCalledTimes(1)
    expect(pushState).toHaveBeenCalledWith(stageHistoryState(), '')
  })

  it('exits the lyrics stage when the browser back button fires popstate', () => {
    const { result } = setup()

    act(() => result.current.openStage())
    expect(result.current.isStageOpen).toBe(true)

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(result.current.isStageOpen).toBe(false)
  })

  it('closing the lyrics stage goes back only when the Stage Mode history entry is on top', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const { result } = setup()

    act(() => result.current.openStage())
    act(() => result.current.closeStage())

    expect(result.current.isStageOpen).toBe(false)
    expect(back).toHaveBeenCalledTimes(1)

    // Reopened, then something else replaced the entry on top: closing must not
    // pop a history entry that Stage Mode did not push.
    act(() => result.current.openStage())
    act(() => window.history.replaceState({}, ''))
    act(() => result.current.closeStage())

    expect(result.current.isStageOpen).toBe(false)
    expect(back).toHaveBeenCalledTimes(1)
  })
})
