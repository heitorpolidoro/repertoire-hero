// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { LyricsStageOverlay } from '../LyricsStageOverlay'
import type { LyricsEditorController } from '@/lib/lyricsEditor'

afterEach(cleanup)

/**
 * The editing half of the controller, which this overlay never reads: every
 * member of it is inert here, so the fixtures below name only the stage ones.
 */
function editingMembers() {
  const flags = { isBandEntry: false, hasDifferentPersonalLyrics: false, showPersonalLyrics: false }
  const editState = { isEditing: false, draft: '', saving: false, fetching: false }
  const callbacks = {
    toggleVersion: vi.fn(),
    setDraft: vi.fn(),
    startEditing: vi.fn(),
    cancelEditing: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    autoImport: vi.fn().mockResolvedValue(undefined),
  }
  return { ...flags, ...editState, ...callbacks }
}

/** A controller fixture: plain data plus spies, so no hook is ever imported. */
function makeController(overrides: Partial<LyricsEditorController> = {}): LyricsEditorController {
  return {
    displayedLyrics: 'band words',
    isStageOpen: true,
    fontSize: 18,
    isDarkMode: false,
    openStage: vi.fn(),
    closeStage: vi.fn(),
    increaseFont: vi.fn(),
    decreaseFont: vi.fn(),
    toggleDarkMode: vi.fn(),
    ...editingMembers(),
    ...overrides,
  }
}

/** The overlay root, i.e. the element carrying the font size and the surface. */
function root(container: HTMLElement): HTMLElement {
  return container.firstElementChild as HTMLElement
}

describe('LyricsStageOverlay', () => {
  it('LyricsStageOverlay renders nothing while the stage is closed', () => {
    const { container } = render(
      <LyricsStageOverlay
        controller={makeController({ isStageOpen: false })}
        songTitle="Sultans of Swing"
        songKey="Dm"
      />,
    )

    expect(container.innerHTML).toBe('')
  })

  it('LyricsStageOverlay renders nothing when there are no lyrics', () => {
    const { container } = render(
      <LyricsStageOverlay
        controller={makeController({ displayedLyrics: null })}
        songTitle="Sultans of Swing"
        songKey="Dm"
      />,
    )

    expect(container.innerHTML).toBe('')
  })

  it('LyricsStageOverlay shows the song title and the key in the header', () => {
    const withKey = render(
      <LyricsStageOverlay controller={makeController()} songTitle="Sultans of Swing" songKey="Dm" />,
    )
    expect(screen.getByText('Sultans of Swing')).toBeDefined()
    expect(screen.getByText('Tom: Dm')).toBeDefined()
    withKey.unmount()

    render(<LyricsStageOverlay controller={makeController()} songTitle="Sultans of Swing" songKey={null} />)
    expect(screen.queryByText(/Tom:/)).toBeNull()
  })

  it('LyricsStageOverlay applies the font size it is given to the overlay root', () => {
    const { container } = render(
      <LyricsStageOverlay controller={makeController({ fontSize: 28 })} songTitle="Sultans of Swing" />,
    )

    expect(root(container).style.fontSize).toBe('28px')
  })

  it('LyricsStageOverlay switches between the light and the dark surface', () => {
    const light = render(
      <LyricsStageOverlay controller={makeController()} songTitle="Sultans of Swing" />,
    )
    expect(root(light.container).className).toContain('bg-white text-gray-900')
    expect(screen.getByTitle('Alternar Modo Escuro').textContent).toBe('🌙 Escuro')
    light.unmount()

    const dark = render(
      <LyricsStageOverlay controller={makeController({ isDarkMode: true })} songTitle="Sultans of Swing" />,
    )
    expect(root(dark.container).className).toContain('bg-gray-950 text-gray-100')
    expect(screen.getByTitle('Alternar Modo Escuro').textContent).toBe('☀️ Claro')
  })

  it('LyricsStageOverlay renders the lyrics as markup', () => {
    const { container } = render(
      <LyricsStageOverlay
        controller={makeController({ displayedLyrics: '**Chorus**' })}
        songTitle="Sultans of Swing"
      />,
    )

    expect(container.innerHTML).toContain('<strong>Chorus</strong>')
  })

  it('LyricsStageOverlay reports the font, dark mode and close button presses', () => {
    const controller = makeController()
    render(<LyricsStageOverlay controller={controller} songTitle="Sultans of Swing" />)

    fireEvent.click(screen.getByTitle('Aumentar Fonte'))
    fireEvent.click(screen.getByTitle('Diminuir Fonte'))
    fireEvent.click(screen.getByTitle('Alternar Modo Escuro'))
    fireEvent.click(screen.getByTitle('Fechar Modo Palco'))

    expect(controller.increaseFont).toHaveBeenCalledTimes(1)
    expect(controller.decreaseFont).toHaveBeenCalledTimes(1)
    expect(controller.toggleDarkMode).toHaveBeenCalledTimes(1)
    expect(controller.closeStage).toHaveBeenCalledTimes(1)
  })
})
