// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { TabList } from '../TabList'
import type { SongFile } from '@/types/database'

afterEach(cleanup)

const TABS: SongFile[] = [
  {
    id: 't-1',
    user_id: 'user-1',
    song_id: 'song-1',
    title: 'Horn section',
    file_url: 'https://blob.test/t-1.pdf',
    created_at: '2026-01-04T10:00:00.000Z',
  },
  {
    id: 'p-1',
    user_id: 'user-1',
    song_id: 'song-1',
    title: 'My cheatsheet',
    file_url: 'https://blob.test/p-1.pdf',
    created_at: '2026-01-03T10:00:00.000Z',
  },
]

function renderList(overrides: Partial<React.ComponentProps<typeof TabList>> = {}) {
  const onSelect = vi.fn()
  const onDelete = vi.fn()
  const onSetPrimary = vi.fn()
  const view = render(
    <TabList
      tabs={TABS}
      activeTabUrl={null}
      onSelect={onSelect}
      onDelete={onDelete}
      onSetPrimary={onSetPrimary}
      {...overrides}
    />,
  )
  return { ...view, onSelect, onDelete, onSetPrimary }
}

const starOf = (row: HTMLElement) => within(row).getByRole('button', { name: 'Set as primary file' })

describe('TabList', () => {
  // RH-123 removed the band/personal badge with the duality behind it: every
  // row in this list belongs to the signed-in musician.
  it('renders one row per file with its title and no origin badge', () => {
    renderList()

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Horn section')).toBeDefined()
    expect(screen.getByText('My cheatsheet')).toBeDefined()
    expect(screen.queryByTitle('Shared with the whole band')).toBeNull()
    expect(screen.queryByTitle('Private study file')).toBeNull()
  })

  it('marks the active tab with the Viewing badge', () => {
    renderList({ activeTabUrl: 'https://blob.test/p-1.pdf' })

    expect(screen.getAllByText('Viewing')).toHaveLength(1)
    const activeRow = screen.getByText('My cheatsheet').closest('li')
    expect(activeRow?.textContent).toContain('Viewing')
    expect(activeRow?.className).toContain('border-emerald-300')
  })

  it('calls onSelect with the clicked tab', () => {
    const { onSelect } = renderList()

    fireEvent.click(screen.getByText('Horn section'))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(TABS[0])
  })

  it('calls onDelete with the file id alone', () => {
    const { onDelete } = renderList()

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete file' })[1])

    expect(onDelete).toHaveBeenCalledWith('p-1')
  })

  it('links each tab to its file url with a safe target', () => {
    renderList()

    const links = screen.getAllByTitle('Open in new tab / download') as HTMLAnchorElement[]
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://blob.test/t-1.pdf',
      'https://blob.test/p-1.pdf',
    ])
    expect(links[0].getAttribute('target')).toBe('_blank')
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer')
  })

  // RH-147
  it('exposes a set-as-primary star on every row that calls the handler with that row id', () => {
    const { onSetPrimary } = renderList()

    const stars = screen.getAllByRole('button', { name: 'Set as primary file' })
    expect(stars).toHaveLength(2)
    fireEvent.click(stars[1])

    expect(onSetPrimary).toHaveBeenCalledTimes(1)
    expect(onSetPrimary).toHaveBeenCalledWith('p-1')
  })

  it('places the star between the open link and the delete button', () => {
    renderList()

    const row = screen.getAllByRole('listitem')[0]
    const controls = Array.from(row.querySelectorAll('a[title="Open in new tab / download"], button[aria-label]'))
    expect(controls.map((el) => el.getAttribute('aria-label') ?? el.getAttribute('title'))).toEqual([
      'Open in new tab / download',
      'Set as primary file',
      'Delete file',
    ])
  })

  it('disables the star when readOnly while the open link stays enabled', () => {
    const { onSetPrimary } = renderList({ readOnly: true })

    const stars = screen.getAllByRole('button', { name: 'Set as primary file' })
    expect(stars.every((star) => star.hasAttribute('disabled'))).toBe(true)
    fireEvent.click(stars[0])
    expect(onSetPrimary).not.toHaveBeenCalled()
    const links = screen.getAllByTitle('Open in new tab / download')
    expect(links.every((link) => !link.hasAttribute('aria-disabled'))).toBe(true)
  })

  it('fills the star and badges the designated file only, without reordering the list', () => {
    renderList({ tabs: [TABS[0], { ...TABS[1], is_primary: true }] })

    const rows = screen.getAllByRole('listitem')
    expect(rows[0].textContent).toContain('Horn section')
    expect(rows[0].textContent).not.toContain('Primary')
    expect(rows[1].textContent).toContain('Primary')
    expect(screen.getAllByText('Primary')).toHaveLength(1)
    expect(starOf(rows[0]).getAttribute('aria-pressed')).toBe('false')
    expect(starOf(rows[1]).getAttribute('aria-pressed')).toBe('true')
    expect(starOf(rows[0]).querySelector('svg')?.getAttribute('fill')).toBe('none')
    expect(starOf(rows[1]).querySelector('svg')?.getAttribute('fill')).toBe('currentColor')
  })

  it('marks the oldest file when nothing is designated', () => {
    renderList()

    const rows = screen.getAllByRole('listitem')
    expect(rows[0].textContent).not.toContain('Primary')
    expect(rows[1].textContent).toContain('Primary')
    expect(starOf(rows[1]).getAttribute('aria-pressed')).toBe('true')
  })

  it('renders nothing but an empty list when there are no tabs', () => {
    renderList({ tabs: [] })

    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByRole('list')).toBeDefined()
  })
})
