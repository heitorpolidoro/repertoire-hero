// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SongLoading, SongNotFound } from '../SongLoadStates'
import { SongTagsSection } from '../SongTagsSection'
import { LinkDeleteConfirm } from '../LinkDeleteConfirm'
import type { SongLinksController } from '@/lib/songLinks'

afterEach(cleanup)

/** A controller fixture: plain data plus spies, so no hook is ever imported. */
function makeLinks(overrides: Partial<SongLinksController> = {}): SongLinksController {
  const noop = vi.fn()
  return {
    links: [], isAdding: false, label: '', url: '', saving: false,
    pendingDeleteUrl: null, deleteBusy: false,
    startAdding: noop, cancelAdding: noop, setLabel: noop, setUrl: noop,
    submit: vi.fn(), requestDelete: noop,
    confirmDelete: vi.fn(), cancelDelete: vi.fn(),
    ...overrides,
  }
}

describe('FastViewShell', () => {
  it('SongLoading renders the busy placeholder', () => {
    const { container } = render(<SongLoading />)

    expect(screen.getByText('Loading...')).toBeDefined()
    expect((container.firstChild as HTMLElement).getAttribute('aria-busy')).toBe('true')
  })

  it('SongNotFound reports the back press', () => {
    const onBack = vi.fn()
    render(<SongNotFound onBack={onBack} />)

    expect(screen.getByText('Song not found')).toBeDefined()
    fireEvent.click(screen.getByRole('button'))

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('SongTagsSection renders nothing when there are no tags', () => {
    const { container } = render(<SongTagsSection tags={[]} />)

    expect(container.firstChild).toBeNull()
  })

  it('SongTagsSection renders one chip per tag', () => {
    render(<SongTagsSection tags={['rock', 'setlist-2026']} />)

    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['rock', 'setlist-2026'])
    expect(screen.getByText('Tags')).toBeDefined()
  })

  it('LinkDeleteConfirm renders nothing until a delete is pending', () => {
    const { container } = render(<LinkDeleteConfirm controller={makeLinks()} />)

    expect(container.firstChild).toBeNull()
  })

  it('LinkDeleteConfirm asks the exact delete question and reports confirm and cancel', () => {
    const controller = makeLinks({ pendingDeleteUrl: 'https://youtube.com/watch?v=1' })
    render(<LinkDeleteConfirm controller={controller} />)

    expect(screen.getByText("Delete this link? This can't be undone.")).toBeDefined()

    fireEvent.click(screen.getByText('Delete'))
    fireEvent.click(screen.getByText('Cancel'))

    expect(controller.confirmDelete).toHaveBeenCalledTimes(1)
    expect(controller.cancelDelete).toHaveBeenCalledTimes(1)
  })
})
