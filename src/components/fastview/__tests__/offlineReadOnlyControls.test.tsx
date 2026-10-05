// @vitest-environment jsdom
/**
 * RH-80 ER4 — the two edit controls the Fast View disables offline.
 *
 * The mechanism is a prop, not a hook: the page makes the single
 * `useOfflineStatus()` call and passes `readOnly` down, so these components
 * stay presentational (RH-38/RH-52) and these tests set the state directly
 * instead of faking `navigator.onLine`.
 *
 * `readOnly` is optional and defaults to `false`, which is why no other call
 * site of either component changed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { useEffect, useRef, type ReactNode } from 'react'

// PDF Stage Mode is one of the surfaces under test (RH-99 ER3), and its stage
// pulls in `react-pdf`, whose `pdfjs-dist` dependency touches `DOMMatrix` at
// module load — the same two mocks `TabDrawingStage.test.tsx` carries. Here
// `Document` renders its children and `Page` reports a geometry, so the drawing
// canvas actually mounts and a pointer sequence can be aimed at it.
vi.mock('react-pdf', () => ({
  Document: ({ children, onLoadSuccess }: DocumentMockProps) => {
    const reported = useRef(false)
    useEffect(() => {
      if (reported.current) return
      reported.current = true
      onLoadSuccess?.({ numPages: 3 })
    })
    return <>{children}</>
  },
  // The geometry is reported from an effect, exactly once: a real `Page`
  // reports it per render pass, but the stage re-creates `onRenderSuccess` on
  // every render, so an unguarded report would feed `setPageGeometry` back in
  // and never settle.
  Page: ({ onRenderSuccess }: { onRenderSuccess?: (page: PageRenderInfo) => void }) => {
    const reported = useRef(false)
    useEffect(() => {
      if (reported.current) return
      reported.current = true
      onRenderSuccess?.({ width: 600, height: 800, originalWidth: 600, originalHeight: 800 })
    })
    return null
  },
}))
vi.mock('@/lib/pdfWorker', () => ({}))

import { SongIdentityHeader } from '../SongIdentityHeader'
import { LyricsSection } from '../LyricsSection'
import { LyricsEditorPanel } from '../LyricsEditorPanel'
import { LinksSection } from '../LinksSection'
import { TabLibrarySection } from '../TabLibrarySection'
import { PdfStageOverlay } from '../PdfStageOverlay'
import type { SongIdentity } from '@/lib/songEntry'
import type { SongStatusController } from '@/lib/songStatus'
import type { LyricsEditorController } from '@/lib/lyricsEditor'
import type { SongLinksController } from '@/lib/songLinks'
import type { TabLibraryController } from '@/lib/tabLibrary'
import type { SongFile } from '@/types/database'

interface DocumentMockProps {
  children?: ReactNode
  onLoadSuccess?: (doc: { numPages: number }) => void
}

interface PageRenderInfo {
  width: number
  height: number
  originalWidth: number
  originalHeight: number
}

/** Fires once, immediately, with a non-zero width so `renderWidth` resolves. */
class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { width: 700, height: 900 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

afterEach(cleanup)

const IDENTITY: SongIdentity = { title: 'Black Dog', artist: 'Led Zeppelin', key: 'A' }

function makeStatus(overrides: Partial<SongStatusController> = {}): SongStatusController {
  return {
    status: 'learning',
    updating: false,
    change: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function makeLyrics(overrides: Partial<LyricsEditorController> = {}): LyricsEditorController {
  return {
    isBandEntry: true,
    displayedLyrics: 'band words',
    activeVersion: 'band',
    hasPersonalVersion: false,
    toggleVersion: vi.fn(),
    isVersionChoiceOpen: false,
    personalRepertoireId: null,
    chooseVersion: vi.fn(),
    cancelVersionChoice: vi.fn(),
    editTarget: null,
    isEditing: false,
    draft: '',
    setDraft: vi.fn(),
    startEditing: vi.fn(),
    cancelEditing: vi.fn(),
    saving: false,
    save: vi.fn().mockResolvedValue(undefined),
    canDiscardPersonal: false,
    isDiscardPending: false,
    requestDiscard: vi.fn(),
    cancelDiscard: vi.fn(),
    confirmDiscard: vi.fn().mockResolvedValue(undefined),
    fetching: false,
    autoImport: vi.fn().mockResolvedValue(undefined),
    isStageOpen: false,
    openStage: vi.fn(),
    closeStage: vi.fn(),
    fontSize: 18,
    increaseFont: vi.fn(),
    decreaseFont: vi.fn(),
    isDarkMode: false,
    toggleDarkMode: vi.fn(),
    ...overrides,
  }
}

function makeLinks(overrides: Partial<SongLinksController> = {}): SongLinksController {
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

const TABS: SongFile[] = [
  {
    id: 'tab-band',
    user_id: 'user-1',
    song_id: 'song-1',
    title: 'Guitar chart',
    file_url: 'https://blob.example/band.pdf',
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'tab-personal',
    user_id: 'user-1',
    song_id: 'song-1',
    title: 'My notes',
    file_url: 'https://blob.example/personal.pdf',
    created_at: '2026-01-02T00:00:00.000Z',
  },
]

function makeTabLibrary(overrides: Partial<TabLibraryController> = {}): TabLibraryController {
  return {
    tabs: TABS,
    activeTabId: 'tab-band',
    activeTabUrl: 'https://blob.example/band.pdf',
    activeTabTitle: 'Guitar chart',
    selectTab: vi.fn(),
    closeActiveTab: vi.fn(),
    uploadTitle: '',
    uploadFile: new File(['%PDF-1.4'], 'chart.pdf', { type: 'application/pdf' }),
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

describe('read-only offline controls (RH-80 ER4)', () => {
  // RH-102: the status control is four notes, not a dropdown trigger, so the
  // offline signal now has four buttons to disable rather than one.
  it('leaves the four status notes enabled by default', () => {
    render(<SongIdentityHeader identity={IDENTITY} status={makeStatus()} />)

    const notes = screen.getAllByRole('button')
    expect(notes).toHaveLength(4)
    expect(notes.some((note) => note.hasAttribute('disabled'))).toBe(false)
  })

  it('forwards read-only through SongIdentityHeader to all four status notes', () => {
    const controller = makeStatus()
    render(<SongIdentityHeader identity={IDENTITY} status={controller} readOnly />)

    const notes = screen.getAllByRole('button')
    expect(notes).toHaveLength(4)
    expect(notes.every((note) => note.hasAttribute('disabled'))).toBe(true)

    for (const note of notes) fireEvent.click(note)
    expect(controller.change).not.toHaveBeenCalled()
  })

  it('leaves the lyrics Edit button enabled by default', () => {
    render(<LyricsSection controller={makeLyrics()} loadingPersonal={false} />)

    expect(screen.getByRole('button', { name: 'Edit' }).hasAttribute('disabled')).toBe(false)
  })

  it('disables the lyrics Edit button when read-only', () => {
    render(<LyricsSection controller={makeLyrics()} loadingPersonal={false} readOnly />)

    expect(screen.getByRole('button', { name: 'Edit' }).hasAttribute('disabled')).toBe(true)
  })

  it('disables the lyrics Add button when read-only and there are no lyrics', () => {
    render(
      <LyricsSection controller={makeLyrics({ displayedLyrics: '' })} loadingPersonal={false} readOnly />,
    )

    expect(screen.getByRole('button', { name: 'Add' }).hasAttribute('disabled')).toBe(true)
  })

  // RH-83 ER10: offline stays read-only, so the band-or-personal choice dialog
  // has no way to open — the only control that opens it is this button.
  it('cannot start an edit, and so cannot open the version dialog, when read-only', () => {
    const controller = makeLyrics()
    render(<LyricsSection controller={controller} loadingPersonal={false} readOnly />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(controller.startEditing).not.toHaveBeenCalled()
    expect(controller.isVersionChoiceOpen).toBe(false)
  })

  it('keeps lyrics Stage Mode reachable when read-only — reading is not a write', () => {
    render(<LyricsSection controller={makeLyrics()} loadingPersonal={false} readOnly />)

    expect(screen.getByRole('button', { name: /Stage Mode/ }).hasAttribute('disabled')).toBe(false)
  })
})

/**
 * RH-99 — the remaining write controls a musician can reach with no network.
 *
 * Same mechanism as RH-80 above: the page makes the single `useOfflineStatus()`
 * call and threads `readOnly` down, so each component here is driven by a prop.
 * Every control is asserted in *both* states — disabled when read-only, enabled
 * when not — so a default-state regression cannot hide behind a green run.
 *
 * Offline is read-only by intent: these controls are *disabled*, never
 * "refused". Nothing is queued and nothing is retried.
 */
describe('RH-99 ER1 — the link controls', () => {
  it('leaves the + Add Link trigger and every link delete enabled by default', () => {
    render(<LinksSection controller={makeLinks()} onDelete={vi.fn()} />)

    expect(screen.getByRole('button', { name: '+ Add Link' }).hasAttribute('disabled')).toBe(false)
    const deletes = screen.getAllByRole('button', { name: 'Delete link' })
    expect(deletes).toHaveLength(2)
    expect(deletes.every((b) => b.hasAttribute('disabled'))).toBe(false)
  })

  it('disables the + Add Link trigger and every link delete when read-only', () => {
    render(<LinksSection controller={makeLinks()} onDelete={vi.fn()} readOnly />)

    expect(screen.getByRole('button', { name: '+ Add Link' }).hasAttribute('disabled')).toBe(true)
    const deletes = screen.getAllByRole('button', { name: 'Delete link' })
    expect(deletes).toHaveLength(2)
    expect(deletes.every((b) => b.hasAttribute('disabled'))).toBe(true)
  })

  it('cannot open the add form nor request a delete when read-only', () => {
    const controller = makeLinks()
    const onDelete = vi.fn()
    render(<LinksSection controller={controller} onDelete={onDelete} readOnly />)

    fireEvent.click(screen.getByRole('button', { name: '+ Add Link' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete link' })[0])

    expect(controller.startAdding).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it("leaves the add-link form's Add submit enabled by default", () => {
    render(<LinksSection controller={makeLinks({ isAdding: true })} onDelete={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Add' }).hasAttribute('disabled')).toBe(false)
  })

  // The form may already be open when the connection drops — that is the only
  // way this submit is reachable offline, and it is why it needs its own guard.
  it("disables the add-link form's Add submit when read-only", () => {
    render(<LinksSection controller={makeLinks({ isAdding: true })} onDelete={vi.fn()} readOnly />)

    expect(screen.getByRole('button', { name: 'Add' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('RH-99 ER2 — the tab library controls', () => {
  /** The file input carries no accessible name, so it is reached by its type. */
  function fileInput(): HTMLInputElement {
    const el = document.querySelector('input[type="file"]')
    if (!el) throw new Error('no file input rendered')
    return el as HTMLInputElement
  }

  function renderTabs(readOnly?: boolean) {
    render(
      <TabLibrarySection
        library={makeTabLibrary()}
        loadingPersonal={false}
        onOpenStage={vi.fn()}
        offline={readOnly}
        readOnly={readOnly}
      />,
    )
  }

  it('leaves the upload inputs, the Upload PDF submit and the tab deletes enabled by default', () => {
    renderTabs()

    expect(screen.getByPlaceholderText(/Tab Title/).hasAttribute('disabled')).toBe(false)
    expect(fileInput().hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: 'Upload PDF' }).hasAttribute('disabled')).toBe(false)
    const deletes = screen.getAllByRole('button', { name: 'Delete file' })
    expect(deletes).toHaveLength(2)
    expect(deletes.every((b) => b.hasAttribute('disabled'))).toBe(false)
  })

  it('disables the upload inputs, the Upload PDF submit and every tab delete when read-only', () => {
    renderTabs(true)

    expect(screen.getByPlaceholderText(/Tab Title/).hasAttribute('disabled')).toBe(true)
    expect(fileInput().hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Upload PDF' }).hasAttribute('disabled')).toBe(true)
    const deletes = screen.getAllByRole('button', { name: 'Delete file' })
    expect(deletes).toHaveLength(2)
    expect(deletes.every((b) => b.hasAttribute('disabled'))).toBe(true)
  })

  // Selecting a tab and opening Stage Mode are reads, and reading is what
  // offline is for.
  it('keeps the tab-select button and the Stage button enabled when read-only', () => {
    renderTabs(true)

    expect(screen.getByRole('button', { name: /Guitar chart/ }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: /Stage/ }).hasAttribute('disabled')).toBe(false)
  })
})

describe('RH-99 ER3 — PDF Stage Mode', () => {
  const ANNOTATIONS = {}

  function renderStage(readOnly: boolean) {
    const onSaveAnnotations = vi.fn().mockResolvedValue({ success: true })
    const { container } = render(
      <PdfStageOverlay
        open
        overlayRef={{ current: null }}
        height={900}
        tabId="tab-band"
        fileUrl="https://blob.example/band.pdf"
        tabTitle="Guitar chart"
        songTitle="Black Dog"
        songKey="A"
        annotations={ANNOTATIONS}
        annotationsError={null}
        onSaveAnnotations={onSaveAnnotations}
        onClose={vi.fn()}
        readOnly={readOnly}
      />,
    )
    return { container, onSaveAnnotations }
  }

  it('leaves the Toggle drawing button enabled by default', () => {
    renderStage(false)

    expect(screen.getByRole('button', { name: 'Toggle drawing' }).hasAttribute('disabled')).toBe(false)
  })

  it('disables the Toggle drawing button when read-only', () => {
    renderStage(true)

    expect(screen.getByRole('button', { name: 'Toggle drawing' }).hasAttribute('disabled')).toBe(true)
  })

  it('never enables drawing nor attempts a save after a pointer sequence over the canvas', () => {
    const { container, onSaveAnnotations } = renderStage(true)

    const toggle = screen.getByRole('button', { name: 'Toggle drawing' })
    fireEvent.click(toggle)

    // Drawing stayed off, so the toolbar never grew its pen/erase/colour row…
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(toggle.textContent).toContain('Draw: Off')
    expect(screen.queryByRole('button', { name: /Pen/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Erase/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Clear page/ })).toBeNull()

    // …and the canvas takes no pointer input: it is still `pointer-events: none`
    // and the whole sequence leaves `onSaveAnnotations` untouched.
    const canvas = container.querySelector('canvas')
    expect(canvas).not.toBeNull()
    expect(canvas?.style.pointerEvents).toBe('none')

    fireEvent.pointerDown(canvas as Element, { pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(canvas as Element, { pointerId: 1, clientX: 40, clientY: 50 })
    fireEvent.pointerUp(canvas as Element, { pointerId: 1, clientX: 40, clientY: 50 })

    expect(onSaveAnnotations).not.toHaveBeenCalled()
  })

  it('keeps page navigation and zoom enabled when read-only — rendering a PDF is a read', () => {
    renderStage(true)

    // `Prev` is disabled on page 1 and zoom-out at 100% by their own rules, so
    // `Next` and the zoom-in control are what the claim is measured against.
    expect(screen.getByRole('button', { name: /Next/ }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: '+' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: '100%' }).hasAttribute('disabled')).toBe(false)
  })
})

describe('RH-99 ER4 — the lyrics editor panel', () => {
  const EDITING = {
    isEditing: true,
    editTarget: 'personal' as const,
    canDiscardPersonal: true,
    hasPersonalVersion: true,
  }

  it('leaves Save, Discard my version and the web import enabled by default', () => {
    render(<LyricsEditorPanel controller={makeLyrics(EDITING)} />)

    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: /Discard my version/ }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: /Auto-import/ }).hasAttribute('disabled')).toBe(false)
  })

  it('disables Save, Discard my version and the web import when read-only', () => {
    render(<LyricsEditorPanel controller={makeLyrics(EDITING)} readOnly />)

    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /Discard my version/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /Auto-import/ }).hasAttribute('disabled')).toBe(true)
  })

  it('forwards read-only from the Lyrics section into the editor panel', () => {
    render(<LyricsSection controller={makeLyrics(EDITING)} loadingPersonal={false} readOnly />)

    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
  })

  it('keeps lyrics Stage Mode and the band/personal switch enabled when read-only', () => {
    render(
      <LyricsSection
        controller={makeLyrics({ hasPersonalVersion: true })}
        loadingPersonal={false}
        readOnly
      />,
    )

    expect(screen.getByRole('button', { name: /Stage Mode/ }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: /View my lyrics/ }).hasAttribute('disabled')).toBe(false)
  })
})
