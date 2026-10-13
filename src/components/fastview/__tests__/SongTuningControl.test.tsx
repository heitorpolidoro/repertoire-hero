// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SongTuningControl } from '../SongTuningControl'
import type { SongTuningController } from '@/lib/songTuning'

afterEach(cleanup)

function makeTuning(overrides: Partial<SongTuningController> = {}): SongTuningController {
  return { tuning: 'Drop D', updating: false, save: vi.fn().mockResolvedValue(undefined), ...overrides }
}

describe('SongTuningControl', () => {
  it('shows the resolved tuning and an enabled Edit button', () => {
    render(<SongTuningControl tuning={makeTuning()} />)

    expect(screen.getByText('Tuning:')).toBeDefined()
    expect(screen.getByText('Drop D')).toBeDefined()
    expect((screen.getByRole('button', { name: 'Edit tuning' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows only the Edit control when nothing resolves', () => {
    render(<SongTuningControl tuning={makeTuning({ tuning: null })} />)

    expect(screen.queryByText('Tuning:')).toBeNull()
    expect(screen.getByRole('button', { name: 'Set tuning' })).toBeDefined()
  })

  it('disables Edit when read-only and renders nothing when read-only with no value', () => {
    const { rerender, container } = render(<SongTuningControl tuning={makeTuning()} readOnly />)
    expect((screen.getByRole('button', { name: 'Edit tuning' }) as HTMLButtonElement).disabled).toBe(true)

    rerender(<SongTuningControl tuning={makeTuning({ tuning: null })} readOnly />)
    expect(container.textContent).toBe('')
  })

  it('saves a preset in one tap', () => {
    const tuning = makeTuning()
    render(<SongTuningControl tuning={tuning} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit tuning' }))
    fireEvent.click(screen.getByRole('button', { name: 'DADGAD' }))

    expect(tuning.save).toHaveBeenCalledWith('DADGAD')
  })

  it('saves the custom box, and Clear saves an empty string', () => {
    const tuning = makeTuning()
    render(<SongTuningControl tuning={tuning} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit tuning' }))
    fireEvent.change(screen.getByLabelText('Custom tuning'), { target: { value: ' Eb Ab Db Gb Bb Eb ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(tuning.save).toHaveBeenLastCalledWith(' Eb Ab Db Gb Bb Eb ')

    fireEvent.click(screen.getByRole('button', { name: 'Edit tuning' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(tuning.save).toHaveBeenLastCalledWith('')
  })

  it('Cancel closes the editor without writing', () => {
    const tuning = makeTuning()
    render(<SongTuningControl tuning={tuning} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit tuning' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('Custom tuning')).toBeNull()
    expect(tuning.save).not.toHaveBeenCalled()
  })

  it('disables the editor buttons while a write is in flight', () => {
    const { rerender } = render(<SongTuningControl tuning={makeTuning()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit tuning' }))

    rerender(<SongTuningControl tuning={makeTuning({ updating: true })} />)
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('stays closed if the page goes read-only while the editor is open', () => {
    const tuning = makeTuning()
    const { rerender } = render(<SongTuningControl tuning={tuning} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit tuning' }))

    rerender(<SongTuningControl tuning={tuning} readOnly />)

    expect(screen.queryByLabelText('Custom tuning')).toBeNull()
  })
})
