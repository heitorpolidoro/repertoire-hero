// @vitest-environment jsdom
/**
 * RH-128 ER11 — the section stops calling the feature PDF-only, and carries
 * the active file's content type down to the viewer.
 *
 * The three strings this asserts the absence of are the three the upload flow
 * showed a user: the section heading, the empty state and the submit button.
 * They were all true until RH-127 taught the ingest to accept a photograph of
 * a chart and RH-128 taught the viewer to render one.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { SongFile } from '@/types/database'
import type { TabLibraryController } from '@/lib/tabLibrary'
import { TabLibrarySection } from '../TabLibrarySection'

afterEach(cleanup)

const IMAGE_TAB: SongFile = {
  id: 't-1',
  user_id: 'user-1',
  song_id: 'song-1',
  title: 'Chart photo',
  file_url: 'https://blob.example/chart.jpg',
  created_at: '2026-03-01T10:00:00.000Z',
  content_type: 'image/jpeg',
}

function controller(overrides: Partial<TabLibraryController> = {}): TabLibraryController {
  return {
    tabs: [],
    activeTabId: null,
    activeTabUrl: null,
    activeTabTitle: '',
    activeTabContentType: 'application/pdf',
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
    confirmDelete: vi.fn(),
    cancelDelete: vi.fn(),
    ...overrides,
  }
}

function renderSection(library: TabLibraryController, loadingPersonal = false) {
  return render(
    <TabLibrarySection library={library} loadingPersonal={loadingPersonal} onOpenStage={vi.fn()} />,
  )
}

describe('TabLibrarySection copy (RH-128 ER11)', () => {
  it('names files generally in the heading and the empty state', () => {
    const { container } = renderSection(controller())

    expect(container.textContent).not.toContain('Tabs (PDF)')
    expect(container.textContent).not.toContain('No PDFs uploaded yet.')
    expect(container.textContent).not.toContain('Upload PDF')
    expect(screen.getByRole('heading', { name: 'Tabs' })).toBeDefined()
    expect(screen.getByText('No files uploaded yet.')).toBeDefined()
  })

  it('hands the active file content type to the viewer, which renders the image', () => {
    const { container } = renderSection(
      controller({
        tabs: [IMAGE_TAB],
        activeTabId: IMAGE_TAB.id,
        activeTabUrl: IMAGE_TAB.file_url,
        activeTabTitle: IMAGE_TAB.title,
        activeTabContentType: 'image/jpeg',
      }),
    )

    const img = container.querySelector('img') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.getAttribute('src')).toBe(IMAGE_TAB.file_url)
    expect(container.querySelector('iframe')).toBeNull()
  })
})
