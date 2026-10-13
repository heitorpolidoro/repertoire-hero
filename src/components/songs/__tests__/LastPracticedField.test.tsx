// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import {
  LastPracticedField,
  lastPracticedDraft,
  lastPracticedPatch,
} from '../LastPracticedField'
import type { Repertoire } from '@/types/database'

afterEach(cleanup)

const entry = (last_practiced: string | null) => ({ last_practiced }) as Repertoire

describe('lastPracticedDraft (RH-157)', () => {
  it('formats the stored instant as its UTC day', () => {
    expect(lastPracticedDraft(entry('2026-05-01T23:30:00.000Z'))).toBe('2026-05-01')
  })

  it('is blank for a null date, no entry, or an unreadable value', () => {
    expect(lastPracticedDraft(entry(null))).toBe('')
    expect(lastPracticedDraft(undefined)).toBe('')
    expect(lastPracticedDraft(entry('garbage'))).toBe('')
  })
})

describe('lastPracticedPatch (RH-157)', () => {
  const loaded = entry('2026-05-01T12:00:00.000Z')

  it('sends nothing while the draft equals the loaded day', () => {
    expect(lastPracticedPatch('2026-05-01', loaded)).toEqual({})
    expect(lastPracticedPatch('', entry(null))).toEqual({})
  })

  it('sends the new day when it changed, earlier included', () => {
    expect(lastPracticedPatch('2026-01-01', loaded)).toEqual({ last_practiced: '2026-01-01' })
  })

  it('sends null when the draft was cleared', () => {
    expect(lastPracticedPatch('', loaded)).toEqual({ last_practiced: null })
  })
})

describe('LastPracticedField (RH-157)', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(<LastPracticedField visible={false} value="2026-05-01" onChange={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the draft and reports an edit', () => {
    const onChange = vi.fn()
    render(<LastPracticedField visible value="2026-05-01" onChange={onChange} />)

    const input = screen.getByLabelText('Last practiced') as HTMLInputElement
    expect(input.value).toBe('2026-05-01')
    fireEvent.change(input, { target: { value: '2026-04-01' } })
    expect(onChange).toHaveBeenCalledWith('2026-04-01')
  })

  it('clears through its Clear control, which is absent for a blank field', () => {
    const onChange = vi.fn()
    const { rerender } = render(<LastPracticedField visible value="2026-05-01" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Clear last practiced' }))
    expect(onChange).toHaveBeenCalledWith('')

    rerender(<LastPracticedField visible value="" onChange={onChange} />)
    expect(screen.queryByRole('button', { name: 'Clear last practiced' })).toBeNull()
  })
})
