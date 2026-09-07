import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { logger } from '@/lib/logger'
import type { ToastTone } from '@/lib/uiTones'
import type { Repertoire, RepertoireTab } from '@/types/database'
import {
  defaultTitleFromFileName,
  entryTabOrigin,
  mergeTabs,
  needsDestinationChoice,
  resolveDeleteTarget,
  resolveUploadTarget,
  tabUploadTitle,
  validateTabFile,
  type MergedTab,
  type PendingTabDelete,
  type TabLibraryController,
  type TabOrigin,
} from '@/lib/tabLibrary'

/**
 * The tab Server Actions the controller calls. Injected rather than imported, so
 * `src/hooks` never points back into the App Router tree (F21).
 * Required and never defaulted — a default would have to import that tree.
 */
export interface TabLibraryActions {
  getTabs: (repertoireId: string) => Promise<RepertoireTab[]>
  uploadTab: (formData: FormData) => Promise<{ data?: RepertoireTab; error?: string }>
  deleteTab: (tabId: string, repertoireId: string) => Promise<{ success?: boolean; error?: string }>
  addSong: (songId: string) => Promise<Repertoire>
}

export interface UseTabLibraryOptions {
  /** The route's repertoire id, i.e. `entry.id`. */
  repertoireId: string
  /** `entry.band_id`, null until the entry loads and for a personal entry. */
  entryBandId: string | null
  /** `entry.song_id`, needed to auto-create the personal entry. */
  songId: string | null
  /** `personalEntry?.id ?? null`, owned by the page. */
  personalRepertoireId: string | null
  /** Required, never defaulted — see the page's tab-actions composition root. */
  actions: TabLibraryActions
  /** Called with the entry this hook auto-created, so the page can adopt it. */
  onPersonalEntryCreated: (entry: Repertoire) => void
  /** `showToast` from the page's `useToast`. */
  notify: (message: string, tone: ToastTone) => void
  /**
   * Called when a tab delete confirmation opens, so the page can close its own
   * (link) confirmation and keep exactly one panel on screen.
   */
  onDeleteRequested?: () => void
}

/** The tab the embedded viewer and PDF Stage Mode are showing. */
interface ActiveTab {
  id: string
  repertoireId: string
  url: string
  title: string
}

/** Deliberate swallow, S1: the tab list is optional chrome — a song whose tabs
 *  cannot be read still shows its lyrics, links and status. */
const IGNORE_TAB_FETCH_ERROR = () => {}

const LOG_PERSONAL_TABS_ERROR = (error: unknown) => {
  logger.error(
    'Failed to load personal tabs',
    error instanceof Error ? error : new Error(String(error)),
  )
}

/**
 * Loads one repertoire's tabs into `receive`, cancelling on unmount. A null
 * `repertoireId` skips the fetch; `onError` decides what a failure means for
 * that list. Both callbacks must be stable, or the fetch restarts every render.
 */
function useTabsFetch(
  actions: TabLibraryActions,
  repertoireId: string | null,
  receive: (tabs: RepertoireTab[]) => void,
  onError: (error: unknown) => void,
  /** A repertoire whose tabs the caller already holds; its fetch is skipped. */
  alreadyLoaded?: RefObject<string | null>,
) {
  useEffect(() => {
    if (!repertoireId || alreadyLoaded?.current === repertoireId) return
    let cancelled = false
    actions
      .getTabs(repertoireId)
      .then((loaded) => {
        if (!cancelled) receive(loaded)
      })
      .catch(onError)
    return () => {
      cancelled = true
    }
  }, [actions, alreadyLoaded, onError, receive, repertoireId])
}

/**
 * Fast View's tab-library controller: it owns the two tab fetches (the entry's
 * and the member's own), the active tab, the upload form with its band-vs-
 * personal destination choice, and the tab delete confirmation.
 *
 * All the decisions themselves live in `@/lib/tabLibrary` and are unit-tested
 * without React; what is left here is the state, the effects and the wiring to
 * the injected actions (RH-49).
 */
export function useTabLibrary({
  repertoireId,
  entryBandId,
  songId,
  personalRepertoireId,
  actions,
  onPersonalEntryCreated,
  notify,
  onDeleteRequested,
}: UseTabLibraryOptions): TabLibraryController {
  const [entryTabs, setEntryTabs] = useState<RepertoireTab[]>([])
  const [personalTabs, setPersonalTabs] = useState<RepertoireTab[]>([])
  const [active, setActive] = useState<ActiveTab | null>(null)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDestinationModalOpen, setIsDestinationModalOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<PendingTabDelete | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** The personal entry this hook created itself, whose tabs it already knows. */
  const createdPersonalId = useRef<string | null>(null)

  useTabsFetch(actions, repertoireId, setEntryTabs, IGNORE_TAB_FETCH_ERROR)
  // A personal entry created by this hook already carries its (optimistically
  // prepended) tab in state; refetching it would race with that prepend.
  useTabsFetch(actions, personalRepertoireId, setPersonalTabs, LOG_PERSONAL_TABS_ERROR, createdPersonalId)

  const tabs = useMemo(
    () => mergeTabs(entryTabs, personalTabs, entryTabOrigin(entryBandId)),
    [entryBandId, entryTabs, personalTabs],
  )

  const selectTab = useCallback((tab: MergedTab) => {
    setActive((current) =>
      current?.url === tab.file_url
        ? null
        : { id: tab.id, repertoireId: tab.repertoire_id, url: tab.file_url, title: tab.title },
    )
  }, [])

  const closeActiveTab = useCallback(() => setActive(null), [])

  const pickFile = useCallback((file: File | null) => {
    setUploadFile(file)
    if (!file) return
    setUploadTitle((current) => (current.trim() ? current : defaultTitleFromFileName(file.name)))
  }, [])

  const chooseDestination = useCallback(
    async (destination: TabOrigin) => {
      const file = uploadFile
      if (!file) return

      const validation = validateTabFile(file)
      if (!validation.ok) {
        // Deliberately before the try: an oversized file leaves the destination
        // modal open with the error under the form, as it did before RH-49.
        setUploadError(validation.message)
        return
      }

      try {
        setUploading(true)
        setUploadError(null)

        const target = resolveUploadTarget({
          entryId: repertoireId,
          entryBandId,
          personalRepertoireId,
          destination,
        })
        let targetId = target.repertoireId
        if (targetId === null) {
          if (!songId) return
          const created = await actions.addSong(songId)
          createdPersonalId.current = created.id
          onPersonalEntryCreated(created)
          targetId = created.id
        }

        const formData = new FormData()
        formData.append('repertoireId', targetId)
        formData.append('title', tabUploadTitle(uploadTitle, file.name))
        formData.append('file', file)

        const res = await actions.uploadTab(formData)
        if (res.error) {
          setUploadError(res.error)
          return
        }
        const uploaded = res.data
        if (uploaded) {
          const prepend = target.isPersonal ? setPersonalTabs : setEntryTabs
          prepend((prev) => [uploaded, ...prev])
        }
        setUploadTitle('')
        setUploadFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      } catch (err) {
        const message = err instanceof Error ? err.message : undefined
        setUploadError(message || 'Failed to upload tab')
      } finally {
        setUploading(false)
        setIsDestinationModalOpen(false)
      }
    },
    [
      actions,
      entryBandId,
      onPersonalEntryCreated,
      personalRepertoireId,
      repertoireId,
      songId,
      uploadFile,
      uploadTitle,
    ],
  )

  const submitUpload = useCallback(() => {
    if (!uploadFile) return
    if (needsDestinationChoice(entryBandId)) {
      setIsDestinationModalOpen(true)
      return
    }
    void chooseDestination('personal')
  }, [chooseDestination, entryBandId, uploadFile])

  const cancelDestination = useCallback(() => setIsDestinationModalOpen(false), [])

  const requestDelete = useCallback(
    (tabId: string, origin: TabOrigin) => {
      const targetId = resolveDeleteTarget({ origin, entryId: repertoireId, personalRepertoireId })
      if (!targetId) return
      setActive((current) => (current?.id === tabId ? null : current))
      onDeleteRequested?.()
      setPendingDelete({ tabId, origin, targetId })
    },
    [onDeleteRequested, personalRepertoireId, repertoireId],
  )

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    const { tabId, origin, targetId } = pendingDelete
    setDeleteBusy(true)
    try {
      const res = await actions.deleteTab(tabId, targetId)
      if (res.error) {
        notify(res.error, 'error')
      } else {
        const drop = origin === 'personal' ? setPersonalTabs : setEntryTabs
        drop((prev) => prev.filter((tab) => tab.id !== tabId))
        notify('Tab deleted.', 'info')
      }
    } catch {
      // The reason never reaches the user beyond this Toast; the list is left
      // untouched, so a retry after a transient failure is a second click.
      notify('Failed to delete tab', 'error')
    } finally {
      setPendingDelete(null)
      setDeleteBusy(false)
    }
  }, [actions, notify, pendingDelete])

  const cancelDelete = useCallback(() => setPendingDelete(null), [])

  return {
    tabs,
    activeTabId: active?.id ?? null,
    activeTabRepertoireId: active?.repertoireId ?? null,
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
    isDestinationModalOpen,
    chooseDestination,
    cancelDestination,
    pendingDelete,
    deleteBusy,
    requestDelete,
    confirmDelete,
    cancelDelete,
  }
}
