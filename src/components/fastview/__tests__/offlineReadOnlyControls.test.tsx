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
import { render, screen, cleanup } from '@testing-library/react'
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

  it('keeps lyrics Stage Mode reachable when read-only — reading is not a write', () => {
    render(<LyricsSection controller={makeLyrics()} loadingPersonal={false} readOnly />)

    expect(screen.getByRole('button', { name: /Stage Mode/ }).hasAttribute('disabled')).toBe(false)
  })
})
