import { useCallback, useEffect, useRef, useState } from 'react'
import type { Repertoire, SongFile } from '@/types/database'
import type { ToastTone } from '@/lib/uiTones'
import {
  defaultTitleFromFileName,
  tabUploadTitle,
  validateTabFile,
  type PendingTabDelete,
  type TabLibraryController,
} from '@/lib/tabLibrary'

/**
 * The file Server Actions the controller calls. Injected rather than imported,
 * so `src/hooks` never points back into the App Router tree (F21).
 * Required and never defaulted — a default would have to import that tree.
 */
export interface TabLibraryActions {
  getTabs: (songId: string) => Promise<SongFile[]>
  uploadTab: (formData: FormData) => Promise<{ data?: SongFile; entry?: Repertoire; error?: string }>
  deleteTab: (fileId: string) => Promise<{ success?: boolean; error?: string }>
}

export interface UseTabLibraryOptions {
  /** `entry.song_id`; a file is keyed by the song, not by a repertoire row. */
  songId: string | null
  /** Required, never defaulted — see the page's tab-actions composition root. */
  actions: TabLibraryActions
  /**
   * Called with the repertoire entry the *upload* created, so the page can
   * adopt it. RH-123 moved the ensure-own-row server-side — the destination
   * modal that used to make it the user's choice is gone — so this fires with
   * whatever `uploadTabAction` reports having created, and not at all when the
   * musician already held the song.
   */
  onPersonalEntryCreated: (entry: Repertoire) => void
  /** `showToast` from the page's `useToast`. */
  notify: (message: string, tone: ToastTone) => void
  /**
   * Called when a file delete confirmation opens, so the page can close its own
   * (link) confirmation and keep exactly one panel on screen.
   */
  onDeleteRequested?: () => void
}

/** The file the embedded viewer and PDF Stage Mode are showing. */
interface ActiveTab {
  id: string
  url: string
  title: string
}

/**
 * Fast View's file-library controller: it owns the song's **one** file fetch,
 * the active file, the upload form and the delete confirmation.
 *
 * Before RH-123 it made two fetches — the entry's files and the member's own —
 * and merged them with an origin badge. A file is now resolved by song id and
 * scoped to the session's `user_id`, so one fetch answers the whole list and
 * there is nothing to merge. That is also what makes the list correct for a
 * song the musician holds no repertoire row for: the old
 * repertoire-row-keyed fetch could not ask the question at all.
 *
 * All the decisions themselves live in `@/lib/tabLibrary` and are unit-tested
 * without React; what is left here is the state, the effect and the wiring to
 * the injected actions (RH-49).
 */
export function useTabLibrary({
  songId,
  actions,
  onPersonalEntryCreated,
  notify,
  onDeleteRequested,
}: UseTabLibraryOptions): TabLibraryController {
  const [tabs, setTabs] = useState<SongFile[]>([])
  const [active, setActive] = useState<ActiveTab | null>(null)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingTabDelete | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // One fetch, by song id. Deliberate swallow (S1): the file list is optional
  // chrome — a song whose files cannot be read still shows its lyrics, links
  // and status.
  useEffect(() => {
    if (!songId) return
    let cancelled = false
    actions
      .getTabs(songId)
      .then((loaded) => {
        if (!cancelled) setTabs(loaded)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [actions, songId])

  const selectTab = useCallback((tab: SongFile) => {
    setActive((current) =>
      current?.url === tab.file_url ? null : { id: tab.id, url: tab.file_url, title: tab.title },
    )
  }, [])

  const closeActiveTab = useCallback(() => setActive(null), [])

  const pickFile = useCallback((file: File | null) => {
    setUploadFile(file)
    if (!file) return
    setUploadTitle((current) => (current.trim() ? current : defaultTitleFromFileName(file.name)))
  }, [])

  const submitUpload = useCallback(() => {
    const file = uploadFile
    if (!file || !songId) return

    const validation = validateTabFile(file)
    if (!validation.ok) {
      // Deliberately before the async work: an oversized file leaves the error
      // under the form with nothing in flight.
      setUploadError(validation.message)
      return
    }

    const run = async () => {
      try {
        setUploading(true)
        setUploadError(null)

        const formData = new FormData()
        formData.append('songId', songId)
        formData.append('title', tabUploadTitle(uploadTitle, file.name))
        formData.append('file', file)

        const res = await actions.uploadTab(formData)
        if (res.error) {
          setUploadError(res.error)
          return
        }
        if (res.entry) onPersonalEntryCreated(res.entry)
        if (res.data) {
          const uploaded = res.data
          setTabs((prev) => [uploaded, ...prev])
        }
        setUploadTitle('')
        setUploadFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      } catch (err) {
        const message = err instanceof Error ? err.message : undefined
        setUploadError(message || 'Failed to upload file')
      } finally {
        setUploading(false)
      }
    }
    void run()
  }, [actions, onPersonalEntryCreated, songId, uploadFile, uploadTitle])

  const requestDelete = useCallback(
    (tabId: string) => {
      setActive((current) => (current?.id === tabId ? null : current))
      onDeleteRequested?.()
      setPendingDelete({ tabId })
    },
    [onDeleteRequested],
  )

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    const { tabId } = pendingDelete
    setDeleteBusy(true)
    try {
      const res = await actions.deleteTab(tabId)
      if (res.error) {
        notify(res.error, 'error')
      } else {
        setTabs((prev) => prev.filter((tab) => tab.id !== tabId))
        notify('File deleted.', 'info')
      }
    } catch {
      // The reason never reaches the user beyond this Toast; the list is left
      // untouched, so a retry after a transient failure is a second click.
      notify('Failed to delete file', 'error')
    } finally {
      setPendingDelete(null)
      setDeleteBusy(false)
    }
  }, [actions, notify, pendingDelete])

  const cancelDelete = useCallback(() => setPendingDelete(null), [])

  return {
    tabs,
    activeTabId: active?.id ?? null,
    activeTabUrl: active?.url ?? null,
    activeTabTitle: active?.title ?? '',
    selectTab,
    closeActiveTab,
    uploadTitle,
    uploadFile,
    uploading,
    uploadError,
    fileInputRef,
    setUploadTitle,
    pickFile,
    submitUpload,
    pendingDelete,
    deleteBusy,
    requestDelete,
    confirmDelete,
    cancelDelete,
  }
}
