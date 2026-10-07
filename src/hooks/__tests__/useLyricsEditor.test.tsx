// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useLyricsEditor, type LyricsEditorActions, type UseLyricsEditorOptions } from '@/hooks/useLyricsEditor'
import { stageHistoryState } from '@/lib/stageHistory'
import type { Repertoire, ResolvedSongEntry } from '@/types/database'

afterEach(cleanup)
afterEach(() => vi.restoreAllMocks())

/**
 * The route entry is a `ResolvedSongEntry` since RH-132 and carries no
 * `band_id`: the page's `?bandId=` arrives as the hook's own `bandId` option
 * instead, which is what the Band/Personal switcher is fed from now (§3b).
 */
const BAND_ENTRY: ResolvedSongEntry = {
  ownerRowId: 'band-rep',
  song_id: 'song-1',
  version_id: 'version-1',
  key: null,
  tuning: null,
  map: null,
  status: 'learning',
  tags: [],
  last_practiced: null,
  lyrics: 'band words',
}

/** The same version read outside any band: one version, one text. */
const SOLO_ENTRY: ResolvedSongEntry = { ...BAND_ENTRY, ownerRowId: 'solo-rep', lyrics: 'my words' }

/** The member's own row stays a `Repertoire`, song-keyed (RH-132 ER14). */
const PERSONAL_ENTRY: Repertoire = {
  id: 'personal-rep',
  user_id: 'user-1',
  band_id: null,
  song_id: 'song-1',
  version_id: 'version-1',
  key: null,
  tuning: null,
  map: null,
  status: 'learning',
  tags: [],
  last_practiced: null,
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
    bandId: 'band-1',
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
  it('starts on the personal version when the member has one, not editing and not in Stage Mode', () => {
    const { result } = setup()

    // ER2: personal wins on first paint, with no interaction at all.
    expect(result.current.displayedLyrics).toBe('my words')
    expect(result.current.isBandEntry).toBe(true)
    expect(result.current.hasPersonalVersion).toBe(true)
    expect(result.current.activeVersion).toBe('personal')
    expect(result.current.isVersionChoiceOpen).toBe(false)
    expect(result.current.editTarget).toBeNull()
    expect(result.current.isEditing).toBe(false)
    expect(result.current.draft).toBe('')
    expect(result.current.saving).toBe(false)
    expect(result.current.fetching).toBe(false)
    expect(result.current.isStageOpen).toBe(false)
    expect(result.current.fontSize).toBe(18)
    expect(result.current.isDarkMode).toBe(false)
  })

  it('opens the choice dialog instead of the editor in band context (ER4)', () => {
    const { result } = setup()

    act(() => result.current.startEditing())

    expect(result.current.isVersionChoiceOpen).toBe(true)
    expect(result.current.isEditing).toBe(false)
    expect(result.current.editTarget).toBeNull()
  })

  it('opens the choice dialog every time, including once a personal version exists (ER4)', () => {
    const { result } = setup()

    act(() => result.current.startEditing())
    act(() => result.current.chooseVersion('personal'))
    act(() => result.current.cancelEditing())
    act(() => result.current.startEditing())

    expect(result.current.isVersionChoiceOpen).toBe(true)
    expect(result.current.isEditing).toBe(false)
  })

  it('cancelling the choice dialog edits nothing and creates nothing', () => {
    const { result, actions } = setup({ personalEntry: null })

    act(() => result.current.startEditing())
    act(() => result.current.cancelVersionChoice())

    expect(result.current.isVersionChoiceOpen).toBe(false)
    expect(result.current.isEditing).toBe(false)
    expect(actions.addSong).not.toHaveBeenCalled()
    expect(actions.updateLyrics).not.toHaveBeenCalled()
  })

  it('opens the editor directly in personal context, with no dialog (ER4)', () => {
    const { result } = setup({ entry: SOLO_ENTRY, personalEntry: null, bandId: null })

    act(() => result.current.startEditing())

    expect(result.current.isVersionChoiceOpen).toBe(false)
    expect(result.current.isEditing).toBe(true)
    expect(result.current.draft).toBe('my words')
  })

  it('seeds the draft from the chosen version (ER5)', () => {
    // My version, with one already there: seeded with it.
    const existing = setup()
    act(() => existing.result.current.startEditing())
    act(() => existing.result.current.chooseVersion('personal'))
    expect(existing.result.current.isEditing).toBe(true)
    expect(existing.result.current.editTarget).toBe('personal')
    expect(existing.result.current.draft).toBe('my words')
    cleanup()

    // My version, with none yet: seeded from the band's text.
    const first = setup({ personalEntry: null })
    act(() => first.result.current.startEditing())
    act(() => first.result.current.chooseVersion('personal'))
    expect(first.result.current.draft).toBe('band words')
    cleanup()

    // Band lyrics, while the personal version is the one on screen.
    const band = setup()
    expect(band.result.current.activeVersion).toBe('personal')
    act(() => band.result.current.startEditing())
    act(() => band.result.current.chooseVersion('band'))
    expect(band.result.current.editTarget).toBe('band')
    expect(band.result.current.draft).toBe('band words')
    cleanup()

    // An entry with no lyrics at all seeds an empty draft, never `null`.
    const empty = setup({ entry: { ...BAND_ENTRY, lyrics: null }, personalEntry: null })
    act(() => empty.result.current.startEditing())
    act(() => empty.result.current.chooseVersion('band'))
    expect(empty.result.current.draft).toBe('')
  })

  it('cancelling editing restores the draft from the displayed lyrics', () => {
    const { result } = setup()

    act(() => result.current.startEditing())
    act(() => result.current.chooseVersion('personal'))
    act(() => result.current.setDraft('half-typed verse'))
    expect(result.current.draft).toBe('half-typed verse')

    act(() => result.current.cancelEditing())

    expect(result.current.isEditing).toBe(false)
    expect(result.current.editTarget).toBeNull()
    expect(result.current.draft).toBe('my words')
  })

  it('saves the band lyrics against the entry id and its band id', async () => {
    const { result, actions, notify, onEntryLyricsSaved, onPersonalLyricsSaved } = setup()

    act(() => result.current.startEditing())
    act(() => result.current.chooseVersion('band'))
    act(() => result.current.setDraft('new band words'))
    await act(async () => {
      await result.current.save()
    })

    expect(actions.updateLyrics).toHaveBeenCalledWith('band-rep', 'new band words', 'band-1')
    expect(actions.addSong).not.toHaveBeenCalled()
    expect(onEntryLyricsSaved).toHaveBeenCalledWith('new band words')
    expect(onPersonalLyricsSaved).not.toHaveBeenCalled()
    // ER7: the version just edited is the one left on screen.
    expect(result.current.activeVersion).toBe('band')
    expect(result.current.displayedLyrics).toBe('band words')
    expect(result.current.isEditing).toBe(false)
    expect(result.current.saving).toBe(false)
    expect(notify).toHaveBeenCalledWith('Lyrics saved successfully!', 'success')
  })

  it('saves the personal lyrics against the personal entry with a null band id', async () => {
    const { result, actions, onEntryLyricsSaved, onPersonalLyricsSaved } = setup()

    act(() => result.current.startEditing())
    act(() => result.current.chooseVersion('personal'))
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

    act(() => result.current.startEditing())
    act(() => result.current.chooseVersion('personal'))
    act(() => result.current.setDraft('my first version'))
    await act(async () => {
      await result.current.save()
    })

    // RH-96: the song is the whole call — the new row is the session user's own
    // and is born `unknown`, so there is no band id to pass.
    expect(actions.addSong).toHaveBeenCalledExactlyOnceWith('song-1')
    expect(onPersonalEntryCreated).toHaveBeenCalledWith(PERSONAL_ENTRY)
    expect(actions.updateLyrics).toHaveBeenCalledWith('personal-rep', 'my first version', null)
    expect(onPersonalLyricsSaved).toHaveBeenCalledWith('my first version')
  })

  it('reports a save failure with the Failed to save lyrics toast', async () => {
    const actions = makeActions()
    actions.updateLyrics.mockRejectedValue(new Error('offline'))
    const { result, notify, onEntryLyricsSaved } = setup({ actions: actions as unknown as LyricsEditorActions })

    act(() => result.current.startEditing())
    act(() => result.current.chooseVersion('band'))
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

    expect(result.current.activeVersion).toBe('band')
    expect(result.current.displayedLyrics).toBe('band words')

    act(() => result.current.toggleVersion())

    expect(result.current.activeVersion).toBe('personal')
    expect(result.current.displayedLyrics).toBe('my words')
  })

  // -----------------------------------------------------------------------
  // RH-83 ER8 — discarding a personal version.
  // -----------------------------------------------------------------------

  it('offers Discard my version only while editing an existing personal version', () => {
    const { result } = setup()
    expect(result.current.canDiscardPersonal).toBe(false)

    act(() => result.current.startEditing())
    act(() => result.current.chooseVersion('band'))
    expect(result.current.canDiscardPersonal).toBe(false)

    act(() => result.current.cancelEditing())
    act(() => result.current.startEditing())
    act(() => result.current.chooseVersion('personal'))
    expect(result.current.canDiscardPersonal).toBe(true)

    // Nothing to discard when there is no personal version yet.
    cleanup()
    const fresh = setup({ personalEntry: null })
    act(() => fresh.result.current.startEditing())
    act(() => fresh.result.current.chooseVersion('personal'))
    expect(fresh.result.current.canDiscardPersonal).toBe(false)
  })

  it('discards a personal version by writing an empty string to the personal row', async () => {
    const { result, actions, onPersonalLyricsSaved, rerender, initialProps } = setup()

    act(() => result.current.startEditing())
    act(() => result.current.chooseVersion('personal'))
    act(() => result.current.requestDiscard())
    expect(result.current.isDiscardPending).toBe(true)

    act(() => result.current.cancelDiscard())
    expect(result.current.isDiscardPending).toBe(false)

    act(() => result.current.requestDiscard())
    await act(async () => {
      await result.current.confirmDiscard()
    })

    expect(actions.updateLyrics).toHaveBeenCalledWith('personal-rep', '', null)
    expect(onPersonalLyricsSaved).toHaveBeenCalledWith('')
    expect(result.current.isEditing).toBe(false)
    expect(result.current.isDiscardPending).toBe(false)

    // The page applies the write; the section then reads the band's text.
    rerender({ ...initialProps, personalEntry: { ...PERSONAL_ENTRY, lyrics: '' } })
    expect(result.current.activeVersion).toBe('band')
    expect(result.current.displayedLyrics).toBe('band words')
    expect(result.current.hasPersonalVersion).toBe(false)
  })

  it('reports a failed discard and keeps the personal version on screen', async () => {
    const actions = makeActions()
    actions.updateLyrics.mockRejectedValue(new Error('offline'))
    const { result, notify, onPersonalLyricsSaved } = setup({
      actions: actions as unknown as LyricsEditorActions,
    })

    act(() => result.current.startEditing())
    act(() => result.current.chooseVersion('personal'))
    act(() => result.current.requestDiscard())
    await act(async () => {
      await result.current.confirmDiscard()
    })

    expect(notify).toHaveBeenCalledWith('Failed to discard your lyrics version', 'error')
    expect(onPersonalLyricsSaved).not.toHaveBeenCalled()
    expect(result.current.isEditing).toBe(true)
    expect(result.current.activeVersion).toBe('personal')
    expect(result.current.saving).toBe(false)
  })

  it('does nothing at all while the route entry has not loaded', async () => {
    const { result, actions } = setup({ entry: null, personalEntry: null })

    act(() => result.current.startEditing())
    await act(async () => {
      await result.current.save()
    })
    await act(async () => {
      await result.current.confirmDiscard()
    })

    expect(result.current.isEditing).toBe(false)
    expect(result.current.isVersionChoiceOpen).toBe(false)
    expect(result.current.displayedLyrics).toBeNull()
    expect(actions.updateLyrics).not.toHaveBeenCalled()
    expect(actions.addSong).not.toHaveBeenCalled()
  })

  it('saving a whitespace-only personal draft discards the version the same way', async () => {
    const { result, actions, onPersonalLyricsSaved, rerender, initialProps } = setup()

    act(() => result.current.startEditing())
    act(() => result.current.chooseVersion('personal'))
    act(() => result.current.setDraft('   \n  '))
    await act(async () => {
      await result.current.save()
    })

    expect(actions.updateLyrics).toHaveBeenCalledWith('personal-rep', '', null)
    expect(onPersonalLyricsSaved).toHaveBeenCalledWith('')

    rerender({ ...initialProps, personalEntry: { ...PERSONAL_ENTRY, lyrics: '' } })
    expect(result.current.activeVersion).toBe('band')
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

  /**
   * RH-132 ER13 — the Band/Personal switcher survives the loss of
   * `entry.band_id`.
   *
   * Every `entry?.band_id` read in this hook is replaced by the page's
   * `bandId` option, and `useLyricsVersionChoice` is fed a memoized
   * `LyricsSource { band_id: bandId, lyrics: entry.lyrics }`. The rejected
   * alternative — letting `band_id` go undefined — collapses
   * `resolveLyricsVersion` to always `'band'`, which removes band members'
   * personal lyrics from Fast View outright.
   */
  it('reports the band-context switcher from the bandId option', () => {
    const { result } = setup()

    expect(result.current.isBandEntry).toBe(true)
    expect(result.current.hasPersonalVersion).toBe(true)
    expect(result.current.activeVersion).toBe('personal')
    expect(result.current.displayedLyrics).toBe('my words')
  })

  it('reports no switcher at all with a null bandId, even with personal lyrics loaded', () => {
    const { result } = setup({ bandId: null })

    expect(result.current.isBandEntry).toBe(false)
    expect(result.current.hasPersonalVersion).toBe(false)
    expect(result.current.activeVersion).toBe('band')
    // Outside a band the route entry *is* the one text there is.
    expect(result.current.displayedLyrics).toBe('band words')
  })

  it('asks which version to edit only in band context', () => {
    const inBand = setup()
    act(() => inBand.result.current.startEditing())
    expect(inBand.result.current.isVersionChoiceOpen).toBe(true)
    expect(inBand.result.current.isEditing).toBe(false)
    cleanup()

    const solo = setup({ bandId: null })
    act(() => solo.result.current.startEditing())
    expect(solo.result.current.isVersionChoiceOpen).toBe(false)
    expect(solo.result.current.isEditing).toBe(true)
  })

  /**
   * RH-132 ER11 — the create-my-first-personal-chart flow is untouched.
   *
   * A band member in band context with a non-null `ownerRowId` and no personal
   * row: `resolveLyricsSaveTarget` answers `repertoireId: null` with
   * `toPersonalEntry: true`, so the save creates the row and writes to it.
   */
  it('creates the member first personal row and saves into it (RH-83 flow intact)', async () => {
    const created: Repertoire = { ...PERSONAL_ENTRY, id: 'rep-created', lyrics: '' }
    const actions = makeActions()
    actions.addSong.mockResolvedValue(created)
    const { result, onPersonalEntryCreated, onPersonalLyricsSaved } = setup({
      actions,
      personalEntry: null,
    })

    act(() => result.current.startEditing())
    act(() => result.current.chooseVersion('personal'))
    act(() => result.current.setDraft('my own cues'))
    await act(async () => { await result.current.save() })

    expect(actions.addSong).toHaveBeenCalledWith('song-1')
    expect(onPersonalEntryCreated).toHaveBeenCalledWith(created)
    expect(actions.updateLyrics).toHaveBeenCalledTimes(1)
    expect(actions.updateLyrics).toHaveBeenCalledWith('rep-created', 'my own cues', null)
    expect(onPersonalLyricsSaved).toHaveBeenCalledWith('my own cues')
  })

  /**
   * RH-132 ER12 — the *other* null writes nothing at all.
   *
   * `ownerRowId === null` is "the addressed owner holds no row at this
   * version". The band save target is then `repertoireId: null` with
   * `toPersonalEntry: false`, and the hook must return rather than fall into
   * the create branch — and in particular must never call `updateLyrics('')`,
   * which an `ownerRowId ?? ''` coercion would produce.
   */
  describe('with an owner holding no row at this version (RH-132 ER12)', () => {
    const NO_OWNER_ROW: ResolvedSongEntry = {
      ...BAND_ENTRY,
      ownerRowId: null,
      status: null,
      tags: [],
    }

    it('neither creates nor writes on a band save', async () => {
      const { result, actions, onEntryLyricsSaved, onPersonalLyricsSaved } = setup({
        entry: NO_OWNER_ROW,
        personalEntry: null,
      })

      act(() => result.current.startEditing())
      act(() => result.current.chooseVersion('band'))
      act(() => result.current.setDraft('words nobody may store'))
      await act(async () => { await result.current.save() })

      expect(actions.addSong).not.toHaveBeenCalled()
      expect(actions.updateLyrics).not.toHaveBeenCalled()
      expect(onEntryLyricsSaved).not.toHaveBeenCalled()
      expect(onPersonalLyricsSaved).not.toHaveBeenCalled()
      expect(result.current.saving).toBe(false)
    })

    it('never issues a save with an empty or falsy first argument', async () => {
      const { result, actions } = setup({ entry: NO_OWNER_ROW, personalEntry: null })

      act(() => result.current.startEditing())
      act(() => result.current.chooseVersion('band'))
      await act(async () => { await result.current.save() })

      for (const call of actions.updateLyrics.mock.calls) {
        expect(call[0]).toBeTruthy()
        expect(call[0]).not.toBe('')
      }
      expect(actions.updateLyrics).not.toHaveBeenCalled()
    })

    it('still renders the inherited lyrics it may not write', () => {
      const { result } = setup({ entry: NO_OWNER_ROW, personalEntry: null })

      expect(result.current.displayedLyrics).toBe('band words')
    })
  })
})
