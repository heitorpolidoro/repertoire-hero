// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SongIdentityHeader } from '../SongIdentityHeader'
import { StatusDropdown } from '../StatusDropdown'
import type { SongIdentity } from '@/lib/songEntry'
import type { SongStatusController } from '@/lib/songStatus'

afterEach(cleanup)

const IDENTITY: SongIdentity = { title: 'Black Dog', artist: 'Led Zeppelin', key: 'A' }

/** A controller fixture: plain data plus spies, so no hook is ever imported. */
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

describe('SongIdentityHeader', () => {
  it('SongIdentityHeader shows the title and the artist', () => {
    render(<SongIdentityHeader identity={IDENTITY} status={makeStatus()} />)

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Black Dog')
    expect(screen.getByText('Led Zeppelin')).toBeDefined()
  })

  it('SongIdentityHeader omits the artist line when the song has none', () => {
    render(<SongIdentityHeader identity={{ ...IDENTITY, artist: '' }} status={makeStatus()} />)

    expect(screen.queryByText('Led Zeppelin')).toBeNull()
  })

  it('SongIdentityHeader shows the key when there is one', () => {
    const { rerender } = render(<SongIdentityHeader identity={IDENTITY} status={makeStatus()} />)

    expect(screen.getByText('Key:')).toBeDefined()
    expect(screen.getByText(/A/)).toBeDefined()

    rerender(<SongIdentityHeader identity={{ ...IDENTITY, key: null }} status={makeStatus()} />)
    expect(screen.queryByText('Key:')).toBeNull()
  })

  it('StatusDropdown shows the current status label on the trigger', () => {
    render(<StatusDropdown controller={makeStatus({ status: 'polishing' })} />)

    expect(screen.getAllByRole('button')[0].textContent).toContain('Polishing')
  })

  it('StatusDropdown reports the trigger press', () => {
    const controller = makeStatus()
    render(<StatusDropdown controller={controller} />)

    fireEvent.click(screen.getAllByRole('button')[0])

    expect(controller.toggleDropdown).toHaveBeenCalledTimes(1)
  })

  it('StatusDropdown lists the five statuses in mastery order while open', () => {
    render(<StatusDropdown controller={makeStatus({ isDropdownOpen: true })} />)

    const labels = screen.getAllByRole('listitem').map((li) => li.textContent)

    expect(labels).toHaveLength(5)
    expect(labels[0]).toContain('Unknown')
    expect(labels[1]).toContain('Learning')
    expect(labels[2]).toContain('Practicing')
    expect(labels[3]).toContain('Polishing')
    expect(labels[4]).toContain('Mastered')
  })

  it('StatusDropdown marks the current status as selected', () => {
    render(<StatusDropdown controller={makeStatus({ status: 'practicing', isDropdownOpen: true })} />)

    const rows = screen.getAllByRole('listitem')

    expect(rows[2].textContent).toContain('✓')
    expect(rows[0].textContent).not.toContain('✓')
  })

  it('StatusDropdown reports the status the musician picked', () => {
    const controller = makeStatus({ isDropdownOpen: true })
    render(<StatusDropdown controller={controller} />)

    fireEvent.click(screen.getByText('Mastered'))

    expect(controller.change).toHaveBeenCalledWith('mastered')
  })

  it('StatusDropdown disables the trigger while a status write is in flight', () => {
    render(<StatusDropdown controller={makeStatus({ updating: true })} />)

    expect((screen.getAllByRole('button')[0] as HTMLButtonElement).disabled).toBe(true)
  })
})
