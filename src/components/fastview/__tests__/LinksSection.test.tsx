// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { LinksSection } from '../LinksSection'
import { AddLinkForm } from '../AddLinkForm'
import { LinkIcon } from '../LinkIcon'
import type { SongLinksController } from '@/lib/songLinks'

afterEach(cleanup)

/** A controller fixture: plain data plus spies, so no hook is ever imported. */
function makeController(overrides: Partial<SongLinksController> = {}): SongLinksController {
  return {
    links: [
      { label: 'Chords', url: 'https://cifraclub.com.br/black-dog' },
      { label: 'Video', url: 'https://youtube.com/watch?v=1' },
    ],
    isAdding: false,
    startAdding: vi.fn(),
    cancelAdding: vi.fn(),
    label: '',
    setLabel: vi.fn(),
    url: '',
    setUrl: vi.fn(),
    saving: false,
    submit: vi.fn().mockResolvedValue(undefined),
    pendingDeleteUrl: null,
    deleteBusy: false,
    requestDelete: vi.fn(),
    confirmDelete: vi.fn().mockResolvedValue(undefined),
    cancelDelete: vi.fn(),
    ...overrides,
  }
}

describe('LinksSection', () => {
  it('LinksSection renders one card per link with its label', () => {
    render(<LinksSection controller={makeController()} onDelete={vi.fn()} />)

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Chords')).toBeDefined()
    expect(screen.getByText('Video')).toBeDefined()
    expect(screen.getAllByRole('link')[0].getAttribute('href')).toBe('https://cifraclub.com.br/black-dog')
  })

  it('LinksSection shows the empty state when there are no links', () => {
    render(<LinksSection controller={makeController({ links: [] })} onDelete={vi.fn()} />)

    expect(screen.getByText('No links added yet.')).toBeDefined()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('LinksSection reports the delete press with the url of that link', () => {
    const onDelete = vi.fn()
    render(<LinksSection controller={makeController()} onDelete={onDelete} />)

    fireEvent.click(screen.getAllByLabelText('Delete link')[1])

    expect(onDelete).toHaveBeenCalledWith('https://youtube.com/watch?v=1')
  })

  it('LinksSection opens the add form from the Add Link button', () => {
    const controller = makeController()
    render(<LinksSection controller={controller} onDelete={vi.fn()} />)

    fireEvent.click(screen.getByText('+ Add Link'))

    expect(controller.startAdding).toHaveBeenCalledTimes(1)
    // The trigger is replaced by the form itself once it is open.
    cleanup()
    render(<LinksSection controller={makeController({ isAdding: true })} onDelete={vi.fn()} />)
    expect(screen.queryByText('+ Add Link')).toBeNull()
    expect(screen.getByText('Add New Link')).toBeDefined()
  })

  it('LinkIcon renders a distinct icon for Spotify, YouTube, a chord site, a PDF and an unknown url', () => {
    const urls = [
      'https://open.spotify.com/track/1',
      'https://youtu.be/abc',
      'https://cifraclub.com.br/black-dog',
      'https://files.example.com/chart.pdf',
      'https://example.com/anything',
    ]
    const rendered = urls.map((url) => render(<LinkIcon url={url} />).container.innerHTML)

    expect(new Set(rendered).size).toBe(5)
    expect(rendered[0]).toContain('#1DB954')
    expect(rendered[1]).toContain('#FF0000')
    expect(rendered[2]).toContain('#FFB600')
    expect(rendered[3]).toContain('text-blue-500')
    expect(rendered[4]).toContain('text-gray-400')
  })
})

describe('AddLinkForm', () => {
  it('AddLinkForm reports label and url keystrokes', () => {
    const controller = makeController({ isAdding: true })
    render(<AddLinkForm controller={controller} />)

    fireEvent.change(screen.getByPlaceholderText('Link Label (optional - auto-fetched if blank)'), {
      target: { value: 'My tab' },
    })
    fireEvent.change(screen.getByPlaceholderText('Link URL (https://...)'), {
      target: { value: 'https://example.com/tab' },
    })

    expect(controller.setLabel).toHaveBeenCalledWith('My tab')
    expect(controller.setUrl).toHaveBeenCalledWith('https://example.com/tab')
  })

  it('AddLinkForm reports the submit without reloading the page', () => {
    const controller = makeController({ isAdding: true })
    const { container } = render(<AddLinkForm controller={controller} />)
    const form = container.querySelector('form') as HTMLFormElement

    const notCancelled = fireEvent.submit(form)

    expect(notCancelled).toBe(false)
    expect(controller.submit).toHaveBeenCalledTimes(1)
  })

  it('AddLinkForm shows the saving state and disables the submit button', () => {
    render(<AddLinkForm controller={makeController({ isAdding: true, saving: true })} />)

    const submitButton = screen.getByText('Saving...') as HTMLButtonElement

    expect(submitButton.disabled).toBe(true)
    expect(screen.queryByText('Add')).toBeNull()
  })

  it('AddLinkForm reports the cancel press', () => {
    const controller = makeController({ isAdding: true })
    render(<AddLinkForm controller={controller} />)

    fireEvent.click(screen.getByText('Cancel'))

    expect(controller.cancelAdding).toHaveBeenCalledTimes(1)
    // Closed: the form is not on screen at all.
    cleanup()
    const { container } = render(<AddLinkForm controller={makeController({ isAdding: false })} />)
    expect(container.firstChild).toBeNull()
  })
})
