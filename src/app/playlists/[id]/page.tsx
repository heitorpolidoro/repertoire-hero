"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { PlaylistSongList } from "@/components/playlists/PlaylistSongList";
import { PlaylistSummary } from "@/components/playlists/PlaylistSummary";
import { PlaylistTagBar } from "@/components/playlists/PlaylistTagBar";
import { SongPicker } from "@/components/playlists/SongPicker";
import { SongPickerToggle } from "@/components/playlists/SongPickerToggle";
import { TagFilterBar } from "@/components/playlists/TagFilterBar";
import { Spinner } from "@/components/ui/Spinner";
import { useSongPicker } from "@/hooks/useSongPicker";
import { useTagEditor } from "@/hooks/useTagEditor";
import {
  collectPlaylistTags,
  cycleSongStatus,
  filterPlaylistSongs,
  withRepertoireEntry,
} from "@/lib/playlistDetail";
import { authClient } from "@/lib/auth-client";
import { getRepertoireAction } from "@/app/actions/repertoire";
import { useBandContextStore } from "@/store/bandContextStore";
import type { Playlist, PlaylistSong, Repertoire } from "@/types/database";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const timeAgo = (isoString: string): string => {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${Math.floor(diffHrs / 24)}d ago`;
};

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
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [songFilterQuery, setSongFilterQuery] = useState("");

  // Add-song search panel — everything but this flag lives in the controller
  const [showSearch, setShowSearch] = useState(false);

  // Focus ref — used instead of autoFocus to preserve accessibility. The two
  // tag inputs have their own, inside the tag editing controller.
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) editInputRef.current?.focus();
  }, [editing]);

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

  const autoPushIfNeeded = useCallback(async () => {
    if (!playlist?.sync_with_spotify || !playlist?.spotify_playlist_id) return;
    const res = await fetch(`/api/spotify/playlists/${playlistId}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction: "push" }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Auto-sync to Spotify failed");
    }
  }, [playlist?.sync_with_spotify, playlist?.spotify_playlist_id, playlistId]);

  // The add-song panel: query, debounce, dual-source search and the two adds
  const picker = useSongPicker({
    playlistId,
    actions: SONG_PICKER_ACTIONS,
    repertoire: repertoireMap,
    songs,
    onSongsChanged: setSongs,
    afterAdd: autoPushIfNeeded,
  });

  const handleRemoveSong = async (songId: string) => {
    setError(null);
    try {
      await removeSongFromPlaylist(playlistId, songId);
      setSongs((prev) => prev.filter((ps) => ps.song_id !== songId));
      await autoPushIfNeeded();
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

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(`/api/spotify/playlists/${playlistId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction: "pull" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Sync failed");
      }
      await refreshPlaylist();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleRename = async () => {
    const trimmed = editName.trim();
    if (!trimmed) {
      setEditing(false);
      return;
    }
    setError(null);
    try {
      await updatePlaylist(playlistId, { name: trimmed });
      setPlaylist((prev) => (prev ? { ...prev, name: trimmed } : prev));
      setEditing(false);
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
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 md:px-6 shrink-0">
        <div className="flex items-center gap-3">
          {/* Back */}
          <Link
            href="/playlists"
            aria-label="Back to playlists"
            className="p-1.5 rounded text-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 shrink-0"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
                clipRule="evenodd"
              />
            </svg>
          </Link>

          {/* Cover */}
          {playlist.cover_url && (
            <Image
              src={playlist.cover_url}
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 rounded object-cover shrink-0"
              unoptimized
            />
          )}

          {/* Name / edit input */}
          {editing ? (
            <div className="flex-1 flex items-center gap-2">
              <input
                ref={editInputRef}
                type="text"
                value={editName}
                onChange={(ev) => setEditName(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") handleRename().catch(console.error);
                  if (ev.key === "Escape") setEditing(false);
                }}
                className="flex-1 rounded border border-emerald-300 px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                aria-label="Playlist name"
              />
              <button
                type="button"
                onClick={() => {
                  handleRename().catch(console.error);
                }}
                className="text-xs text-emerald-600 font-medium hover:text-emerald-800 focus:outline-none focus:underline"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus:underline"
              >
                Cancel
              </button>
            </div>
          ) : (
            <h1 className="flex-1 text-lg font-bold text-gray-900 truncate">
              {playlist.name}
            </h1>
          )}

          {/* Actions */}
          {!editing && (
            <div className="flex items-center gap-0.5 shrink-0">
              {/* Add songs */}
              <SongPickerToggle
                open={showSearch}
                onToggle={() => setShowSearch((prev) => !prev)}
              />

              <button
                type="button"
                onClick={() => {
                  setEditName(playlist.name);
                  setEditing(true);
                }}
                aria-label="Rename playlist"
                className="p-1.5 rounded text-gray-400 hover:text-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              </button>

              {confirmDelete ? (
                <span className="flex items-center gap-1 text-xs px-1">
                  <span className="text-gray-600">Sure?</span>
                  <button
                    type="button"
                    onClick={() => {
                      handleDelete().catch(console.error);
                    }}
                    className="text-red-500 font-medium hover:text-red-700 focus:outline-none focus:underline"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="text-gray-500 hover:text-gray-700 focus:outline-none focus:underline"
                  >
                    No
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Delete playlist"
                  className="p-1.5 rounded text-gray-400 hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Spotify strip */}
        {playlist.spotify_playlist_id && (
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50">
            <span className="text-xs text-green-700 flex items-center gap-1.5">
              <span aria-hidden="true">🔄</span>
              {playlist.sync_with_spotify
                ? "Auto-sync on"
                : "Synced with Spotify"}
              {playlist.last_synced_at && (
                <span className="text-green-600">
                  &middot; {timeAgo(playlist.last_synced_at)}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                handleSync().catch(console.error);
              }}
              disabled={syncing}
              aria-label="Sync with Spotify"
              className="flex items-center gap-1.5 text-xs text-green-700 border border-green-300 rounded-md px-2.5 py-1 hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-green-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {syncing ? <Spinner /> : <span aria-hidden="true">🔄</span>}
              Sync
            </button>
          </div>
        )}
      </header>

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
      {showSearch && <SongPicker picker={picker} />}
    </div>
  );
}
