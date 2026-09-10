"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import {
  getPlaylistWithSongsAction as getPlaylistWithSongs,
  updatePlaylistAction as updatePlaylist,
  deletePlaylistAction as deletePlaylist,
  removeSongFromPlaylistAction as removeSongFromPlaylist,
} from "@/app/actions/playlists";
import {
  updateSongStatusAction as updateSongStatus,
  updateSongTagsAction as updateSongTags,
} from "@/app/actions/repertoire";
import { SONG_PICKER_ACTIONS } from "@/app/songPickerActions";
import { PlaylistDetailHeader } from "@/components/playlists/PlaylistDetailHeader";
import { PlaylistSongList } from "@/components/playlists/PlaylistSongList";
import { PlaylistSummary } from "@/components/playlists/PlaylistSummary";
import { PlaylistTagBar } from "@/components/playlists/PlaylistTagBar";
import { SongPicker } from "@/components/playlists/SongPicker";
import { TagFilterBar } from "@/components/playlists/TagFilterBar";
import { Spinner } from "@/components/ui/Spinner";
import { useSongPicker } from "@/hooks/useSongPicker";
import { useSpotifySync } from "@/hooks/useSpotifySync";
import { useTagEditor } from "@/hooks/useTagEditor";
import {
  collectPlaylistTags,
  cycleSongStatus,
  filterPlaylistSongs,
  withRepertoireEntry,
} from "@/lib/playlistDetail";
import { NO_PANEL, playlistPanelReducer, renameDraft } from "@/lib/playlistPanels";
import { authClient } from "@/lib/auth-client";
import { getRepertoireAction } from "@/app/actions/repertoire";
import { useBandContextStore } from "@/store/bandContextStore";
import type { Playlist, PlaylistSong, Repertoire } from "@/types/database";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PlaylistDetailPage() {
  const params = useParams();
  const router = useRouter();
  const playlistId = params.id as string;
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id ?? null;
  const bandId = useBandContextStore((s) => s.bandId());

  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [songs, setSongs] = useState<PlaylistSong[]>([]);
  const [repertoireMap, setRepertoireMap] = useState<
    Map<string, Repertoire>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [songFilterQuery, setSongFilterQuery] = useState("");

  // Rename, delete confirmation and the add-song panel, as one value: the union
  // makes "two panels open at once" unrepresentable (RH-70).
  const [panel, dispatch] = useReducer(playlistPanelReducer, NO_PANEL);

  const refreshPlaylist = useCallback(async () => {
    const data = await getPlaylistWithSongs(playlistId);
    if (!data) {
      router.replace("/playlists");
      return;
    }
    setPlaylist(data);
    setSongs(data.songs ?? []);

    // Band or personal: the trigger keeps band status in sync,
    // so getRepertoireAction(bandId) reads the correct value directly.
    const rep = await getRepertoireAction(bandId);
    setRepertoireMap(new Map(rep.map((r: Repertoire) => [r.song_id, r])));
  }, [playlistId, router, bandId]);

  useEffect(() => {
    // Re-enters the loading state when `refreshPlaylist` changes identity (a
    // band-context switch). RH-71 deletes this effect with the Server Component
    // conversion; until then, the same exception `useBandAdmin.ts` carries.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    refreshPlaylist()
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Failed to load playlist",
        ),
      )
      .finally(() => setLoading(false));
  }, [refreshPlaylist]);

  const allTags = useMemo(
    () => collectPlaylistTags(songs, repertoireMap),
    [songs, repertoireMap],
  );

  const filteredSongs = useMemo(
    () =>
      filterPlaylistSongs(songs, repertoireMap, {
        tag: activeTagFilter,
        query: songFilterQuery,
      }),
    [songs, repertoireMap, activeTagFilter, songFilterQuery],
  );

  // Spotify, both directions: the Sync button pulls and settles, a local edit
  // pushes and rejects so its caller can attribute the failure.
  const sync = useSpotifySync({
    playlistId,
    playlist,
    onError: setError,
    onSynced: refreshPlaylist,
  });

  // The add-song panel: query, debounce, dual-source search and the two adds
  const picker = useSongPicker({
    playlistId,
    actions: SONG_PICKER_ACTIONS,
    repertoire: repertoireMap,
    songs,
    onSongsChanged: setSongs,
    afterAdd: sync.pushIfNeeded,
  });

  const handleRemoveSong = async (songId: string) => {
    setError(null);
    try {
      await removeSongFromPlaylist(playlistId, songId);
      setSongs((prev) => prev.filter((ps) => ps.song_id !== songId));
      await sync.pushIfNeeded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove song");
    }
  };

  const handleStatusCycle = async (songId: string) => {
    const cycle = cycleSongStatus(repertoireMap, songId);
    if (!cycle) return;
    // Optimistic update
    setRepertoireMap((prev) => withRepertoireEntry(prev, songId, cycle.updated));
    try {
      await updateSongStatus(cycle.entry.id, cycle.status);
    } catch (err) {
      // Revert on failure, to the entry captured before the write
      setRepertoireMap((prev) => withRepertoireEntry(prev, songId, cycle.entry));
      setError(err instanceof Error ? err.message : "Failed to update status");
    }
  };

  const handleRename = async () => {
    const trimmed = renameDraft(panel).trim();
    if (!trimmed) {
      dispatch({ type: "close" });
      return;
    }
    setError(null);
    try {
      await updatePlaylist(playlistId, { name: trimmed });
      setPlaylist((prev) => (prev ? { ...prev, name: trimmed } : prev));
      dispatch({ type: "close" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename");
    }
  };

  // The two tag editing sites, on one controller each: the playlist's own bar
  // and every song row of the list. Both write optimistically — the list is
  // applied before the Server Action is awaited — and report a rejection
  // through the error banner without reverting, exactly as before RH-69.
  const playlistTagEditor = useTagEditor({
    readTags: () => (playlist ? (playlist.tags ?? []) : null),
    applyTags: (_playlistId, tags) =>
      setPlaylist((prev) => (prev ? { ...prev, tags } : prev)),
    saveTags: async (_playlistId, tags) => {
      await updatePlaylist(playlistId, { tags });
    },
    onError: setError,
    addFailureMessage: "Failed to update tags",
    removeFailureMessage: "Failed to update tags",
  });

  const songTagEditor = useTagEditor({
    readTags: (songId) => repertoireMap.get(songId)?.tags ?? null,
    applyTags: (songId, tags) =>
      setRepertoireMap((prev) => {
        const entry = prev.get(songId);
        return entry
          ? withRepertoireEntry(prev, songId, { ...entry, tags })
          : prev;
      }),
    saveTags: async (songId, tags) => {
      // Unreachable without an entry: `readTags` reports `null` for that song.
      const entry = repertoireMap.get(songId);
      if (entry) await updateSongTags(entry.id, tags);
    },
    onError: setError,
    addFailureMessage: "Failed to add tag",
    removeFailureMessage: "Failed to remove tag",
  });

  const handleDelete = async () => {
    setError(null);
    try {
      await deletePlaylist(playlistId);
      router.replace("/playlists");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-sm text-gray-400">
        <Spinner />
        Loading...
      </div>
    );
  }

  if (!playlist) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header: back, cover, title or rename input, actions and Spotify */}
      <PlaylistDetailHeader
        playlist={playlist}
        panel={panel}
        dispatch={dispatch}
        syncing={sync.syncing}
        onRename={handleRename}
        onDelete={handleDelete}
        onSync={sync.pull}
      />

      {/* Playlist tags — the bar owns the ownership gate */}
      <PlaylistTagBar
        playlist={playlist}
        currentUserId={currentUserId}
        editor={playlistTagEditor}
      />

      {/* Playlist level summary */}
      <PlaylistSummary songs={songs} repertoireMap={repertoireMap} />

      {/* Error */}
      {error && (
        <div className="shrink-0 flex items-center justify-between px-4 py-2 bg-red-50 border-b border-red-100">
          <p className="text-xs text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs text-red-400 hover:text-red-600 ml-3 focus:outline-none"
          >
            ✕
          </button>
        </div>
      )}

      {/* Song search filter within playlist */}
      {songs.length > 0 && (
        <div className="px-4 md:px-6 pt-3 pb-2">
          <div className="relative">
            <input
              type="text"
              value={songFilterQuery}
              onChange={(e) => setSongFilterQuery(e.target.value)}
              placeholder="Filter playlist by title or artist..."
              className="w-full pl-9 pr-8 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
            <svg
              className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            {songFilterQuery && (
              <button
                type="button"
                onClick={() => setSongFilterQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-bold"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tag filter */}
      <TagFilterBar
        tags={allTags}
        activeTag={activeTagFilter}
        onChange={setActiveTagFilter}
      />

      {/* Song list */}
      <PlaylistSongList
        songs={songs}
        filteredSongs={filteredSongs}
        repertoireMap={repertoireMap}
        playlistId={playlist.id}
        bandId={bandId}
        activeTagFilter={activeTagFilter}
        songFilterQuery={songFilterQuery}
        tagEditor={songTagEditor}
        onStatusCycle={handleStatusCycle}
        onRemoveSong={handleRemoveSong}
      />

      {/* Add-song search panel (toggled by the + button in the header) */}
      {panel.kind === "picker" && <SongPicker picker={picker} />}
    </div>
  );
}
