// @vitest-environment jsdom
/**
 * `useTabLibrary` after the RH-123 re-key.
 *
 * The controller makes **one** fetch, by song id, and the band/personal
 * duality it used to carry is gone: no merge, no origin badge, no destination
 * modal, and no second "personal tabs" list. The suite that follows is
 * therefore roughly half the size of the one it replaced — the removed tests
 * covered behaviour the model no longer has.
 *
 * ER7's case is `resolves a song's files in one fetch for a song the user holds
 * no repertoire row for`: the old repertoire-row-keyed fetch could not ask that
 * question at all.
 */
import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { act, renderHook, cleanup } from '@testing-library/react'
import { useTabLibrary, type TabLibraryActions, type UseTabLibraryOptions } from '@/hooks/useTabLibrary'
import { MAX_TAB_FILE_BYTES } from '@/lib/tabLibrary'
import type { Repertoire, SongFile } from '@/types/database'

afterEach(cleanup)

function songFile(id: string, createdAt: string): SongFile {
  return {
    id,
    user_id: 'user-1',
    song_id: 'song-1',
    title: `Chart ${id}`,
    file_url: `https://blob.test/${id}.pdf`,
    created_at: createdAt,
  }
}

const SONG_FILES = [songFile('t-2', '2026-01-04T10:00:00.000Z'), songFile('t-1', '2026-01-02T10:00:00.000Z')]
const UPLOADED = songFile('t-9', '2026-02-01T10:00:00.000Z')

const OWN_ENTRY: Repertoire = {
  id: 'rep-created', user_id: 'user-1', band_id: null, song_id: 'song-1',
  personal_key: null, status: 'unknown', tags: [], last_practiced: null, lyrics: null,
}

type ActionSpies = { [K in keyof TabLibraryActions]: Mock }

function makeActions(): ActionSpies {
  return {
    getTabs: vi.fn().mockResolvedValue(SONG_FILES),
    uploadTab: vi.fn().mockResolvedValue({ data: UPLOADED }),
    deleteTab: vi.fn().mockResolvedValue({ success: true }),
  }
}

function setup(overrides: Partial<UseTabLibraryOptions> = {}) {
  const actions = (overrides.actions as ActionSpies | undefined) ?? makeActions()
  const onPersonalEntryCreated = vi.fn()
  const notify = vi.fn()
  const onDeleteRequested = vi.fn()
  const initialProps: UseTabLibraryOptions = {
    songId: 'song-1',
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

describe('the one fetch, by song id', () => {
  it("resolves a song's files in a single fetch and exposes them verbatim", async () => {
    const { result, actions } = setup()
    await flush()

    expect(actions.getTabs).toHaveBeenCalledTimes(1)
    expect(actions.getTabs).toHaveBeenCalledWith('song-1')
    expect(result.current.tabs).toEqual(SONG_FILES)
  })

  // ER7. The hook is given no repertoire id at all, which is the point: a file
  // is reachable by `(user_id, song_id)`, so the musician's own charts list for
  // a song they have never added to their repertoire.
  it('lists the files of a song the user holds no repertoire row for', async () => {
    const { result, actions } = setup()
    await flush()

    expect(Object.keys(actions)).not.toContain('addSong')
    expect(result.current.tabs.map((file) => file.id)).toEqual(['t-2', 't-1'])
  })

  it('skips the fetch until the song id is known', async () => {
    const { actions } = setup({ songId: null })
    await flush()

    expect(actions.getTabs).not.toHaveBeenCalled()
  })

  it('keeps an empty list when the fetch rejects — the list is optional chrome', async () => {
    const actions = makeActions()
    actions.getTabs.mockRejectedValue(new Error('offline'))
    const { result } = setup({ actions: actions as unknown as TabLibraryActions })
    await flush()

    expect(result.current.tabs).toEqual([])
  })
})

describe('the active file', () => {
  it('selects a file and clears the selection when the same file is chosen again', async () => {
    const { result } = setup()
    await flush()

    act(() => result.current.selectTab(SONG_FILES[0]))
    expect(result.current.activeTabId).toBe('t-2')

    act(() => result.current.selectTab(SONG_FILES[0]))
    expect(result.current.activeTabId).toBeNull()
  })

  it('exposes the active file id, url and title for the stage overlay — and no repertoire id', async () => {
    const { result } = setup()
    await flush()

    act(() => result.current.selectTab(SONG_FILES[1]))

    expect(result.current.activeTabId).toBe('t-1')
    expect(result.current.activeTabUrl).toBe('https://blob.test/t-1.pdf')
    expect(result.current.activeTabTitle).toBe('Chart t-1')
    expect(result.current).not.toHaveProperty('activeTabRepertoireId')
  })

  it('closes the active file', async () => {
    const { result } = setup()
    await flush()

    act(() => result.current.selectTab(SONG_FILES[0]))
    act(() => result.current.closeActiveTab())

    expect(result.current.activeTabId).toBeNull()
  })
})

describe('the upload', () => {
  it('fills the title from the file name only while the field is untouched', async () => {
    const { result } = setup()
    await flush()

    act(() => result.current.pickFile(pdf()))
    expect(result.current.uploadTitle).toBe('Rosanna')

    act(() => result.current.setUploadTitle('My own title'))
    act(() => result.current.pickFile(pdf('Africa.pdf')))
    expect(result.current.uploadTitle).toBe('My own title')
  })

  it('posts the song id, the title and the file, with no destination to choose', async () => {
    const { result, actions } = setup()
    await flush()

    act(() => result.current.pickFile(pdf()))
    await act(async () => {
      result.current.submitUpload()
    })
    await flush()

    const form = actions.uploadTab.mock.calls[0][0] as FormData
    expect(form.get('songId')).toBe('song-1')
    expect(form.get('title')).toBe('Rosanna')
    expect(form.get('file')).toBeInstanceOf(File)
    expect(result.current).not.toHaveProperty('isDestinationModalOpen')
  })

  it('prepends the uploaded file to the list and clears the form', async () => {
    const { result } = setup()
    await flush()

    act(() => result.current.pickFile(pdf()))
    await act(async () => {
      result.current.submitUpload()
    })
    await flush()

    expect(result.current.tabs.map((file) => file.id)).toEqual(['t-9', 't-2', 't-1'])
    expect(result.current.uploadTitle).toBe('')
    expect(result.current.uploadFile).toBeNull()
    expect(result.current.uploading).toBe(false)
  })

  // The ensure moved server-side: the action reports the row it created and the
  // page adopts it, so the hook never has to create one itself.
  it("reports the repertoire row the upload action created, when it created one", async () => {
    const actions = makeActions()
    actions.uploadTab.mockResolvedValue({ data: UPLOADED, entry: OWN_ENTRY })
    const { result, onPersonalEntryCreated } = setup({ actions: actions as unknown as TabLibraryActions })
    await flush()

    act(() => result.current.pickFile(pdf()))
    await act(async () => {
      result.current.submitUpload()
    })
    await flush()

    expect(onPersonalEntryCreated).toHaveBeenCalledWith(OWN_ENTRY)
  })

  it('reports nothing when the uploader already held the song', async () => {
    const { result, onPersonalEntryCreated } = setup()
    await flush()

    act(() => result.current.pickFile(pdf()))
    await act(async () => {
      result.current.submitUpload()
    })
    await flush()

    expect(onPersonalEntryCreated).not.toHaveBeenCalled()
  })

  it('rejects an oversized file with an inline error and never calls the upload action', async () => {
    const { result, actions } = setup()
    await flush()

    act(() => result.current.pickFile(pdf('big.pdf', MAX_TAB_FILE_BYTES + 1)))
    await act(async () => {
      result.current.submitUpload()
    })

    expect(result.current.uploadError).toBe('File size exceeds the 10MB limit')
    expect(actions.uploadTab).not.toHaveBeenCalled()
    expect(result.current.uploadFile).not.toBeNull()
  })

  it('shows the error returned by the upload action and keeps the file selected', async () => {
    const actions = makeActions()
    actions.uploadTab.mockResolvedValue({ error: 'Only PDF files are allowed' })
    const { result } = setup({ actions: actions as unknown as TabLibraryActions })
    await flush()

    act(() => result.current.pickFile(pdf()))
    await act(async () => {
      result.current.submitUpload()
    })
    await flush()

    expect(result.current.uploadError).toBe('Only PDF files are allowed')
    expect(result.current.uploadFile).not.toBeNull()
    expect(result.current.uploading).toBe(false)
  })

  it('falls back to a generic message when the upload action throws', async () => {
    const actions = makeActions()
    actions.uploadTab.mockRejectedValue(new Error(''))
    const { result } = setup({ actions: actions as unknown as TabLibraryActions })
    await flush()

    act(() => result.current.pickFile(pdf()))
    await act(async () => {
      result.current.submitUpload()
    })
    await flush()

    expect(result.current.uploadError).toBe('Failed to upload file')
  })

  it('does nothing with no file picked', async () => {
    const { result, actions } = setup()
    await flush()

    await act(async () => {
      result.current.submitUpload()
    })

    expect(actions.uploadTab).not.toHaveBeenCalled()
  })
})

describe('the delete', () => {
  it('asks for confirmation first, then deletes by file id alone', async () => {
    const { result, actions, notify, onDeleteRequested } = setup()
    await flush()

    act(() => result.current.requestDelete('t-1'))
    expect(result.current.pendingDelete).toEqual({ tabId: 't-1' })
    expect(onDeleteRequested).toHaveBeenCalled()
    expect(actions.deleteTab).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.confirmDelete()
    })

    expect(actions.deleteTab).toHaveBeenCalledWith('t-1')
    expect(result.current.tabs.map((file) => file.id)).toEqual(['t-2'])
    expect(notify).toHaveBeenCalledWith('File deleted.', 'info')
    expect(result.current.pendingDelete).toBeNull()
  })

  it('clears the active file when the file being deleted is the active one', async () => {
    const { result } = setup()
    await flush()

    act(() => result.current.selectTab(SONG_FILES[0]))
    act(() => result.current.requestDelete('t-2'))

    expect(result.current.activeTabId).toBeNull()
  })

  it('reports a failed delete through the notifier and keeps the file', async () => {
    const actions = makeActions()
    actions.deleteTab.mockResolvedValue({ error: 'Tab not found' })
    const { result, notify } = setup({ actions: actions as unknown as TabLibraryActions })
    await flush()

    act(() => result.current.requestDelete('t-1'))
    await act(async () => {
      await result.current.confirmDelete()
    })

    expect(notify).toHaveBeenCalledWith('Tab not found', 'error')
    expect(result.current.tabs.map((file) => file.id)).toEqual(['t-2', 't-1'])
  })

  it('reports a thrown delete through the notifier', async () => {
    const actions = makeActions()
    actions.deleteTab.mockRejectedValue(new Error('network'))
    const { result, notify } = setup({ actions: actions as unknown as TabLibraryActions })
    await flush()

    act(() => result.current.requestDelete('t-1'))
    await act(async () => {
      await result.current.confirmDelete()
    })

    expect(notify).toHaveBeenCalledWith('Failed to delete file', 'error')
    expect(result.current.tabs).toHaveLength(2)
  })

  it('cancels the confirmation without deleting', async () => {
    const { result, actions } = setup()
    await flush()

    act(() => result.current.requestDelete('t-1'))
    act(() => result.current.cancelDelete())

    expect(result.current.pendingDelete).toBeNull()
    expect(actions.deleteTab).not.toHaveBeenCalled()
  })

  it('does nothing when confirm is called with nothing pending', async () => {
    const { result, actions } = setup()
    await flush()

    await act(async () => {
      await result.current.confirmDelete()
    })

    expect(actions.deleteTab).not.toHaveBeenCalled()
  })
})
