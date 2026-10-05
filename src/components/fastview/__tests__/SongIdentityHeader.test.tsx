// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SongIdentityHeader } from '../SongIdentityHeader'
import type { SongIdentity } from '@/lib/songEntry'
import type { SongStatusController } from '@/lib/songStatus'

afterEach(cleanup)

const IDENTITY: SongIdentity = { title: 'Black Dog', artist: 'Led Zeppelin', key: 'A' }

/** A controller fixture: plain data plus spies, so no hook is ever imported. */
function makeStatus(overrides: Partial<SongStatusController> = {}): SongStatusController {
  return {
    status: 'learning',
    updating: false,
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

  // RH-102 — the dropdown is gone; the header renders the four-note control at
  // the Fast View size, and the write still belongs to the controller.
  it('renders the four-note control at the Fast View size with the current stage', () => {
    render(<SongIdentityHeader identity={IDENTITY} status={makeStatus({ status: 'polishing' })} />)

    const group = screen.getByRole('group', { name: 'Mastery status' })
    expect(screen.getAllByRole('button')).toHaveLength(4)
    expect(group.textContent).toContain('Polishing')
    expect(group.querySelector('svg')?.getAttribute('height')).toBe('32')
  })

  it('asks the controller for the status the tapped note names', () => {
    const controller = makeStatus({ status: 'learning' })
    render(<SongIdentityHeader identity={IDENTITY} status={controller} />)

    fireEvent.click(screen.getByLabelText('Set status to Mastered'))

    expect(controller.change).toHaveBeenCalledWith('mastered')
  })

  it('names each note after its outcome, so a drop and a clear are both reachable', () => {
    render(<SongIdentityHeader identity={IDENTITY} status={makeStatus({ status: 'learning' })} />)

    expect(screen.getAllByRole('button').map((note) => note.getAttribute('aria-label'))).toEqual([
      'Clear status',
      'Set status to Practicing',
      'Set status to Polishing',
      'Set status to Mastered',
    ])
  })

  it('locks the four notes while a status write is in flight, keeping their names', () => {
    const controller = makeStatus({ updating: true })
    render(<SongIdentityHeader identity={IDENTITY} status={controller} />)

    const notes = screen.getAllByRole('button') as HTMLButtonElement[]
    expect(notes).toHaveLength(4)
    expect(notes.every((note) => note.disabled)).toBe(true)
    expect(notes.every((note) => note.getAttribute('aria-label'))).toBeTruthy()

    for (const note of notes) fireEvent.click(note)
    expect(controller.change).not.toHaveBeenCalled()
  })
})
