import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { logger } from '@/lib/logger'
import { searchSpotify, type SpotifyTrack } from '@/lib/spotify'
import {
  findRepertoireVersionIdByTrack,
  heldPickerVersionId,
  isAlreadyInRepertoireError,
  shouldSearchPicker,
  withPickerRowError,
  withoutPickerRowError,
  type SongPickerController,
} from '@/lib/songPicker'
import {
  mergeSongSearchResults,
  withoutHeldVersions,
  type SearchVersionCandidate,
  type SongSearchRow,
} from '@/lib/songSearchMerge'
import type {
  CatalogSearchResult,
  Playlist,
  PlaylistSong,
  Repertoire,
  SongLink,
} from '@/types/database'

/** How long the picker waits after the last keystroke before it searches. */
const PICKER_DEBOUNCE_MS = 500

/** The subset of the create-song payload a Spotify row fills in. */
export interface PickerSongInput {
  title: string
  artist: string
  album?: string
  cover_url?: string
  links?: SongLink[]
}

/**
 * The Server Actions the picker calls. Injected rather than imported, so
 * `src/hooks` never points back into the App Router tree (F21) — the page hands
 * these down from `src/app/songPickerActions.ts`.
 *
 * The Spotify half of the search is absent on purpose: `searchSpotify` is a
 * client `fetch` living in `src/lib`, not a Server Action, so the hook imports
 * it directly and no injection is needed.
 */
export interface SongPickerActions {
  /** Each result carries its representative version id (RH-125). */
  searchCatalog: (query: string) => Promise<CatalogSearchResult[]>
  addToRepertoire: (songId: string) => Promise<Repertoire>
  createAndAddSong: (data: PickerSongInput) => Promise<Repertoire>
  /** RH-125: the playlist entry is a version. */
  addSongToPlaylist: (playlistId: string, versionId: string) => Promise<void>
  getPlaylistWithSongs: (playlistId: string) => Promise<Playlist | null>
}

export interface UseSongPickerOptions {
  /** The playlist rows are added to. */
  playlistId: string
  /** Required, never defaulted — see `src/app/songPickerActions.ts` (F21). */
  actions: SongPickerActions
  /** The owner's repertoire, keyed by `version_id` (RH-125). Owned by the page. */
  repertoire: ReadonlyMap<string, Repertoire>
  /** The playlist's current entries — versions already in it are hidden. */
  songs: PlaylistSong[]
  /** The page's `setSongs`: an add reloads the playlist and reports it here. */
  onSongsChanged: (songs: PlaylistSong[]) => void
  /** The page's `autoPushIfNeeded`, run after every successful add. */
  afterAdd: () => Promise<void>
}

/**
 * RH-67 — the playlist add-song picker's controller: the query and its 500 ms
 * debounce, the parallel catalog + Spotify search with its stale-response
 * guard, the merged result list and the add command.
 *
 * RH-108 made the two lists one and the two add commands one. The search
 * effect feeds both responses to `mergeSongSearchResults`, which is what
 * collapses a catalog row and a Spotify row for the same song into a single
 * row — merging each source separately and concatenating would reproduce the
 * defect exactly. The playlist filter stays a `useMemo` of its own, keyed on
 * `songs`, so a successful add re-filters without re-issuing the search.
 *
 * `addRow` settles rather than rejects: a failure from the repertoire write,
 * the playlist write, the reload or the auto-push is recorded under that row's
 * id in `rowErrors` and cleared when the row is tried again, so one bad result
 * leaves the rest of the panel usable.
 */
export function useSongPicker({
  playlistId,
  actions,
  repertoire,
  songs,
  onSongsChanged,
  afterAdd,
}: UseSongPickerOptions): SongPickerController {
  const [query, setQuery] = useState('')
  const [merged, setMerged] = useState<SongSearchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestQuery = useRef('')

  const runSearch = useCallback(
    async (next: string) => {
      latestQuery.current = next
      if (!shouldSearchPicker(next)) {
        setMerged([])
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        const [catalog, spotify] = await Promise.all([
          actions.searchCatalog(next).catch(() => [] as CatalogSearchResult[]),
          searchSpotify(next).catch(() => [] as SpotifyTrack[]),
        ])
        // A slower earlier query must not overwrite the answer to this one.
        if (latestQuery.current !== next) return
        // One merge over both responses — the `.catch(() => [])` on each half
        // is what makes a Spotify outage a complete catalog-only list rather
        // than an empty panel, and the reverse.
        setMerged(mergeSongSearchResults(catalog, spotify))
      } finally {
        if (latestQuery.current === next) setLoading(false)
      }
    },
    [actions],
  )

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      runSearch(query).catch((error: unknown) => {
        logger.error(
          'Failed to search the song picker',
          error instanceof Error ? error : new Error(String(error)),
          { query },
        )
      })
    }, PICKER_DEBOUNCE_MS)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [query, runSearch])

  const playlistVersionIds = useMemo(() => new Set(songs.map((ps) => ps.version_id)), [songs])
  const results = useMemo(
    () => withoutHeldVersions(merged, playlistVersionIds),
    [merged, playlistVersionIds],
  )

  /** Add a version the repertoire already holds, then refresh the playlist. */
  const addVersionToPlaylist = useCallback(
    async (versionId: string) => {
      await actions.addSongToPlaylist(playlistId, versionId)
      const updated = await actions.getPlaylistWithSongs(playlistId)
      onSongsChanged(updated?.songs ?? [])
      await afterAdd()
    },
    [actions, playlistId, onSongsChanged, afterAdd],
  )

  /**
   * The version a **catalog** row resolves to. Nothing is created: the row
   * already names a local recording, or a local song whose first version the
   * repertoire write produces.
   */
  const resolveCatalogVersionId = useCallback(
    async (row: SongSearchRow): Promise<string> => {
      const held = heldPickerVersionId(row, repertoire)
      if (held) return held
      if (!row.songId) throw new Error('This result cannot be added')
      return (await actions.addToRepertoire(row.songId)).version_id
    },
    [actions, repertoire],
  )

  /** The version a **Spotify** candidate resolves to, creating the song when new. */
  const resolveTrackVersionId = useCallback(
    async (row: SongSearchRow, pick: SearchVersionCandidate): Promise<string> => {
      try {
        const created = await actions.createAndAddSong({
          // The **unsplit** source title: `resolveOrCreateSongIdentity` splits
          // it and `upsertAlbumAndVersion` stores the right half as
          // `song_versions.label`. The row's display title would write a null
          // label for `"Bad - Remaster 2012"` (RH-122).
          title: pick.rawTitle,
          artist: row.artist,
          album: pick.albumName ?? undefined,
          cover_url: pick.coverUrl ?? undefined,
          // The only reason `spotifyUrl` is on the candidate: without it every
          // song created from a Spotify row loses its Spotify URL.
          links: pick.spotifyUrl ? [{ label: 'Spotify', url: pick.spotifyUrl }] : [],
        })
        return created.version_id
      } catch (error) {
        if (!isAlreadyInRepertoireError(error)) throw error
        const existing = findRepertoireVersionIdByTrack([...repertoire.values()], {
          title: pick.rawTitle,
          artist: row.artist,
        })
        if (!existing) throw error
        return existing
      }
    },
    [actions, repertoire],
  )

  /**
   * Dispatches on the representative candidate's **derived** source, after the
   * one guard the version-less catalog row requires.
   *
   * The empty check comes first, so nothing evaluates `versions[0]` on an
   * empty array. A candidate carrying both ids is a *catalog* candidate and
   * takes the cheap branch, which is the point of collapsing: the recording
   * already exists locally, so nothing needs creating.
   */
  const resolveRowVersionId = useCallback(
    async (row: SongSearchRow): Promise<string> => {
      const pick = row.versions[0]
      if (!pick || pick.versionId !== null) return resolveCatalogVersionId(row)
      return resolveTrackVersionId(row, pick)
    },
    [resolveCatalogVersionId, resolveTrackVersionId],
  )

  const addRow = useCallback(
    async (row: SongSearchRow) => {
      setAddingId(row.id)
      setRowErrors((prev) => withoutPickerRowError(prev, row.id))
      try {
        const versionId = await resolveRowVersionId(row)
        await addVersionToPlaylist(versionId)
      } catch (error) {
        setRowErrors((prev) => withPickerRowError(prev, row.id, error))
      } finally {
        setAddingId(null)
      }
    },
    [addVersionToPlaylist, resolveRowVersionId],
  )

  const changeQuery = useCallback((next: string) => setQuery(next), [])

  return { query, loading, addingId, rowErrors, results, changeQuery, addRow }
}
