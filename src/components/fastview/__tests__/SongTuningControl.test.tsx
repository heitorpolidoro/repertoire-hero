// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SongTuningControl } from '../SongTuningControl'
import type { SongTuningController } from '@/lib/songTuning'

afterEach(cleanup)

function makeTuning(overrides: Partial<SongTuningController> = {}): SongTuningController {
  return { tuning: 'Drop D', updating: false, save: vi.fn().mockResolvedValue(undefined), ...overrides }
}

const UNDROP_POSITIONS = [
  ['F (+0.5)', 'F Bb Eb Ab C F'],
  ['E', 'E A D G B E'],
  ['Eb (-0.5)', 'Eb Ab Db Gb Bb Eb'],
  ['D (-1)', 'D G C F A D'],
  ['Db (-1.5)', 'Db Gb B E Ab Db'],
  ['C (-2)', 'C F Bb Eb G C'],
  ['B (-2.5)', 'B E A D Gb B'],
  ['Bb (-3)', 'Bb Eb Ab Db F Bb'],
] as const

const DROP_POSITIONS = [
  ['Drop Eb (+0.5)', 'Eb Bb Eb Ab C F'],
  ['Drop D', 'D A D G B E'],
  ['Drop Db (-0.5)', 'Db Ab Db Gb Bb Eb'],
  ['Drop C (-1)', 'C G C F A D'],
  ['Drop B (-1.5)', 'B Gb B E Ab Db'],
  ['Drop Bb (-2)', 'Bb F Bb Eb G C'],
  ['Drop A (-2.5)', 'A E A D Gb B'],
  ['Drop Ab (-3)', 'Ab Eb Ab Db F Bb'],
] as const

describe('SongTuningControl', () => {
  it('shows the label with offset for a canonical tuning and raw text for a custom one', () => {
    const { rerender } = render(<SongTuningControl tuning={makeTuning({ tuning: 'Eb' })} />)

    expect(screen.getByText('Tuning:')).toBeDefined()
    expect(screen.getByText('Eb (-0.5)')).toBeDefined()
    expect((screen.getByRole('button', { name: 'Edit tuning' }) as HTMLButtonElement).disabled).toBe(false)

    rerender(<SongTuningControl tuning={makeTuning({ tuning: 'DADGAD' })} />)
    expect(screen.getByText('DADGAD')).toBeDefined()
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

  it('lists 8 positions in order with 6-string references when Drop is unchecked', () => {
    render(<SongTuningControl tuning={makeTuning({ tuning: 'Eb' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit tuning' }))

    const checkbox = screen.getByRole('checkbox', {
      name: 'Drop (6th string one more whole step down)',
    }) as HTMLInputElement
    expect(checkbox.checked).toBe(false)

    const positionButtons = UNDROP_POSITIONS.map(([label]) => screen.getByRole('button', { name: label }))
    expect(positionButtons).toHaveLength(8)

    UNDROP_POSITIONS.forEach(([label, ref], idx) => {
      const btn = positionButtons[idx]
      expect(btn.textContent).toContain(label)
      expect(btn.textContent).toContain(ref)
      expect(btn.getAttribute('aria-pressed')).toBe(label === 'Eb (-0.5)' ? 'true' : 'false')
    })
  })

  it('starts Drop checked on a drop tuning and relabels the 8 positions on toggle without calling save', () => {
    const tuning = makeTuning({ tuning: 'Drop Db' })
    render(<SongTuningControl tuning={tuning} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit tuning' }))

    const checkbox = screen.getByRole('checkbox', {
      name: 'Drop (6th string one more whole step down)',
    }) as HTMLInputElement
    expect(checkbox.checked).toBe(true)

    DROP_POSITIONS.forEach(([label, ref]) => {
      const btn = screen.getByRole('button', { name: label })
      expect(btn.textContent).toContain(label)
      expect(btn.textContent).toContain(ref)
      expect(btn.getAttribute('aria-pressed')).toBe(label === 'Drop Db (-0.5)' ? 'true' : 'false')
    })

    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(false)
    expect(screen.getByRole('button', { name: 'Eb (-0.5)' }).getAttribute('aria-pressed')).toBe('false')
    expect(tuning.save).not.toHaveBeenCalled()
  })

  it('saves the canonical text in one tap for both standard-interval and drop positions', () => {
    const tuning = makeTuning({ tuning: 'E' })
    render(<SongTuningControl tuning={tuning} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit tuning' }))
    fireEvent.click(screen.getByRole('button', { name: 'Eb (-0.5)' }))
    expect(tuning.save).toHaveBeenLastCalledWith('Eb')
    expect(screen.queryByLabelText('Custom tuning')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Edit tuning' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Drop (6th string one more whole step down)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Drop Db (-0.5)' }))
    expect(tuning.save).toHaveBeenLastCalledWith('Drop Db')
  })

  it('pre-fills the custom box only for a custom value and leaves it empty for a canonical or null one', () => {
    const { rerender } = render(<SongTuningControl tuning={makeTuning({ tuning: 'DADGAD' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit tuning' }))
    expect((screen.getByLabelText('Custom tuning') as HTMLInputElement).value).toBe('DADGAD')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    rerender(<SongTuningControl tuning={makeTuning({ tuning: 'Eb' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit tuning' }))
    expect((screen.getByLabelText('Custom tuning') as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    rerender(<SongTuningControl tuning={makeTuning({ tuning: null })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set tuning' }))
    expect((screen.getByLabelText('Custom tuning') as HTMLInputElement).value).toBe('')
  })

  it('saves the custom box, and Clear saves an empty string', () => {
    const tuning = makeTuning()
    render(<SongTuningControl tuning={tuning} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit tuning' }))
    fireEvent.change(screen.getByLabelText('Custom tuning'), { target: { value: ' DADGAD ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(tuning.save).toHaveBeenLastCalledWith(' DADGAD ')

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
    expect((screen.getByRole('button', { name: 'Drop D' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('stays closed if the page goes read-only while the editor is open', () => {
    const tuning = makeTuning()
    const { rerender } = render(<SongTuningControl tuning={tuning} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit tuning' }))

    rerender(<SongTuningControl tuning={tuning} readOnly />)

    expect(screen.queryByLabelText('Custom tuning')).toBeNull()
  })
})

