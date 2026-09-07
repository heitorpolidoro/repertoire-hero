// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TabList } from '../TabList'
import type { MergedTab } from '@/lib/tabLibrary'

afterEach(cleanup)

const TABS: MergedTab[] = [
  {
    id: 't-1',
    repertoire_id: 'rep-band',
    title: 'Horn section',
    file_url: 'https://blob.test/t-1.pdf',
    created_at: '2026-01-04T10:00:00.000Z',
    origin: 'band',
  },
  {
    id: 'p-1',
    repertoire_id: 'rep-personal',
    title: 'My cheatsheet',
    file_url: 'https://blob.test/p-1.pdf',
    created_at: '2026-01-03T10:00:00.000Z',
    origin: 'personal',
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
  it('renders one row per tab with its title and origin badge', () => {
    renderList()

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Horn section')).toBeDefined()
    expect(screen.getByText('My cheatsheet')).toBeDefined()
    expect(screen.getByTitle('Shared with the whole band').textContent).toContain('Band')
    expect(screen.getByTitle('Private study file').textContent).toContain('Personal')
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

  it('calls onDelete with the tab id and origin', () => {
    const { onDelete } = renderList()

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete tab' })[1])

    expect(onDelete).toHaveBeenCalledWith('p-1', 'personal')
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
