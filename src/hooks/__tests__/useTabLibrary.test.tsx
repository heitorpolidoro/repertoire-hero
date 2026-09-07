// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { act, renderHook, cleanup } from '@testing-library/react'
import { useTabLibrary, type TabLibraryActions, type UseTabLibraryOptions } from '@/hooks/useTabLibrary'
import { MAX_TAB_FILE_BYTES } from '@/lib/tabLibrary'
import { logger } from '@/lib/logger'
import type { Repertoire, RepertoireTab } from '@/types/database'

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

afterEach(cleanup)

function tab(id: string, createdAt: string, repertoireId: string): RepertoireTab {
  return {
    id,
    repertoire_id: repertoireId,
    title: `Chart ${id}`,
    file_url: `https://blob.test/${id}.pdf`,
    created_at: createdAt,
  }
}

const ENTRY_TABS = [tab('t-1', '2026-01-02T10:00:00.000Z', 'rep-band'), tab('t-2', '2026-01-04T10:00:00.000Z', 'rep-band')]
const PERSONAL_TABS = [tab('p-1', '2026-01-03T10:00:00.000Z', 'rep-personal')]
const UPLOADED = tab('t-9', '2026-02-01T10:00:00.000Z', 'rep-band')

const PERSONAL_ENTRY: Repertoire = {
  id: 'rep-created', user_id: 'user-1', band_id: null, song_id: 'song-1',
  personal_key: null, status: 'unknown', tags: [], last_practiced: null, lyrics: null,
}

type ActionSpies = { [K in keyof TabLibraryActions]: Mock }

function makeActions(): ActionSpies {
  return {
    getTabs: vi.fn((repertoireId: string) =>
      Promise.resolve(repertoireId === 'rep-personal' ? PERSONAL_TABS : ENTRY_TABS),
    ),
    uploadTab: vi.fn().mockResolvedValue({ data: UPLOADED }),
    deleteTab: vi.fn().mockResolvedValue({ success: true }),
    addSong: vi.fn().mockResolvedValue(PERSONAL_ENTRY),
  }
}

function setup(overrides: Partial<UseTabLibraryOptions> = {}) {
  const actions = (overrides.actions as ActionSpies | undefined) ?? makeActions()
  const onPersonalEntryCreated = vi.fn()
  const notify = vi.fn()
  const onDeleteRequested = vi.fn()
  const initialProps: UseTabLibraryOptions = {
    repertoireId: 'rep-band',
    entryBandId: 'band-1',
    songId: 'song-1',
    personalRepertoireId: null,
    actions,
    onPersonalEntryCreated,
    notify,
    onDeleteRequested,
    ...overrides,
  }
  const view = renderHook((props: UseTabLibraryOptions) => useTabLibrary(props), { initialProps })
  return { ...view, actions, onPersonalEntryCreated, notify, onDeleteRequested, initialProps }
}

/** Drain the pending action promises inside `act`. */
async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function pdf(name = 'Rosanna.pdf', size = 1024): File {
  const file = new File(['chart'], name, { type: 'application/pdf' })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('useTabLibrary', () => {
  it('loads the entry tabs on mount and exposes them merged and ordered', async () => {
    const { result, actions } = setup()
    await flush()

    expect(actions.getTabs).toHaveBeenCalledWith('rep-band')
    expect(result.current.tabs.map((t) => [t.id, t.origin])).toEqual([
      ['t-2', 'band'],
      ['t-1', 'band'],
    ])
  })

  it('loads the personal tabs once a personal repertoire id is known', async () => {
    const { result, rerender, actions, initialProps } = setup()
    await flush()
    expect(actions.getTabs).toHaveBeenCalledTimes(1)

    rerender({ ...initialProps, personalRepertoireId: 'rep-personal' })
    await flush()

    expect(actions.getTabs).toHaveBeenCalledWith('rep-personal')
    expect(result.current.tabs.map((t) => [t.id, t.origin])).toEqual([
      ['t-2', 'band'],
      ['p-1', 'personal'],
      ['t-1', 'band'],
    ])
  })

  it('keeps an empty list when the tab fetch rejects', async () => {
    const actions = makeActions()
    actions.getTabs.mockRejectedValue(new Error('Access denied'))
    const { result } = setup({ actions })
    await flush()

    expect(result.current.tabs).toEqual([])
  })

  it('logs and keeps the list when the personal tabs fetch rejects', async () => {
    const actions = makeActions()
    actions.getTabs.mockImplementation((repertoireId: string) =>
      repertoireId === 'rep-personal' ? Promise.reject(new Error('nope')) : Promise.resolve(ENTRY_TABS),
    )
    const { result } = setup({ actions, personalRepertoireId: 'rep-personal' })
    await flush()

    expect(logger.error).toHaveBeenCalledWith('Failed to load personal tabs', expect.any(Error))
    expect(result.current.tabs.map((t) => t.id)).toEqual(['t-2', 't-1'])
  })

  it('selects a tab and clears the selection when the same tab is chosen again', async () => {
    const { result } = setup()
    await flush()

    act(() => result.current.selectTab(result.current.tabs[0]))
    expect(result.current.activeTabUrl).toBe('https://blob.test/t-2.pdf')

    act(() => result.current.selectTab(result.current.tabs[0]))
    expect(result.current.activeTabUrl).toBeNull()
    expect(result.current.activeTabTitle).toBe('')

    act(() => result.current.selectTab(result.current.tabs[1]))
    act(() => result.current.closeActiveTab())
    expect(result.current.activeTabId).toBeNull()
  })

  it('exposes the active tab id, repertoire id, url and title for the stage overlay', async () => {
    const { result } = setup()
    await flush()

    act(() => result.current.selectTab(result.current.tabs[1]))

    expect(result.current.activeTabId).toBe('t-1')
    expect(result.current.activeTabRepertoireId).toBe('rep-band')
    expect(result.current.activeTabUrl).toBe('https://blob.test/t-1.pdf')
    expect(result.current.activeTabTitle).toBe('Chart t-1')
  })

  it('fills the upload title from the file name only when the title box is empty', async () => {
    const { result } = setup()
    await flush()

    act(() => result.current.pickFile(pdf()))
    expect(result.current.uploadTitle).toBe('Rosanna')

    act(() => result.current.pickFile(pdf('Africa.pdf')))
    expect(result.current.uploadTitle).toBe('Rosanna')

    act(() => result.current.pickFile(null))
    expect(result.current.uploadFile).toBeNull()
    expect(result.current.uploadTitle).toBe('Rosanna')
  })

  it('opens the destination modal instead of uploading when the entry belongs to a band', async () => {
    const { result, actions } = setup()
    await flush()

    act(() => result.current.submitUpload())
    expect(result.current.isDestinationModalOpen).toBe(false)

    act(() => result.current.pickFile(pdf()))
    await act(async () => result.current.submitUpload())

    expect(result.current.isDestinationModalOpen).toBe(true)
    expect(actions.uploadTab).not.toHaveBeenCalled()
  })

  it('uploads straight to the personal entry when the entry has no band', async () => {
    const { result, actions } = setup({ repertoireId: 'rep-mine', entryBandId: null })
    await flush()

    act(() => result.current.pickFile(pdf()))
    await act(async () => {
      result.current.submitUpload()
    })
    await flush()

    expect(result.current.isDestinationModalOpen).toBe(false)
    const formData = actions.uploadTab.mock.calls[0][0] as FormData
    expect(formData.get('repertoireId')).toBe('rep-mine')
    expect(formData.get('title')).toBe('Rosanna')
  })

  it('rejects an oversized file with an inline error and never calls the upload action', async () => {
    const { result, actions } = setup()
    await flush()

    act(() => result.current.pickFile(pdf('huge.pdf', MAX_TAB_FILE_BYTES + 1)))
    await act(async () => result.current.submitUpload())
    await act(async () => {
      await result.current.chooseDestination('band')
    })

    expect(result.current.uploadError).toBe('File size exceeds the 10MB limit')
    expect(actions.uploadTab).not.toHaveBeenCalled()
    // Preserved wart: the destination modal stays open behind the error.
    expect(result.current.isDestinationModalOpen).toBe(true)
  })

  it('creates the personal entry before uploading when the band member has none', async () => {
    const { result, actions, onPersonalEntryCreated } = setup()
    await flush()

    act(() => result.current.pickFile(pdf()))
    await act(async () => {
      await result.current.chooseDestination('personal')
    })

    expect(actions.addSong).toHaveBeenCalledWith('song-1')
    expect(onPersonalEntryCreated).toHaveBeenCalledWith(PERSONAL_ENTRY)
    const formData = actions.uploadTab.mock.calls[0][0] as FormData
    expect(formData.get('repertoireId')).toBe('rep-created')
  })

  it('does not create a personal entry when the song id is not known yet', async () => {
    const { result, actions } = setup({ songId: null })
    await flush()

    act(() => result.current.pickFile(pdf()))
    await act(async () => {
      await result.current.chooseDestination('personal')
    })

    expect(actions.addSong).not.toHaveBeenCalled()
    expect(actions.uploadTab).not.toHaveBeenCalled()
    expect(result.current.uploading).toBe(false)
  })

  it('does not refetch the personal tabs for a personal entry it just created', async () => {
    const { result, rerender, actions, initialProps } = setup()
    await flush()

    act(() => result.current.pickFile(pdf()))
    await act(async () => {
      await result.current.chooseDestination('personal')
    })

    rerender({ ...initialProps, personalRepertoireId: 'rep-created' })
    await flush()

    expect(actions.getTabs).not.toHaveBeenCalledWith('rep-created')
    expect(result.current.tabs.map((t) => t.id)).toEqual(['t-9', 't-2', 't-1'])
  })

  it('shows the error returned by the upload action and keeps the file selected', async () => {
    const actions = makeActions()
    actions.uploadTab.mockResolvedValue({ error: 'Only PDF files are allowed' })
    const { result } = setup({ actions })
    await flush()

    act(() => result.current.pickFile(pdf()))
    await act(async () => {
      await result.current.chooseDestination('band')
    })

    expect(result.current.uploadError).toBe('Only PDF files are allowed')
    expect(result.current.uploadFile).not.toBeNull()
    expect(result.current.uploading).toBe(false)
    expect(result.current.isDestinationModalOpen).toBe(false)
  })

  it('falls back to a generic message when the upload action throws', async () => {
    const actions = makeActions()
    actions.uploadTab.mockRejectedValue('boom')
    const { result } = setup({ actions, entryBandId: null })
    await flush()
    act(() => result.current.pickFile(pdf('Africa.pdf')))
    await act(async () => result.current.submitUpload())
    expect(result.current.uploadError).toBe('Failed to upload tab')
  })

  it('prepends the uploaded tab to the list and clears the form', async () => {
    const { result } = setup()
    await flush()

    act(() => result.current.pickFile(pdf()))
    await act(async () => {
      await result.current.chooseDestination('band')
    })

    expect(result.current.tabs.map((t) => t.id)).toEqual(['t-9', 't-2', 't-1'])
    expect(result.current.uploadTitle).toBe('')
    expect(result.current.uploadFile).toBeNull()
    expect(result.current.uploadError).toBeNull()
  })

  it('asks for confirmation before deleting and removes the tab only after the delete action succeeds', async () => {
    const { result, actions, notify, onDeleteRequested } = setup()
    await flush()

    act(() => result.current.requestDelete('t-1', 'band'))
    expect(result.current.pendingDelete).toEqual({ tabId: 't-1', origin: 'band', targetId: 'rep-band' })
    expect(onDeleteRequested).toHaveBeenCalledTimes(1)
    expect(actions.deleteTab).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.confirmDelete()
    })

    expect(actions.deleteTab).toHaveBeenCalledWith('t-1', 'rep-band')
    expect(result.current.tabs.map((t) => t.id)).toEqual(['t-2'])
    expect(notify).toHaveBeenCalledWith('Tab deleted.', 'info')
    expect(result.current.pendingDelete).toBeNull()
    expect(result.current.deleteBusy).toBe(false)
  })

  it('clears the active tab when the tab being deleted is the active one', async () => {
    const { result } = setup()
    await flush()

    act(() => result.current.selectTab(result.current.tabs[0]))
    expect(result.current.activeTabId).toBe('t-2')

    act(() => result.current.requestDelete('t-2', 'band'))
    expect(result.current.activeTabId).toBeNull()
    expect(result.current.activeTabUrl).toBeNull()

    act(() => result.current.cancelDelete())
    expect(result.current.pendingDelete).toBeNull()
  })

  it('reports a failed delete through the notifier and keeps the tab', async () => {
    const actions = makeActions()
    actions.deleteTab.mockResolvedValue({ error: 'Access denied' })
    const { result, notify } = setup({ actions, personalRepertoireId: 'rep-personal' })
    await flush()

    act(() => result.current.requestDelete('p-1', 'personal'))
    expect(result.current.pendingDelete?.targetId).toBe('rep-personal')
    await act(async () => {
      await result.current.confirmDelete()
    })
    expect(notify).toHaveBeenCalledWith('Access denied', 'error')
    expect(result.current.tabs.map((t) => t.id)).toContain('p-1')

    actions.deleteTab.mockRejectedValue(new Error('offline'))
    act(() => result.current.requestDelete('p-1', 'personal'))
    await act(async () => {
      await result.current.confirmDelete()
    })
    expect(notify).toHaveBeenCalledWith('Failed to delete tab', 'error')

    // Confirming with nothing pending is a no-op.
    await act(async () => {
      await result.current.confirmDelete()
    })
    expect(result.current.deleteBusy).toBe(false)
  })

  it('cancels the destination modal without uploading', async () => {
    const { result, actions } = setup()
    await flush()

    act(() => result.current.pickFile(pdf()))
    await act(async () => result.current.submitUpload())
    expect(result.current.isDestinationModalOpen).toBe(true)

    act(() => result.current.cancelDestination())
    expect(result.current.isDestinationModalOpen).toBe(false)
    expect(actions.uploadTab).not.toHaveBeenCalled()

    // Choosing a destination without a file does nothing either.
    act(() => result.current.pickFile(null))
    await act(async () => {
      await result.current.chooseDestination('band')
    })
    expect(actions.uploadTab).not.toHaveBeenCalled()
  })
})
