import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { logger } from '@/lib/logger'
import { heldRepertoire, withoutHeldRows } from '@/lib/repertoireSearchFilter'
import { searchMergedRows } from '@/lib/songSearchFetch'
import {
  isAlreadyInRepertoireError,
  shouldSearchPicker,
  trackCreateInput,
  withPickerRowError,
  withoutPickerRowError,
  type TrackCreateInput,
} from '@/lib/songPicker'
import type { SongSearchRow } from '@/lib/songSearchMerge'
import type { CatalogSearchResult, Repertoire } from '@/types/database'

/** How long the dashboard waits after the last keystroke before it searches. */
const SEARCH_DEBOUNCE_MS = 500

/** What a refused Spotify add says: the song is already held. */
const ALREADY_HELD_MESSAGE = 'Already in your repertoire.'

/**
 * The Server Actions the dashboard's add-to-repertoire search calls, injected by
 * `src/app/page.tsx` so `src/hooks` never points back into the App Router (F21).
 */
export interface RepertoireSearchActions {
  searchSongs: (query: string) => Promise<CatalogSearchResult[]>
  /** A version-less catalog row: the write resolves the song's first version. */
  addSong: (songId: string) => Promise<unknown>
  /** Exactly the named version (RH-151). */
  addVersion: (versionId: string) => Promise<unknown>
  createAndAddSong: (data: TrackCreateInput) => Promise<unknown>
}

export interface UseRepertoireSearchOptions {
  actions: RepertoireSearchActions
  /** The store's search box value; the search itself is debounced. */
  query: string
  /** The owner's repertoire: what is held is hidden from the results. */
  entries: readonly Repertoire[]
  /** Run after every successful add (the dashboard reloads its list). */
  onAdded: () => Promise<void>
}

export interface RepertoireSearchController {
  /** A search is in flight for the current query. */
  loading: boolean
  /** One row per song, minus everything the owner already holds. */
  results: SongSearchRow[]
  /** Row id currently being added, or `null`. Keyed by `SongSearchRow.id`. */
  addingId: string | null
  /** Per-row failure messages, keyed by `SongSearchRow.id`. */
  rowErrors: Record<string, string>
  /** Add a row. Never rejects: a failure lands in `rowErrors`. */
  addRow: (row: SongSearchRow) => Promise<void>
}

/**
 * RH-151 — the dashboard's "Add to your repertoire" controller: the debounced
 * catalog + Spotify search with its stale-response guard, one
 * `mergeSongSearchResults` over both halves, the held filter and the add
 * command. The same shape as `useSongPicker`, with the repertoire where the
 * playlist is.
 *
 * `addRow` dispatches on the row's `versions[0]` (the card hands over a row
 * narrowed to the picked version): a catalog candidate is added by version id, a
 * Spotify candidate is created, a version-less catalog row falls back to its
 * song id.
 */
export function useRepertoireSearch({
  actions,
  query,
  entries,
  onAdded,
}: UseRepertoireSearchOptions): RepertoireSearchController {
  const [merged, setMerged] = useState<SongSearchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const latestQuery = useRef('')

  const runSearch = useCallback(
    async (next: string) => {
      latestQuery.current = next
      if (!shouldSearchPicker(next)) {
        setMerged([])
        setLoading(false)
        return
      }
      setRowErrors({})
      setLoading(true)
      try {
        const rows = await searchMergedRows(actions.searchSongs, next)
        // A slower earlier query must not overwrite the answer to this one.
        if (latestQuery.current !== next) return
        setMerged(rows)
      } finally {
        if (latestQuery.current === next) setLoading(false)
      }
    },
    [actions],
  )

  useEffect(() => {
    const timer = setTimeout(() => {
      runSearch(query).catch((error: unknown) => {
        logger.error(
          'Failed to search the repertoire',
          error instanceof Error ? error : new Error(String(error)),
          { query },
        )
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, runSearch])

  const held = useMemo(() => heldRepertoire(entries), [entries])
  const results = useMemo(() => withoutHeldRows(merged, held), [merged, held])

  const addRow = useCallback(
    async (row: SongSearchRow) => {
      setAddingId(row.id)
      setRowErrors((prev) => withoutPickerRowError(prev, row.id))
      try {
        await dispatchAdd(actions, row)
        await onAdded()
      } catch (error) {
        const shown = isAlreadyInRepertoireError(error) ? new Error(ALREADY_HELD_MESSAGE) : error
        setRowErrors((prev) => withPickerRowError(prev, row.id, shown))
      } finally {
        setAddingId(null)
      }
    },
    [actions, onAdded],
  )

  return { loading, results, addingId, rowErrors, addRow }
}

/** The one write a row's first candidate asks for. */
async function dispatchAdd(actions: RepertoireSearchActions, row: SongSearchRow): Promise<void> {
  const pick = row.versions[0]
  if (!pick) {
    if (!row.songId) throw new Error('This result cannot be added')
    await actions.addSong(row.songId)
  } else if (pick.versionId !== null) {
    await actions.addVersion(pick.versionId)
  } else {
    await actions.createAndAddSong(trackCreateInput(row, pick))
  }
}
