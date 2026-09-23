// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { LyricsSection } from '../LyricsSection'
import { LyricsEditorPanel } from '../LyricsEditorPanel'
import { useLyricsEditor, type LyricsEditorActions } from '@/hooks/useLyricsEditor'
import type { LyricsEditorController } from '@/lib/lyricsEditor'
import type { Repertoire } from '@/types/database'

afterEach(cleanup)

/** A controller fixture: plain data plus spies, so no hook is ever imported. */
function makeController(overrides: Partial<LyricsEditorController> = {}): LyricsEditorController {
  return {
    isBandEntry: true,
    displayedLyrics: 'band words',
    activeVersion: 'band',
    hasPersonalVersion: false,
    toggleVersion: vi.fn(),
    isVersionChoiceOpen: false,
    personalRepertoireId: null,
    chooseVersion: vi.fn(),
    cancelVersionChoice: vi.fn(),
    editTarget: null,
    isEditing: false,
    draft: '',
    setDraft: vi.fn(),
    startEditing: vi.fn(),
    cancelEditing: vi.fn(),
    saving: false,
    save: vi.fn().mockResolvedValue(undefined),
    canDiscardPersonal: false,
    isDiscardPending: false,
    requestDiscard: vi.fn(),
    cancelDiscard: vi.fn(),
    confirmDiscard: vi.fn().mockResolvedValue(undefined),
    fetching: false,
    autoImport: vi.fn().mockResolvedValue(undefined),
    isStageOpen: false,
    openStage: vi.fn(),
    closeStage: vi.fn(),
    fontSize: 18,
    increaseFont: vi.fn(),
    decreaseFont: vi.fn(),
    isDarkMode: false,
    toggleDarkMode: vi.fn(),
    ...overrides,
  }
}

describe('LyricsSection', () => {
  it('LyricsSection renders the lyrics it is given as markup', () => {
    const { container } = render(
      <LyricsSection controller={makeController({ displayedLyrics: '**Chorus**' })} loadingPersonal={false} />,
    )

    expect(container.innerHTML).toContain('<strong>Chorus</strong>')
  })

  it('LyricsSection shows the empty state when there are no lyrics', () => {
    render(<LyricsSection controller={makeController({ displayedLyrics: null })} loadingPersonal={false} />)

    expect(screen.getByText('No lyrics added yet.')).toBeDefined()
  })

  it('LyricsSection shows the loading skeleton while the personal entry loads', () => {
    render(<LyricsSection controller={makeController({ displayedLyrics: null })} loadingPersonal={true} />)

    expect(screen.getByLabelText('Loading lyrics...')).toBeDefined()
    expect(screen.queryByText('No lyrics added yet.')).toBeNull()
  })

  it('LyricsSection shows exactly the Band badge on the band version (ER3)', () => {
    render(<LyricsSection controller={makeController()} loadingPersonal={false} />)

    expect(screen.getByText('👥 Band')).toBeDefined()
    expect(screen.queryByText('👤 My version')).toBeNull()
  })

  it('LyricsSection shows exactly the My version badge on the personal version (ER3)', () => {
    render(
      <LyricsSection
        controller={makeController({ activeVersion: 'personal', displayedLyrics: 'my words' })}
        loadingPersonal={false}
      />,
    )

    expect(screen.getByText('👤 My version')).toBeDefined()
    expect(screen.queryByText('👥 Band')).toBeNull()
  })

  it('LyricsSection still names the version when the resolved lyrics are empty (ER3)', () => {
    render(
      <LyricsSection controller={makeController({ displayedLyrics: null })} loadingPersonal={false} />,
    )

    expect(screen.getByText('👥 Band')).toBeDefined()
    expect(screen.getByText('No lyrics added yet.')).toBeDefined()
  })

  it('LyricsSection shows no version badge outside a band (ER3)', () => {
    render(<LyricsSection controller={makeController({ isBandEntry: false })} loadingPersonal={false} />)

    expect(screen.queryByText('👥 Band')).toBeNull()
    expect(screen.queryByText('👤 My version')).toBeNull()
  })

  it('LyricsSection offers the version switcher whenever a personal version exists', () => {
    const controller = makeController({ hasPersonalVersion: true })
    const withSwitcher = render(<LyricsSection controller={controller} loadingPersonal={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'View my lyrics (👤)' }))
    expect(controller.toggleVersion).toHaveBeenCalledTimes(1)
    withSwitcher.unmount()

    // On the personal version the switcher offers the way back...
    render(
      <LyricsSection
        controller={makeController({ hasPersonalVersion: true, activeVersion: 'personal' })}
        loadingPersonal={false}
      />,
    )
    expect(screen.getByRole('button', { name: 'View Band lyrics (👥)' })).toBeDefined()
    cleanup()

    // ...and there is no switcher without a second version, nor while editing.
    render(<LyricsSection controller={makeController()} loadingPersonal={false} />)
    expect(screen.queryByText(/View my lyrics/)).toBeNull()
    cleanup()

    render(
      <LyricsSection
        controller={makeController({ hasPersonalVersion: true, isEditing: true })}
        loadingPersonal={false}
      />,
    )
    expect(screen.queryByText(/View my lyrics/)).toBeNull()
  })

  it('LyricsSection reports the Stage Mode button press', () => {
    const controller = makeController()
    const open = render(<LyricsSection controller={controller} loadingPersonal={false} />)

    fireEvent.click(screen.getByText('🔍 Stage Mode'))
    expect(controller.openStage).toHaveBeenCalledTimes(1)
    open.unmount()

    // Nothing to stage without lyrics, and no stage button while editing.
    render(<LyricsSection controller={makeController({ displayedLyrics: null })} loadingPersonal={false} />)
    expect(screen.queryByText('🔍 Stage Mode')).toBeNull()
    cleanup()

    render(<LyricsSection controller={makeController({ isEditing: true })} loadingPersonal={false} />)
    expect(screen.queryByText('🔍 Stage Mode')).toBeNull()
  })

  it('LyricsSection reports the Edit button press and labels it Add without lyrics', () => {
    const controller = makeController()
    const withLyrics = render(<LyricsSection controller={controller} loadingPersonal={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(controller.startEditing).toHaveBeenCalledTimes(1)
    withLyrics.unmount()

    render(<LyricsSection controller={makeController({ displayedLyrics: null })} loadingPersonal={false} />)
    expect(screen.getByRole('button', { name: 'Add' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('LyricsSection renders the editor panel instead of the viewer while editing', () => {
    render(
      <LyricsSection
        controller={makeController({ isEditing: true, draft: 'typed words' })}
        loadingPersonal={false}
      />,
    )

    expect(screen.getByPlaceholderText('Paste or type the lyrics here...')).toBeDefined()
    expect(screen.queryByText('No lyrics added yet.')).toBeNull()
  })
})

describe('LyricsEditorPanel', () => {
  it('LyricsEditorPanel reports every draft keystroke', () => {
    const controller = makeController({ isEditing: true, draft: 'verse one' })
    render(<LyricsEditorPanel controller={controller} />)

    const textarea = screen.getByPlaceholderText('Paste or type the lyrics here...') as HTMLTextAreaElement
    expect(textarea.value).toBe('verse one')

    fireEvent.change(textarea, { target: { value: 'verse two' } })

    expect(controller.setDraft).toHaveBeenCalledWith('verse two')
  })

  it('LyricsEditorPanel reports the auto-import press and shows the importing state', () => {
    const controller = makeController({ isEditing: true })
    const idle = render(<LyricsEditorPanel controller={controller} />)

    fireEvent.click(screen.getByText('✨ Auto-import'))
    expect(controller.autoImport).toHaveBeenCalledTimes(1)
    idle.unmount()

    render(<LyricsEditorPanel controller={makeController({ isEditing: true, fetching: true })} />)
    const importing = screen.getByText('Importing...', { exact: false })
    expect(importing).toBeDefined()
    expect((importing.closest('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('LyricsEditorPanel reports the save press and shows the saving state', () => {
    const controller = makeController({ isEditing: true })
    const idle = render(<LyricsEditorPanel controller={controller} />)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(controller.save).toHaveBeenCalledTimes(1)
    idle.unmount()

    render(<LyricsEditorPanel controller={makeController({ isEditing: true, saving: true })} />)
    const saving = screen.getByText('Saving...', { exact: false })
    expect(saving).toBeDefined()
    expect((saving.closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByPlaceholderText('Paste or type the lyrics here...') as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('LyricsEditorPanel offers Discard my version only when the controller allows it (ER8)', () => {
    const hidden = render(<LyricsEditorPanel controller={makeController({ isEditing: true })} />)
    expect(screen.queryByRole('button', { name: /Discard my version/ })).toBeNull()
    hidden.unmount()

    const controller = makeController({ isEditing: true, editTarget: 'personal', canDiscardPersonal: true })
    render(<LyricsEditorPanel controller={controller} />)

    fireEvent.click(screen.getByRole('button', { name: /Discard my version/ }))
    expect(controller.requestDiscard).toHaveBeenCalledTimes(1)
  })

  it('LyricsEditorPanel confirms the discard in-page, never through a browser dialog (ER8)', () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const controller = makeController({
      isEditing: true,
      editTarget: 'personal',
      canDiscardPersonal: true,
      isDiscardPending: true,
    })
    render(<LyricsEditorPanel controller={controller} />)

    expect(screen.getByRole('alertdialog')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(controller.confirmDiscard).toHaveBeenCalledTimes(1)
    expect(confirmSpy).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('LyricsEditorPanel names the version being edited (ER4)', () => {
    const band = render(<LyricsEditorPanel controller={makeController({ isEditing: true, editTarget: 'band' })} />)
    expect(screen.getByText('👥 Editing the band lyrics')).toBeDefined()
    band.unmount()

    render(<LyricsEditorPanel controller={makeController({ isEditing: true, editTarget: 'personal' })} />)
    expect(screen.getByText('👤 Editing my version')).toBeDefined()
  })

  it('LyricsEditorPanel reports the cancel press', () => {
    const controller = makeController({ isEditing: true })
    render(<LyricsEditorPanel controller={controller} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(controller.cancelEditing).toHaveBeenCalledTimes(1)
  })
})

/**
 * RH-83 ER2 — first paint, through the real controller.
 *
 * The only place in this file where the hook is wired to the section: every
 * test above drives a fixture, which cannot show that the *resolution* rule
 * reaches the screen with no interaction at all. A test may import `src/hooks`
 * (F21 exempts `__tests__`); the component still may not, and does not.
 */
const BAND_ROW: Repertoire = {
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

const NOOP_ACTIONS: LyricsEditorActions = {
  updateLyrics: vi.fn().mockResolvedValue(undefined),
  fetchLyrics: vi.fn().mockResolvedValue(null),
  addSong: vi.fn(),
}

function LyricsHost({ personalEntry }: { personalEntry: Repertoire | null }) {
  const controller = useLyricsEditor({
    entry: BAND_ROW,
    personalEntry,
    songTitle: 'Song',
    artist: 'Artist',
    actions: NOOP_ACTIONS,
    onEntryLyricsSaved: vi.fn(),
    onPersonalLyricsSaved: vi.fn(),
    onPersonalEntryCreated: vi.fn(),
    notify: vi.fn(),
  })
  return <LyricsSection controller={controller} loadingPersonal={false} />
}

describe('Fast View lyrics on first paint (ER2)', () => {
  it('shows the personal version, and says so, with no user interaction', () => {
    const personal: Repertoire = { ...BAND_ROW, id: 'personal-rep', band_id: null, user_id: 'u1', lyrics: 'my words' }
    render(<LyricsHost personalEntry={personal} />)

    expect(screen.getByText('my words')).toBeDefined()
    expect(screen.queryByText('band words')).toBeNull()
    expect(screen.getByText('👤 My version')).toBeDefined()
  })

  it('shows the band version when the personal one is empty or absent', () => {
    const emptyPersonal: Repertoire = { ...BAND_ROW, id: 'personal-rep', band_id: null, user_id: 'u1', lyrics: '   ' }
    const withEmpty = render(<LyricsHost personalEntry={emptyPersonal} />)

    expect(screen.getByText('band words')).toBeDefined()
    expect(screen.getByText('👥 Band')).toBeDefined()
    withEmpty.unmount()

    render(<LyricsHost personalEntry={null} />)
    expect(screen.getByText('band words')).toBeDefined()
    expect(screen.getByText('👥 Band')).toBeDefined()
  })
})
