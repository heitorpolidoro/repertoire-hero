// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TabViewer } from '../TabViewer'
import { TabDestinationModal } from '../TabDestinationModal'
import { TabDeleteConfirm } from '../TabDeleteConfirm'
import { TabLibrarySection } from '../TabLibrarySection'
import type { MergedTab, TabLibraryController } from '@/lib/tabLibrary'

afterEach(cleanup)

const TAB: MergedTab = {
  id: 't-1',
  repertoire_id: 'rep-band',
  title: 'Horn section',
  file_url: 'https://blob.test/t-1.pdf',
  created_at: '2026-01-04T10:00:00.000Z',
  origin: 'band',
}

/** A controller stub: the section is presentational, so every member is a spy. */
function makeLibrary(overrides: Partial<TabLibraryController> = {}): TabLibraryController {
  return {
    tabs: [],
    activeTabId: null,
    activeTabRepertoireId: null,
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
    isDestinationModalOpen: false,
    chooseDestination: vi.fn().mockResolvedValue(undefined),
    cancelDestination: vi.fn(),
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

describe('TabDestinationModal', () => {
  it('TabDestinationModal renders nothing while it is closed', () => {
    const { container } = render(
      <TabDestinationModal open={false} uploading={false} onChoose={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('TabDestinationModal offers the personal and band destinations and reports the chosen one', () => {
    const onChoose = vi.fn()
    render(
      <TabDestinationModal open uploading={false} onChoose={onChoose} onCancel={vi.fn()} />,
    )

    expect(screen.getByText('Upload Destination')).toBeDefined()
    fireEvent.click(screen.getByText(/Personal studies/))
    expect(onChoose).toHaveBeenCalledWith('personal')

    fireEvent.click(screen.getByText(/Band files/))
    expect(onChoose).toHaveBeenLastCalledWith('band')
  })

  it('TabDestinationModal cancels without uploading', () => {
    const onCancel = vi.fn()
    const onChoose = vi.fn()
    const busy = render(<TabDestinationModal open uploading onChoose={onChoose} onCancel={onCancel} />)
    // Every button is disabled while an upload is in flight.
    const disabled = screen.getAllByRole('button') as HTMLButtonElement[]
    expect(disabled.every((button) => button.disabled)).toBe(true)
    busy.unmount()

    render(<TabDestinationModal open uploading={false} onChoose={onChoose} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onChoose).not.toHaveBeenCalled()
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
    expect(screen.getByText('No PDFs uploaded yet.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Upload PDF' })).toBeDefined()
    empty.unmount()

    const loading = render(
      <TabLibrarySection library={makeLibrary()} loadingPersonal onOpenStage={vi.fn()} />,
    )
    expect(screen.getByLabelText('Loading tabs...')).toBeDefined()
    expect(screen.queryByText('No PDFs uploaded yet.')).toBeNull()
    loading.unmount()

    const library = makeLibrary({
      tabs: [TAB],
      activeTabId: TAB.id,
      activeTabRepertoireId: TAB.repertoire_id,
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

    fireEvent.click(screen.getByRole('button', { name: 'Delete tab' }))
    expect(library.requestDelete).toHaveBeenCalledWith('t-1', 'band')

    fireEvent.click(screen.getByRole('button', { name: /Stage/ }))
    expect(onOpenStage).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(library.closeActiveTab).toHaveBeenCalledTimes(1)
  })
})
