import { useCallback, useState } from 'react'
import { logger } from '@/lib/logger'
import {
  EMPTY_MANUAL_DRAFT,
  draftTitle,
  manualEntryInput,
  type CatalogSongMatch,
  type ManualDraft,
  type ManualEntryInput,
} from '@/lib/manualEntry'
import type { SongStatus } from '@/types/database'

/**
 * The Server Actions the manual-entry panel calls, injected by
 * `src/app/page.tsx` so `src/hooks` never points back into the App Router (F21).
 */
export interface ManualEntryActions {
  createAndAddSong: (data: ManualEntryInput) => Promise<{ id: string }>
  updateSongStatus: (repertoireId: string, status: SongStatus) => Promise<void>
  /** Read-only: the catalog song this title and artist already identify. */
  findCatalogSong: (title: string, artist: string) => Promise<CatalogSongMatch | null>
}

export interface UseManualEntryOptions {
  actions: ManualEntryActions
  /** The search box value; the title follows it until the musician types one. */
  query: string
  /** Run after every successful add (the dashboard reloads its list). */
  onAdded: () => Promise<void>
}

export interface ManualEntryController {
  draft: ManualDraft
  /** The title as shown: the typed one, else the search query. */
  title: string
  /** The "More details" disclosure is open. */
  detailsOpen: boolean
  /** The catalog song awaiting an add-as-new-version answer, or `null`. */
  offer: CatalogSongMatch | null
  error: string | null
  busy: boolean
  setField: <K extends keyof ManualDraft>(key: K, value: ManualDraft[K]) => void
  toggleDetails: () => void
  submit: () => Promise<void>
  acceptOffer: () => Promise<void>
  declineOffer: () => void
}

/**
 * RH-152 - the dashboard's manual-entry controller. A submit first asks the
 * read-only `findCatalogSong`; an existing identity becomes an offer and
 * nothing is written until it is accepted. A new identity (or an accepted
 * offer) is one `createAndAddSong`, then the chosen status, then a reload -
 * `createAndAddSong` itself attaches a new version to the existing song.
 */
export function useManualEntry({ actions, query, onAdded }: UseManualEntryOptions): ManualEntryController {
  const [draft, setDraft] = useState<ManualDraft>(EMPTY_MANUAL_DRAFT)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [offer, setOffer] = useState<CatalogSongMatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const setField = useCallback(<K extends keyof ManualDraft>(key: K, value: ManualDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
    // A changed identity makes the open offer stale.
    setOffer(null)
  }, [])

  const write = async (input: ManualEntryInput) => {
    const entry = await actions.createAndAddSong(input)
    if (draft.status !== 'unknown') await actions.updateSongStatus(entry.id, draft.status)
    await onAdded()
    setDraft(EMPTY_MANUAL_DRAFT)
    setDetailsOpen(false)
    setOffer(null)
  }

  const run = async (step: (input: ManualEntryInput) => Promise<void>) => {
    const input = manualEntryInput(draft, query)
    if (!input) {
      setError('Title and artist are required.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await step(input)
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      logger.error('Failed to add a song manually', e)
      setError(e.message || 'Failed to add the song.')
    } finally {
      setBusy(false)
    }
  }

  const submit = () =>
    run(async (input) => {
      const match = await actions.findCatalogSong(input.title, input.artist)
      if (match) setOffer(match)
      else await write(input)
    })

  return {
    draft,
    title: draftTitle(draft, query),
    detailsOpen,
    offer,
    error,
    busy,
    setField,
    toggleDetails: () => setDetailsOpen((open) => !open),
    submit,
    acceptOffer: () => run(write),
    declineOffer: () => setOffer(null),
  }
}
