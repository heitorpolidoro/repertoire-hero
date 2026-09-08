import { useCallback, useState } from 'react'
import {
  appendLink,
  isDuplicateLinkUrl,
  removeLinkByUrl,
  resolveLinkLabel,
  type SongLinksController,
} from '@/lib/songLinks'
import type { ToastTone } from '@/lib/uiTones'
import type { Repertoire, SongLink } from '@/types/database'

/**
 * The link Server Actions the controller calls. Injected rather than imported,
 * so `src/hooks` never points back into the App Router tree (F21).
 * Required and never defaulted — a default would have to import that tree.
 */
export interface SongLinksActions {
  updateLinks: (repertoireId: string, links: SongLink[]) => Promise<{ success: boolean; pending?: boolean }>
  fetchUrlTitle: (url: string) => Promise<string>
}

export interface UseSongLinksOptions {
  /** The route's entry; null until it loads. Owned by `useSongEntry`. */
  entry: Repertoire | null
  /** Required, never defaulted — see `src/app/fastViewEntryActions.ts` (F21). */
  actions: SongLinksActions
  /** The page passes `song.applyLinks`, so the card list re-renders at once. */
  onLinksSaved: (links: SongLink[]) => void
  /** `showToast` from the page's `useToast`. */
  notify: (message: string, tone: ToastTone) => void
}

/**
 * Fast View's links controller: the add form with its duplicate check and its
 * blank-label auto-fill, and the delete that goes through the shared-catalog
 * moderation queue — a removal the queue holds keeps the link on screen until
 * an admin approves it (RH-34).
 *
 * The decisions themselves live in `@/lib/songLinks` and are unit-tested
 * without React; what is left here is the state and the injected actions
 * (RH-52).
 */
export function useSongLinks({
  entry,
  actions,
  onLinksSaved,
  notify,
}: UseSongLinksOptions): SongLinksController {
  const [isAdding, setIsAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingDeleteUrl, setPendingDeleteUrl] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const startAdding = useCallback(() => setIsAdding(true), [])

  const cancelAdding = useCallback(() => {
    setIsAdding(false)
    setLabel('')
    setUrl('')
  }, [])

  const submit = useCallback(async () => {
    if (!entry?.song) return

    const current = entry.song.links ?? []
    if (isDuplicateLinkUrl(current, url)) {
      notify('This URL is already in the links list.', 'warning')
      return
    }

    try {
      setSaving(true)
      const trimmedUrl = url.trim()
      const typedLabel = label.trim()
      // The title is only worth a round trip when the musician left the label
      // blank; a typed label always wins.
      const fetchedTitle = typedLabel ? '' : await actions.fetchUrlTitle(trimmedUrl)
      const updated = appendLink(current, {
        label: resolveLinkLabel(typedLabel, fetchedTitle, trimmedUrl),
        url: trimmedUrl,
      })

      await actions.updateLinks(entry.id, updated)
      onLinksSaved(updated)
      cancelAdding()
      notify('Link added successfully!', 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to add link.', 'error')
    } finally {
      setSaving(false)
    }
  }, [actions, cancelAdding, entry, label, notify, onLinksSaved, url])

  const requestDelete = useCallback((urlToDelete: string) => setPendingDeleteUrl(urlToDelete), [])

  const cancelDelete = useCallback(() => setPendingDeleteUrl(null), [])

  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteUrl) return
    setDeleteBusy(true)
    try {
      if (entry?.song) {
        const updated = removeLinkByUrl(entry.song.links ?? [], pendingDeleteUrl)
        try {
          // Removing a link rewrites the shared catalog for everyone, so it is
          // submitted for review instead of applied: keep the link on screen
          // until an admin approves the removal.
          const result = await actions.updateLinks(entry.id, updated)
          if (result.pending) {
            notify('Link removal submitted for review. It stays visible until an admin approves it.', 'warning')
          } else {
            onLinksSaved(updated)
            notify('Link deleted.', 'info')
          }
        } catch {
          notify('Failed to delete link.', 'error')
        }
      }
      setPendingDeleteUrl(null)
    } finally {
      setDeleteBusy(false)
    }
  }, [actions, entry, notify, onLinksSaved, pendingDeleteUrl])

  return {
    links: entry?.song?.links ?? [],
    isAdding,
    startAdding,
    cancelAdding,
    label,
    setLabel,
    url,
    setUrl,
    saving,
    submit,
    pendingDeleteUrl,
    deleteBusy,
    requestDelete,
    confirmDelete,
    cancelDelete,
  }
}
