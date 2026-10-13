// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SongMapSection } from '../SongMapSection'
import type { SongMapController } from '@/lib/songMap'

afterEach(cleanup)

const MAP = {
  sections: [
    { name: 'Intro', bars: 4, note: null },
    { name: 'Verse', bars: null, note: 'palm mute' },
  ],
}

function makeMap(overrides: Partial<SongMapController> = {}): SongMapController {
  return {
    map: MAP,
    overridden: false,
    editing: false,
    draft: [],
    updating: false,
    confirmingReset: false,
    startEdit: vi.fn(),
    cancelEdit: vi.fn(),
    addSection: vi.fn(),
    removeSection: vi.fn(),
    editSection: vi.fn(),
    moveSection: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    requestReset: vi.fn(),
    cancelReset: vi.fn(),
    confirmReset: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

const DRAFT = [
  { id: 'a', name: 'Intro', bars: '4', note: '' },
  { id: 'b', name: 'Verse', bars: '', note: 'palm mute' },
]

const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled

describe('SongMapSection read view', () => {
  it('lists the sections in order with bars and note when set', () => {
    render(<SongMapSection controller={makeMap()} />)

    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual(['Intro4 bars', 'Versepalm mute'])
    expect(screen.getByRole('button', { name: 'Edit map' })).toBeDefined()
  })

  it('shows the singular bar count', () => {
    render(<SongMapSection controller={makeMap({ map: { sections: [{ name: 'Hit', bars: 1, note: null }] } })} />)
    expect(screen.getByText('1 bar')).toBeDefined()
  })

  it('renders the empty state with Add map when nothing resolves (ER6)', () => {
    const map = makeMap({ map: null })
    render(<SongMapSection controller={map} />)

    expect(screen.getByText('No map yet')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Add map' }))
    expect(map.startEdit).toHaveBeenCalled()
  })

  it('renders the empty state for a map with no sections', () => {
    render(<SongMapSection controller={makeMap({ map: { sections: [] } })} />)
    expect(screen.getByText('No map yet')).toBeDefined()
  })

  it('marks an override and offers Use the original, behind a confirmation', () => {
    const map = makeMap({ overridden: true })
    const { rerender } = render(<SongMapSection controller={map} />)

    expect(screen.getByText('Your map')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Use the original' }))
    expect(map.requestReset).toHaveBeenCalled()
    expect(map.confirmReset).not.toHaveBeenCalled()

    const confirming = makeMap({ overridden: true, confirmingReset: true })
    rerender(<SongMapSection controller={confirming} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(confirming.cancelReset).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Use the original' }))
    expect(confirming.confirmReset).toHaveBeenCalled()
  })

  it('shows no marker and no reset when the map is inherited', () => {
    render(<SongMapSection controller={makeMap()} />)
    expect(screen.queryByText('Your map')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Use the original' })).toBeNull()
  })
})

describe('SongMapSection editor', () => {
  it('edits names, bars and notes through the controller', () => {
    const map = makeMap({ editing: true, draft: DRAFT })
    render(<SongMapSection controller={map} />)

    fireEvent.change(screen.getByLabelText('Section 1 name'), { target: { value: 'Pre' } })
    fireEvent.change(screen.getByLabelText('Section 1 bars'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('Section 2 note'), { target: { value: 'x' } })

    expect(map.editSection).toHaveBeenNthCalledWith(1, 0, { name: 'Pre' })
    expect(map.editSection).toHaveBeenNthCalledWith(2, 0, { bars: '8' })
    expect(map.editSection).toHaveBeenNthCalledWith(3, 1, { note: 'x' })
  })

  it('adds, removes and reorders sections', () => {
    const map = makeMap({ editing: true, draft: DRAFT })
    render(<SongMapSection controller={map} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add section' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove section 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move section 2 up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move section 1 down' }))

    expect(map.addSection).toHaveBeenCalled()
    expect(map.removeSection).toHaveBeenCalledWith(1)
    expect(map.moveSection).toHaveBeenNthCalledWith(1, 1, -1)
    expect(map.moveSection).toHaveBeenNthCalledWith(2, 0, 1)
  })

  it('disables moving the first section up and the last one down', () => {
    render(<SongMapSection controller={makeMap({ editing: true, draft: DRAFT })} />)

    expect(isDisabled(screen.getByRole('button', { name: 'Move section 1 up' }))).toBe(true)
    expect(isDisabled(screen.getByRole('button', { name: 'Move section 2 down' }))).toBe(true)
  })

  it('saves, and Cancel only discards the draft', () => {
    const map = makeMap({ editing: true, draft: DRAFT })
    render(<SongMapSection controller={map} />)

    fireEvent.click(screen.getByRole('button', { name: 'Save map' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(map.save).toHaveBeenCalled()
    expect(map.cancelEdit).toHaveBeenCalled()
    expect(map.confirmReset).not.toHaveBeenCalled()
  })

  it('disables the editor controls while a write is in flight', () => {
    render(<SongMapSection controller={makeMap({ editing: true, draft: DRAFT, updating: true })} />)
    expect(isDisabled(screen.getByRole('button', { name: 'Save map' }))).toBe(true)
  })
})

describe('SongMapSection read-only (ER8)', () => {
  it('disables Edit and Use the original', () => {
    render(<SongMapSection controller={makeMap({ overridden: true })} readOnly />)

    expect(isDisabled(screen.getByRole('button', { name: 'Edit map' }))).toBe(true)
    expect(isDisabled(screen.getByRole('button', { name: 'Use the original' }))).toBe(true)
  })

  it('disables Add map on the empty state', () => {
    render(<SongMapSection controller={makeMap({ map: null })} readOnly />)
    expect(isDisabled(screen.getByRole('button', { name: 'Add map' }))).toBe(true)
  })

  it('disables the editor if the connection drops while it is open', () => {
    render(<SongMapSection controller={makeMap({ editing: true, draft: DRAFT })} readOnly />)

    expect(isDisabled(screen.getByRole('button', { name: 'Save map' }))).toBe(true)
    expect(isDisabled(screen.getByRole('button', { name: 'Add section' }))).toBe(true)
    expect((screen.getByLabelText('Section 1 name') as HTMLInputElement).disabled).toBe(true)
  })
})
