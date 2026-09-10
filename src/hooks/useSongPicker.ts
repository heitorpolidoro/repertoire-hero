import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { logger } from '@/lib/logger'
import { searchSpotify, type SpotifyTrack } from '@/lib/spotify'
import {
  findRepertoireSongIdByTrack,
  isAlreadyInRepertoireError,
  pickerCatalogKeys,
  shouldSearchPicker,
  visiblePickerCatalog,
  visiblePickerSpotify,
  withPickerRowError,
  withoutPickerRowError,
  type SongPickerController,
} from '@/lib/songPicker'
import type { GlobalSong, Playlist, PlaylistSong, Repertoire, SongLink } from '@/types/database'

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
  searchCatalog: (query: string) => Promise<GlobalSong[]>
  addToRepertoire: (songId: string) => Promise<Repertoire>
  createAndAddSong: (data: PickerSongInput) => Promise<Repertoire>
  addSongToPlaylist: (playlistId: string, songId: string) => Promise<void>
  getPlaylistWithSongs: (playlistId: string) => Promise<Playlist | null>
}

export interface UseSongPickerOptions {
  /** The playlist rows are added to. */
  playlistId: string
  /** Required, never defaulted — see `src/app/songPickerActions.ts` (F21). */
  actions: SongPickerActions
  /** The owner's repertoire, keyed by song id. Owned by the page. */
  repertoire: ReadonlyMap<string, Repertoire>
  /** The playlist's current songs — catalog rows already in it are hidden. */
  songs: PlaylistSong[]
  /** The page's `setSongs`: an add reloads the playlist and reports it here. */
  onSongsChanged: (songs: PlaylistSong[]) => void
  /** The page's `autoPushIfNeeded`, run after every successful add. */
  afterAdd: () => Promise<void>
}

/**
 * RH-67 — the playlist add-song picker's controller: the query and its 500 ms
 * debounce, the parallel catalog + Spotify search with its stale-response
 * guard, the deduplicated result lists and the two add commands.
 *
 * Both add commands settle rather than reject: a failure from the repertoire
 * write, the playlist write, the reload or the auto-push is recorded under that
 * row's id in `rowErrors` and cleared when the row is tried again, so one bad
 * result leaves the rest of the panel usable.
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
  const [catalogResults, setCatalogResults] = useState<GlobalSong[]>([])
  const [spotifyResults, setSpotifyResults] = useState<SpotifyTrack[]>([])
  const [loading, setLoading] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestQuery = useRef('')

  const runSearch = useCallback(
    async (next: string) => {
      latestQuery.current = next
      if (!shouldSearchPicker(next)) {
        setCatalogResults([])
        setSpotifyResults([])
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        const [catalog, spotify] = await Promise.all([
          actions.searchCatalog(next).catch(() => [] as GlobalSong[]),
          searchSpotify(next).catch(() => [] as SpotifyTrack[]),
        ])
        // A slower earlier query must not overwrite the answer to this one.
        if (latestQuery.current !== next) return
        setCatalogResults(catalog)
        setSpotifyResults(spotify)
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

  const playlistSongIds = useMemo(() => new Set(songs.map((ps) => ps.song_id)), [songs])
  const visibleCatalog = useMemo(
    () => visiblePickerCatalog(catalogResults, playlistSongIds),
    [catalogResults, playlistSongIds],
  )
  const catalogKeys = useMemo(() => pickerCatalogKeys(visibleCatalog), [visibleCatalog])
  const visibleSpotify = useMemo(
    () => visiblePickerSpotify(spotifyResults, catalogKeys),
    [spotifyResults, catalogKeys],
  )

  /** Add a song the repertoire already holds, then refresh the playlist. */
  const addSongIdToPlaylist = useCallback(
    async (songId: string) => {
      await actions.addSongToPlaylist(playlistId, songId)
      const updated = await actions.getPlaylistWithSongs(playlistId)
      onSongsChanged(updated?.songs ?? [])
      await afterAdd()
    },
    [actions, playlistId, onSongsChanged, afterAdd],
  )

  /** The song id a Spotify row resolves to, creating the song when it is new. */
  const resolveTrackId = useCallback(
    async (track: SpotifyTrack): Promise<string> => {
      try {
        const created = await actions.createAndAddSong({
          title: track.title,
          artist: track.artist,
          album: track.album ?? undefined,
          cover_url: track.albumArt ?? undefined,
          links: [{ label: 'Spotify', url: track.spotifyUrl }],
        })
        return created.song_id
      } catch (error) {
        if (!isAlreadyInRepertoireError(error)) throw error
        const existing = findRepertoireSongIdByTrack([...repertoire.values()], track)
        if (!existing) throw error
        return existing
      }
    },
    [actions, repertoire],
  )

  const addCatalogSong = useCallback(
    async (song: GlobalSong) => {
      setAddingId(song.id)
      setRowErrors((prev) => withoutPickerRowError(prev, song.id))
      try {
        if (!repertoire.has(song.id)) await actions.addToRepertoire(song.id)
        await addSongIdToPlaylist(song.id)
      } catch (error) {
        setRowErrors((prev) => withPickerRowError(prev, song.id, error))
      } finally {
        setAddingId(null)
      }
    },
    [actions, addSongIdToPlaylist, repertoire],
  )

  const addSpotifyTrack = useCallback(
    async (track: SpotifyTrack) => {
      setAddingId(track.id)
      setRowErrors((prev) => withoutPickerRowError(prev, track.id))
      try {
        const songId = await resolveTrackId(track)
        await addSongIdToPlaylist(songId)
      } catch (error) {
        setRowErrors((prev) => withPickerRowError(prev, track.id, error))
      } finally {
        setAddingId(null)
      }
    },
    [addSongIdToPlaylist, resolveTrackId],
  )

  const changeQuery = useCallback((next: string) => setQuery(next), [])

  return {
    query,
    loading,
    addingId,
    rowErrors,
    catalogResults: visibleCatalog,
    spotifyResults: visibleSpotify,
    changeQuery,
    addCatalogSong,
    addSpotifyTrack,
  }
}
