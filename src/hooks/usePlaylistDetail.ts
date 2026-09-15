import { useMemo, useReducer, useState, type Dispatch } from 'react'
import { useSongPicker, type SongPickerActions } from '@/hooks/useSongPicker'
import { useSpotifySync, type SpotifySyncController } from '@/hooks/useSpotifySync'
import { useTagEditor, type TagEditorController } from '@/hooks/useTagEditor'
import {
  collectPlaylistTags,
  cycleSongStatus,
  filterPlaylistSongs,
} from '@/lib/playlistDetail'
import {
  EMPTY_PLAYLIST_OVERLAY,
  applyDetailOverlay,
  playlistOverlayReducer,
} from '@/lib/playlistOverlay'
import {
  NO_PANEL,
  playlistPanelReducer,
  renameDraft,
  type PlaylistPanel,
  type PlaylistPanelAction,
} from '@/lib/playlistPanels'
import type { SongPickerController } from '@/lib/songPicker'
import type { Playlist, PlaylistSong, Repertoire, SongStatus } from '@/types/database'

/**
 * The Server Actions `/playlists/[id]` injects. Declared here rather than in the
 * island because this hook is what calls them; the island only forwards the
 * bundle it was handed, and neither file may point back into the App Router
 * tree (F21).
 *
 * The two repertoire writes take the owner as their third argument. The page
 * derives it from `playlist.band_id`, so the repertoire the rows were read from
 * and the repertoire an edit lands on are the same one — which is what makes a
 * song-tag edit under a band hat succeed instead of being rejected as
 * `Repertoire entry not found or access denied` (RH-71).
 */
export interface PlaylistDetailActions {
  updatePlaylist(id: string, data: { name?: string; tags?: string[] }): Promise<void>
  deletePlaylist(id: string): Promise<void>
  removeSongFromPlaylist(playlistId: string, songId: string): Promise<void>
  updateSongStatus(entryId: string, status: SongStatus, bandId?: string | null): Promise<void>
  updateSongTags(entryId: string, tags: string[], bandId?: string | null): Promise<void>
}

export interface UsePlaylistDetailOptions {
  /** Read on the server by `getPlaylistWithSongs`; never fetched here. */
  playlist: Playlist
  /** The playlist owner's repertoire, read on the server under the same owner. */
  repertoire: Repertoire[]
  actions: PlaylistDetailActions
  /** `SONG_PICKER_ACTIONS`, module-scoped so the debounce cannot restart. */
  pickerActions: SongPickerActions
  /** Re-reads the server props after a write; the island binds `router.refresh`. */
  onRefresh: () => void
  /** Leaves the route once the playlist is gone; the island binds `router.replace`. */
  onDeleted: () => void
}

/** Commands and values only — never a raw state setter (F14). */
export interface PlaylistDetailController {
  /** The server playlist with this tab's rename and tag edits over it. */
  playlist: Playlist
  songs: PlaylistSong[]
  repertoireMap: Map<string, Repertoire>
  /** The songs left after the tag chip and the text query. */
  filteredSongs: PlaylistSong[]
  /** Every tag the visible songs carry, for the filter bar. */
  allTags: string[]
  error: string | null
  dismissError: () => void
  activeTagFilter: string | null
  changeTagFilter: (tag: string | null) => void
  songFilterQuery: string
  changeSongFilterQuery: (query: string) => void
  panel: PlaylistPanel
  dispatch: Dispatch<PlaylistPanelAction>
  sync: SpotifySyncController
  picker: SongPickerController
  playlistTagEditor: TagEditorController
  songTagEditor: TagEditorController
  removeSong: (songId: string) => Promise<void>
  cycleStatus: (songId: string) => Promise<void>
  rename: () => Promise<void>
  remove: () => Promise<void>
}

/**
 * RH-71 — the controller of `/playlists/[id]`, everything the page used to hold
 * except the markup and the router.
 *
 * There is no load here and no mount effect: the props arrive finished from the
 * Server Component, and every command records its optimistic overlay entry,
 * awaits its Server Action and then asks for a refresh through `onRefresh`. The
 * router itself stays in the island, so this hook is drivable by `renderHook`
 * with plain `vi.fn()`s and no navigation mock.
 */
export function usePlaylistDetail({
  playlist,
  repertoire,
  actions,
  pickerActions,
  onRefresh,
  onDeleted,
}: UsePlaylistDetailOptions): PlaylistDetailController {
  const bandId = playlist.band_id
  const [error, setError] = useState<string | null>(null)
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null)
  const [songFilterQuery, setSongFilterQuery] = useState('')
  const [panel, dispatch] = useReducer(playlistPanelReducer, NO_PANEL)
  const [overlay, record] = useReducer(playlistOverlayReducer, EMPTY_PLAYLIST_OVERLAY)

  const view = useMemo(
    () => applyDetailOverlay(playlist, repertoire, overlay),
    [playlist, repertoire, overlay],
  )
  const { songs, repertoireMap } = view
  const allTags = useMemo(
    () => collectPlaylistTags(songs, repertoireMap),
    [songs, repertoireMap],
  )
  const filteredSongs = useMemo(
    () =>
      filterPlaylistSongs(songs, repertoireMap, {
        tag: activeTagFilter,
        query: songFilterQuery,
      }),
    [songs, repertoireMap, activeTagFilter, songFilterQuery],
  )

  const sync = useSpotifySync({
    playlistId: playlist.id,
    playlist,
    onError: setError,
    // A pull rewrote the playlist server-side and hands back no list, so the
    // rows this tab was hiding are released before the refresh: a song the
    // pull re-imported has to be visible again, not hidden by the removal that
    // preceded it.
    onSynced: async () => {
      record({ type: 'songs-pulled' })
      onRefresh()
    },
  })

  const picker = useSongPicker({
    playlistId: playlist.id,
    actions: pickerActions,
    repertoire: repertoireMap,
    songs,
    // The picker reloads the playlist itself and hands back the fresh list, so
    // the rows the server props do not carry yet are recorded rather than
    // waited for: the refresh below replaces them with the props' own copies.
    // Recording that list is also what releases a song removed earlier in this
    // session and added back through the picker (`songs-reported`).
    onSongsChanged: reported => {
      record({ type: 'songs-reported', songs: reported })
      onRefresh()
    },
    afterAdd: sync.pushIfNeeded,
  })

  const removeSong = async (songId: string) => {
    setError(null)
    record({ type: 'remove-song', songId })
    try {
      await actions.removeSongFromPlaylist(playlist.id, songId)
      await sync.pushIfNeeded()
      onRefresh()
    } catch (err) {
      record({ type: 'restore-song', songId })
      setError(err instanceof Error ? err.message : 'Failed to remove song')
    }
  }

  const cycleStatus = async (songId: string) => {
    const cycle = cycleSongStatus(repertoireMap, songId)
    if (!cycle) return
    record({ type: 'repertoire-entry', songId, entry: cycle.updated })
    try {
      await actions.updateSongStatus(cycle.entry.id, cycle.status, bandId)
      onRefresh()
    } catch (err) {
      // Back to the entry captured before the write, not a status recomputed
      // backwards — the one asymmetry the two tag editors below do not share.
      record({ type: 'repertoire-entry', songId, entry: cycle.entry })
      setError(err instanceof Error ? err.message : 'Failed to update status')
    }
  }

  const rename = async () => {
    const trimmed = renameDraft(panel).trim()
    if (!trimmed) {
      dispatch({ type: 'close' })
      return
    }
    setError(null)
    record({ type: 'rename', name: trimmed })
    try {
      await actions.updatePlaylist(playlist.id, { name: trimmed })
      dispatch({ type: 'close' })
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename')
    }
  }

  const remove = async () => {
    setError(null)
    try {
      await actions.deletePlaylist(playlist.id)
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const playlistTagEditor = useTagEditor({
    readTags: () => view.playlist.tags ?? [],
    applyTags: (_subject, tags) => record({ type: 'playlist-tags', tags }),
    saveTags: async (_subject, tags) => {
      await actions.updatePlaylist(playlist.id, { tags })
      onRefresh()
    },
    onError: setError,
    addFailureMessage: 'Failed to update tags',
    removeFailureMessage: 'Failed to update tags',
  })

  const songTagEditor = useTagEditor({
    readTags: songId => repertoireMap.get(songId)?.tags ?? null,
    applyTags: (songId, tags) => {
      const entry = repertoireMap.get(songId)
      if (entry) record({ type: 'repertoire-entry', songId, entry: { ...entry, tags } })
    },
    saveTags: async (songId, tags) => {
      // Unreachable without an entry: `readTags` reports `null` for that song.
      const entry = repertoireMap.get(songId)
      if (!entry) return
      await actions.updateSongTags(entry.id, tags, bandId)
      onRefresh()
    },
    onError: setError,
    addFailureMessage: 'Failed to add tag',
    removeFailureMessage: 'Failed to remove tag',
  })

  return {
    playlist: view.playlist,
    songs,
    repertoireMap,
    filteredSongs,
    allTags,
    error,
    dismissError: () => setError(null),
    activeTagFilter,
    changeTagFilter: setActiveTagFilter,
    songFilterQuery,
    changeSongFilterQuery: setSongFilterQuery,
    panel,
    dispatch,
    sync,
    picker,
    playlistTagEditor,
    songTagEditor,
    removeSong,
    cycleStatus,
    rename,
    remove,
  }
}
