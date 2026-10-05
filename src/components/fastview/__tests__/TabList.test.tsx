// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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
  const view = render(
    <TabList tabs={TABS} activeTabUrl={null} onSelect={onSelect} onDelete={onDelete} {...overrides} />,
  )
  return { ...view, onSelect, onDelete }
}

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

  it('renders nothing but an empty list when there are no tabs', () => {
    renderList({ tabs: [] })

    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByRole('list')).toBeDefined()
  })
})
