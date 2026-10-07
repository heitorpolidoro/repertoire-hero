// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { TabViewer } from '../TabViewer'
import { TabDeleteConfirm } from '../TabDeleteConfirm'
import { TabLibrarySection } from '../TabLibrarySection'
import { useTabLibrary, type TabLibraryActions } from '@/hooks/useTabLibrary'
import type { TabLibraryController } from '@/lib/tabLibrary'
import type { SongFile } from '@/types/database'

afterEach(cleanup)

const TAB: SongFile = {
  id: 't-1',
  user_id: 'user-1',
  song_id: 'song-1',
  title: 'Horn section',
  file_url: 'https://blob.test/t-1.pdf',
  created_at: '2026-01-04T10:00:00.000Z',
}

/** A controller stub: the section is presentational, so every member is a spy. */
function makeLibrary(overrides: Partial<TabLibraryController> = {}): TabLibraryController {
  return {
    tabs: [],
    activeTabId: null,
    activeTabUrl: null,
    activeTabTitle: '',
    selectTab: vi.fn(),
    closeActiveTab: vi.fn(),
    uploadTitle: '',
    uploadFile: null,
    uploading: false,
    uploadError: null,
    fileInputRef: { current: null },
    setUploadTitle: vi.fn(),
    pickFile: vi.fn(),
    submitUpload: vi.fn(),
    pendingDelete: null,
    deleteBusy: false,
    requestDelete: vi.fn(),
    confirmDelete: vi.fn().mockResolvedValue(undefined),
    cancelDelete: vi.fn(),
    ...overrides,
  }
}

describe('TabViewer', () => {
  it('TabViewer renders nothing without an active tab', () => {
    const { container } = render(
      <TabViewer url={null} title="" onOpenStage={vi.fn()} onClose={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('TabViewer embeds the active tab url in the Google viewer iframe', () => {
    const { container } = render(
      <TabViewer
        url="https://blob.test/t-1.pdf"
        title="Horn section"
        onOpenStage={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText(/Viewing:/).textContent).toContain('Horn section')
    const iframe = container.querySelector('iframe') as HTMLIFrameElement
    expect(iframe.getAttribute('src')).toBe(
      `https://docs.google.com/gview?url=${encodeURIComponent('https://blob.test/t-1.pdf')}&embedded=true`,
    )
    expect(iframe.getAttribute('title')).toBe('Horn section')
  })

  it('TabViewer opens Stage Mode and closes the viewer from the header buttons', () => {
    const onOpenStage = vi.fn()
    const onClose = vi.fn()
    render(
      <TabViewer
        url="https://blob.test/t-1.pdf"
        title="Horn section"
        onOpenStage={onOpenStage}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Stage/ }))
    expect(onOpenStage).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('TabDeleteConfirm', () => {
  it('TabDeleteConfirm renders nothing when no tab delete is pending', () => {
    const { container } = render(
      <TabDeleteConfirm pending={false} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('TabDeleteConfirm asks for confirmation with the tab wording and reports confirm and cancel', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<TabDeleteConfirm pending busy={false} onConfirm={onConfirm} onCancel={onCancel} />)

    expect(screen.getByText("Delete this tab? This can't be undone.")).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('TabLibrarySection', () => {
  it('TabLibrarySection shows the empty state, the loading skeleton and the list in turn', () => {
    const empty = render(
      <TabLibrarySection library={makeLibrary()} loadingPersonal={false} onOpenStage={vi.fn()} />,
    )
    expect(screen.getByText('No files uploaded yet.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Upload File' })).toBeDefined()
    empty.unmount()

    const loading = render(
      <TabLibrarySection library={makeLibrary()} loadingPersonal onOpenStage={vi.fn()} />,
    )
    expect(screen.getByLabelText('Loading tabs...')).toBeDefined()
    expect(screen.queryByText('No files uploaded yet.')).toBeNull()
    loading.unmount()

    const library = makeLibrary({
      tabs: [TAB],
      activeTabId: TAB.id,
      activeTabUrl: TAB.file_url,
      activeTabTitle: TAB.title,
    })
    const onOpenStage = vi.fn()
    render(
      <TabLibrarySection library={library} loadingPersonal={false} onOpenStage={onOpenStage} />,
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    fireEvent.click(screen.getByText('Horn section'))
    expect(library.selectTab).toHaveBeenCalledWith(TAB)

    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }))
    expect(library.requestDelete).toHaveBeenCalledWith('t-1')

    fireEvent.click(screen.getByRole('button', { name: /Stage/ }))
    expect(onOpenStage).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(library.closeActiveTab).toHaveBeenCalledTimes(1)
  })
})

/**
 * ER7 — the Fast View file library, rendered end to end through the real
 * controller, for a song the user holds **no** repertoire row for.
 *
 * The page's only input is the song id, and that is the whole point: before
 * RH-123 the section was fed by a fetch keyed on a repertoire row, so a song
 * the musician had never added could not list their files at all. Nothing is
 * stubbed here but the injected action.
 */
describe('the file library for a song the user holds no repertoire row for', () => {
  function Harness({ actions }: { actions: TabLibraryActions }) {
    const library = useTabLibrary({
      songId: 'song-1',
      actions,
      onPersonalEntryCreated: vi.fn(),
      notify: vi.fn(),
    })
    return <TabLibrarySection library={library} loadingPersonal={false} onOpenStage={vi.fn()} />
  }

  it("lists that user's own files, resolved by song id in a single fetch", async () => {
    const getTabs = vi.fn().mockResolvedValue([TAB])
    const actions = {
      getTabs,
      uploadTab: vi.fn(),
      deleteTab: vi.fn(),
    } as unknown as TabLibraryActions

    await act(async () => {
      render(<Harness actions={actions} />)
    })

    expect(getTabs).toHaveBeenCalledTimes(1)
    expect(getTabs).toHaveBeenCalledWith('song-1')
    expect(screen.getByText('Horn section')).toBeDefined()
    expect(screen.queryByText('No files uploaded yet.')).toBeNull()
  })
})
