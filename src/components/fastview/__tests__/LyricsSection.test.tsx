// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { LyricsSection } from '../LyricsSection'
import { LyricsEditorPanel } from '../LyricsEditorPanel'
import type { LyricsEditorController } from '@/lib/lyricsEditor'

afterEach(cleanup)

/** A controller fixture: plain data plus spies, so no hook is ever imported. */
function makeController(overrides: Partial<LyricsEditorController> = {}): LyricsEditorController {
  return {
    isBandEntry: true,
    displayedLyrics: 'band words',
    hasDifferentPersonalLyrics: false,
    showPersonalLyrics: false,
    toggleVersion: vi.fn(),
    isEditing: false,
    draft: '',
    setDraft: vi.fn(),
    startEditing: vi.fn(),
    cancelEditing: vi.fn(),
    saving: false,
    save: vi.fn().mockResolvedValue(undefined),
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

  it('LyricsSection shows the Band badge for a band entry on the band version', () => {
    render(<LyricsSection controller={makeController()} loadingPersonal={false} />)

    expect(screen.getByText('👥 Band')).toBeDefined()
    expect(screen.queryByText('👤 Personal')).toBeNull()
  })

  it('LyricsSection shows the Personal badge for a band entry on the personal version', () => {
    render(
      <LyricsSection controller={makeController({ showPersonalLyrics: true })} loadingPersonal={false} />,
    )

    expect(screen.getByText('👤 Personal')).toBeDefined()
    expect(screen.queryByText('👥 Band')).toBeNull()
  })

  it('LyricsSection shows no ownership badge outside a band', () => {
    render(<LyricsSection controller={makeController({ isBandEntry: false })} loadingPersonal={false} />)

    expect(screen.queryByText('👥 Band')).toBeNull()
    expect(screen.queryByText('👤 Personal')).toBeNull()
  })

  it('LyricsSection offers the version switcher only when a different personal version exists', () => {
    const controller = makeController({ hasDifferentPersonalLyrics: true })
    const withSwitcher = render(<LyricsSection controller={controller} loadingPersonal={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'View my lyrics (👤)' }))
    expect(controller.toggleVersion).toHaveBeenCalledTimes(1)
    withSwitcher.unmount()

    // On the personal version the switcher offers the way back...
    render(
      <LyricsSection
        controller={makeController({ hasDifferentPersonalLyrics: true, showPersonalLyrics: true })}
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
        controller={makeController({ hasDifferentPersonalLyrics: true, isEditing: true })}
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

  it('LyricsEditorPanel reports the cancel press', () => {
    const controller = makeController({ isEditing: true })
    render(<LyricsEditorPanel controller={controller} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(controller.cancelEditing).toHaveBeenCalledTimes(1)
  })
})
