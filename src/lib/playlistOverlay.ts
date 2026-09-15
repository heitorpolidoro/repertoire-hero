import { withRepertoireEntry } from '@/lib/playlistDetail'
import type { Playlist, PlaylistSong, Repertoire } from '@/types/database'

/**
 * RH-71 — the in-flight local edits of `/playlists/[id]`, kept beside the props
 * the Server Component read instead of on top of a copy of them.
 *
 * `src/app/playlists/[id]/page.tsx` reads the playlist and the owner's
 * repertoire on the server, so the island's props are the source of truth and
 * are never copied into React state: a state initialiser is ignored on every
 * re-render after the first, so a `router.refresh()` would leave that copy
 * stale forever.
 * The controller records only what this tab changed and re-applies it over the
 * props at render time, exactly as `PlaylistsView` does for the list.
 *
 * Most entries here are idempotent once the refresh lands: a renamed playlist
 * already carries the name, a reported row is already in the list and an
 * overridden entry already equals the server row, so re-applying them changes
 * nothing.
 *
 * A removal is the exception, and it is the one entry that has to be cleared.
 * It hides a row the props still carry, so it keeps hiding that song for as
 * long as it is recorded — and the same page session can legitimately put the
 * song back, through the add-song picker or through a Spotify pull that
 * re-imports it. Both therefore drop it: `songs-reported` releases the ids the
 * picker's own reload reported, and `songs-pulled` releases the whole set,
 * because a pull rewrites the server list wholesale and reports no list this
 * overlay could compare against. Without that, a re-added song is written to
 * the database and never seen again until a full page load, and the second
 * attempt is a silent no-op (`addSongToPlaylist` is `ON CONFLICT DO NOTHING`).
 *
 * The names are deliberately not the ones `src/lib/playlistList.ts` exports for
 * `PlaylistsView` — two same-shaped lib exports under the same name, one import
 * away from each other, would confuse the next reader and no gate catches it.
 */

/** What this tab changed since the render the server shipped. */
export interface PlaylistDetailOverlay {
  /** A name committed by the rename panel, or `null` when none was. */
  name: string | null
  /** A replacement tag list for the playlist itself, or `null` when none was. */
  tags: string[] | null
  /**
   * Song ids removed here; their rows go before the write lands, and stay gone
   * until the picker reports them back or a pull rewrites the list.
   */
  removedSongIds: string[]
  /** The rows the add-song picker last reported from its own reload. */
  reportedSongs: PlaylistSong[]
  /** Repertoire entries edited here, by song id. */
  entries: Record<string, Repertoire>
}

/** Everything the controller can record. */
export type PlaylistOverlayAction =
  | { type: 'rename'; name: string }
  | { type: 'playlist-tags'; tags: string[] }
  | { type: 'remove-song'; songId: string }
  | { type: 'restore-song'; songId: string }
  | { type: 'songs-reported'; songs: PlaylistSong[] }
  | { type: 'songs-pulled' }
  | { type: 'repertoire-entry'; songId: string; entry: Repertoire }

/** The starting value, so no call site has to spell the literal (`NO_PANEL`). */
export const EMPTY_PLAYLIST_OVERLAY: PlaylistDetailOverlay = {
  name: null,
  tags: null,
  removedSongIds: [],
  reportedSongs: [],
  entries: {},
}

/**
 * Records one edit. Every case returns a fresh value rather than mutating, and
 * an action this overlay does not know returns the state unchanged, so an
 * unrecognised dispatch can never re-render the island for nothing.
 */
export function playlistOverlayReducer(
  state: PlaylistDetailOverlay,
  action: PlaylistOverlayAction,
): PlaylistDetailOverlay {
  switch (action.type) {
    case 'rename':
      return { ...state, name: action.name }
    case 'playlist-tags':
      return { ...state, tags: action.tags }
    case 'remove-song':
      return { ...state, removedSongIds: [...state.removedSongIds, action.songId] }
    case 'restore-song':
      return {
        ...state,
        removedSongIds: state.removedSongIds.filter(id => id !== action.songId),
      }
    case 'songs-reported': {
      // A song the picker just reported is in the playlist again, whoever put
      // it there, so the entry that hid it is released with it. The ids the
      // report does not carry keep theirs: that is a removal still in flight.
      const reported = new Set(action.songs.map(ps => ps.song_id))
      return {
        ...state,
        reportedSongs: action.songs,
        removedSongIds: state.removedSongIds.filter(id => !reported.has(id)),
      }
    }
    case 'songs-pulled':
      // A pull replaced the server list from Spotify and reports nothing to
      // compare against, so every removal this tab was hiding is released.
      return { ...state, removedSongIds: [] }
    case 'repertoire-entry':
      return { ...state, entries: { ...state.entries, [action.songId]: action.entry } }
    default:
      return state
  }
}

/**
 * What the island renders: the server playlist with this tab's rename and tag
 * list over it, the server song list with the removals hidden and the rows the
 * picker reported appended, and the owner's repertoire indexed by song id with
 * the locally edited entries replaced.
 *
 * A reported row the server props already carry is dropped rather than appended
 * twice — matched by `song_id`, which is what the whole list is keyed by — and
 * the server's own order is left alone.
 */
export function applyDetailOverlay(
  serverPlaylist: Playlist,
  repertoire: Repertoire[],
  overlay: PlaylistDetailOverlay,
): { playlist: Playlist; songs: PlaylistSong[]; repertoireMap: Map<string, Repertoire> } {
  const playlist: Playlist = {
    ...serverPlaylist,
    name: overlay.name ?? serverPlaylist.name,
    tags: overlay.tags ?? serverPlaylist.tags,
  }

  const serverSongs = serverPlaylist.songs ?? []
  const known = new Set(serverSongs.map(ps => ps.song_id))
  const removed = new Set(overlay.removedSongIds)
  const songs = [
    ...serverSongs,
    ...overlay.reportedSongs.filter(ps => !known.has(ps.song_id)),
  ].filter(ps => !removed.has(ps.song_id))

  const repertoireMap = Object.entries(overlay.entries).reduce(
    (map, [songId, entry]) => withRepertoireEntry(map, songId, entry),
    new Map<string, Repertoire>(repertoire.map(entry => [entry.song_id, entry])),
  )

  return { playlist, songs, repertoireMap }
}
