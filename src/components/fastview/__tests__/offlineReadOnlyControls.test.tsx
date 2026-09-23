// @vitest-environment jsdom
/**
 * RH-80 ER4 — the two edit controls the Fast View disables offline.
 *
 * The mechanism is a prop, not a hook: the page makes the single
 * `useOfflineStatus()` call and passes `readOnly` down, so these components
 * stay presentational (RH-38/RH-52) and these tests set the state directly
 * instead of faking `navigator.onLine`.
 *
 * `readOnly` is optional and defaults to `false`, which is why no other call
 * site of either component changed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { StatusDropdown } from '../StatusDropdown'
import { SongIdentityHeader } from '../SongIdentityHeader'
import { LyricsSection } from '../LyricsSection'
import type { SongIdentity } from '@/lib/songEntry'
import type { SongStatusController } from '@/lib/songStatus'
import type { LyricsEditorController } from '@/lib/lyricsEditor'

afterEach(cleanup)

const IDENTITY: SongIdentity = { title: 'Black Dog', artist: 'Led Zeppelin', key: 'A' }

function makeStatus(overrides: Partial<SongStatusController> = {}): SongStatusController {
  return {
    status: 'learning',
    updating: false,
    isDropdownOpen: false,
    toggleDropdown: vi.fn(),
    closeDropdown: vi.fn(),
    change: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function makeLyrics(overrides: Partial<LyricsEditorController> = {}): LyricsEditorController {
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

describe('read-only offline controls (RH-80 ER4)', () => {
  it('leaves the status trigger enabled by default', () => {
    render(<StatusDropdown controller={makeStatus()} />)

    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false)
  })

  it('disables the status trigger when read-only', () => {
    render(<StatusDropdown controller={makeStatus()} readOnly />)

    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
  })

  it('forwards read-only through SongIdentityHeader to the status trigger', () => {
    render(<SongIdentityHeader identity={IDENTITY} status={makeStatus()} readOnly />)

    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
  })

  it('leaves the lyrics Edit button enabled by default', () => {
    render(<LyricsSection controller={makeLyrics()} loadingPersonal={false} />)

    expect(screen.getByRole('button', { name: 'Edit' }).hasAttribute('disabled')).toBe(false)
  })

  it('disables the lyrics Edit button when read-only', () => {
    render(<LyricsSection controller={makeLyrics()} loadingPersonal={false} readOnly />)

    expect(screen.getByRole('button', { name: 'Edit' }).hasAttribute('disabled')).toBe(true)
  })

  it('disables the lyrics Add button when read-only and there are no lyrics', () => {
    render(
      <LyricsSection controller={makeLyrics({ displayedLyrics: '' })} loadingPersonal={false} readOnly />,
    )

    expect(screen.getByRole('button', { name: 'Add' }).hasAttribute('disabled')).toBe(true)
  })

  // RH-83 ER10: offline stays read-only, so the band-or-personal choice dialog
  // has no way to open — the only control that opens it is this button.
  it('cannot start an edit, and so cannot open the version dialog, when read-only', () => {
    const controller = makeLyrics()
    render(<LyricsSection controller={controller} loadingPersonal={false} readOnly />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(controller.startEditing).not.toHaveBeenCalled()
    expect(controller.isVersionChoiceOpen).toBe(false)
  })

  it('keeps lyrics Stage Mode reachable when read-only — reading is not a write', () => {
    render(<LyricsSection controller={makeLyrics()} loadingPersonal={false} readOnly />)

    expect(screen.getByRole('button', { name: /Stage Mode/ }).hasAttribute('disabled')).toBe(false)
  })
})
