"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getPlaylistWithSongsAction as getPlaylistWithSongs,
  updatePlaylistAction as updatePlaylist,
  deletePlaylistAction as deletePlaylist,
  addSongToPlaylistAction as addSongToPlaylist,
  removeSongFromPlaylistAction as removeSongFromPlaylist,
} from "@/app/actions/playlists";
import {
  updateSongStatusAction as updateSongStatus,
  updateSongTagsAction as updateSongTags,
  searchGlobalSongsAction as searchGlobalSongs,
  addSongAction as addSongToRepertoire,
  createAndAddSongAction as createAndAddSong,
} from "@/app/actions/repertoire";
import { searchSpotify, type SpotifyTrack } from "@/lib/spotify";
import { STATUS_CONFIG, STATUS_ORDER, nextStatus } from "@/lib/statusConfig";
import { authClient } from "@/lib/auth-client";
import { getRepertoireAction } from "@/app/actions/repertoire";
import { useBandContextStore } from "@/store/bandContextStore";
import type {
  GlobalSong,
  Playlist,
  PlaylistSong,
  SongStatus,
  Repertoire,
} from "@/types/database";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0)
    return `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${mins}:${String(secs).padStart(2, "0")}`;
};

const timeAgo = (isoString: string): string => {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${Math.floor(diffHrs / 24)}d ago`;
};

const Spinner = () => (
  <svg
    className="animate-spin h-4 w-4 text-emerald-500"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8v8H4z"
    />
  </svg>
);

// ---------------------------------------------------------------------------
// Song result row — used in the add-song search panel
// ---------------------------------------------------------------------------

interface PickerRowProps {
  coverUrl?: string | null;
  title: string;
  artist: string;
  album?: string | null;
  adding: boolean;
  error?: string;
  onAdd: () => void;
}

const PickerRow = ({
  coverUrl,
  title,
  artist,
  album,
  adding,
  error,
  onAdd,
}: PickerRowProps) => (
  <li className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
    {coverUrl ? (
      <Image
        src={coverUrl}
        alt=""
        width={32}
        height={32}
        className="h-8 w-8 rounded object-cover shrink-0"
        unoptimized
      />
    ) : (
      <div
        className="h-8 w-8 rounded bg-emerald-100 shrink-0"
        aria-hidden="true"
      />
    )}
    <div className="flex-1 min-w-0">
      <p className="text-sm text-gray-900 truncate">{title}</p>
      <p className="text-xs text-gray-500 truncate">{artist}</p>
      {album && (
        <p className="text-xs text-gray-400 italic truncate">{album}</p>
      )}
    </div>
    <div className="shrink-0 flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={onAdd}
        disabled={adding}
        className="text-xs text-emerald-600 font-medium hover:text-emerald-800 focus:outline-none focus:underline disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {adding ? "Adding…" : "Add"}
      </button>
      {error && (
        <p className="text-xs text-red-500 text-right max-w-[120px]">{error}</p>
      )}
    </div>
  </li>
);

// ---------------------------------------------------------------------------
// Playlist mastery summary
// ---------------------------------------------------------------------------

const STATUS_SCORES: Record<SongStatus, number> = {
  unknown: 0,
  learning: 1,
  practicing: 2,
  polishing: 3,
  mastered: 4,
};

// Solid bar colors that match STATUS_CONFIG (Tailwind bg classes won't work inside
// inline-style width, so we use raw hex values for the stacked bar segments).
const STATUS_BAR_COLORS: Record<SongStatus, string> = {
  unknown: "#d1d5db", // gray-300
  learning: "#93c5fd", // blue-300
  practicing: "#fde047", // yellow-300
  polishing: "#fdba74", // orange-300
  mastered: "#86efac", // green-300
};

interface PlaylistSummaryProps {
  songs: PlaylistSong[];
  repertoireMap: Map<string, Repertoire>;
}

const PlaylistSummary = ({ songs, repertoireMap }: PlaylistSummaryProps) => {
  const { counts, totalSeconds } = useMemo(() => {
    const statusCounts: Record<SongStatus, number> = {
      unknown: 0,
      learning: 0,
      practicing: 0,
      polishing: 0,
      mastered: 0,
    };
    let totalSecs = 0;
    for (const ps of songs) {
      const songStatus = repertoireMap.get(ps.song_id)?.status ?? "unknown";
      statusCounts[songStatus]++;
      totalSecs += ps.song?.duration_seconds ?? 0;
    }
    return { counts: statusCounts, totalSeconds: totalSecs };
  }, [songs, repertoireMap]);

  const total = songs.length;
  if (total === 0) return null;

  const score = Math.round(
    (STATUS_ORDER.reduce((sum, st) => sum + STATUS_SCORES[st] * counts[st], 0) /
      (total * 4)) *
      100,
  );

  // Nearest status label for the score
  const scoreStatus =
    STATUS_ORDER[
      Math.min(
        Math.floor((score / 100) * (STATUS_ORDER.length - 1) + 0.5),
        STATUS_ORDER.length - 1,
      )
    ];
  const cfg = STATUS_CONFIG[scoreStatus];

  return (
    <div className="px-4 py-3 md:px-6 border-b border-gray-100 bg-gray-50">
      {/* Score + total duration */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500">
          Playlist level
          {totalSeconds > 0 && (
            <span className="ml-2 text-gray-400 font-normal">
              {formatDuration(totalSeconds)}
            </span>
          )}
        </span>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full border border-current ${cfg.bgColor} ${cfg.textColor}`}
        >
          {cfg.label} &middot; {score}%
        </span>
      </div>

      {/* Stacked distribution bar */}
      <div
        className="flex h-2 rounded-full overflow-hidden gap-px"
        aria-label="Status distribution"
      >
        {STATUS_ORDER.map((statusKey) => {
          const pct = (counts[statusKey] / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={statusKey}
              style={{
                width: `${pct}%`,
                backgroundColor: STATUS_BAR_COLORS[statusKey],
              }}
              title={`${STATUS_CONFIG[statusKey].label}: ${counts[statusKey]}`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {STATUS_ORDER.filter((statusKey) => counts[statusKey] > 0).map(
          (statusKey) => (
            <span
              key={statusKey}
              className="flex items-center gap-1 text-xs text-gray-500"
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: STATUS_BAR_COLORS[statusKey] }}
                aria-hidden="true"
              />
              {STATUS_CONFIG[statusKey].label} ({counts[statusKey]})
            </span>
          ),
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PlaylistDetailPage() {
  const params = useParams();
  const router = useRouter();
  const playlistId = params.id as string;
  const { data: session } = authClient.useSession();
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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [addingTagForSong, setAddingTagForSong] = useState<string | null>(null);
  const [newTagInput, setNewTagInput] = useState("");
  const [addingPlaylistTag, setAddingPlaylistTag] = useState(false);
  const [newPlaylistTagInput, setNewPlaylistTagInput] = useState("");

  // Add-song search panel
  const [showSearch, setShowSearch] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerCatalogResults, setPickerCatalogResults] = useState<
    GlobalSong[]
  >([]);
  const [pickerSpotifyResults, setPickerSpotifyResults] = useState<
    SpotifyTrack[]
  >([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerAddingId, setPickerAddingId] = useState<string | null>(null);
  const [pickerRowErrors, setPickerRowErrors] = useState<
    Record<string, string>
  >({});
  const pickerDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickerLatestQuery = useRef("");

  // Focus refs — used instead of autoFocus to preserve accessibility
  const editInputRef = useRef<HTMLInputElement>(null);
  const playlistTagInputRef = useRef<HTMLInputElement>(null);
  const songTagInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) editInputRef.current?.focus();
  }, [editing]);
  useEffect(() => {
    if (addingPlaylistTag) playlistTagInputRef.current?.focus();
  }, [addingPlaylistTag]);
  useEffect(() => {
    if (addingTagForSong) songTagInputRef.current?.focus();
  }, [addingTagForSong]);
  useEffect(() => {
    if (showSearch) searchInputRef.current?.focus();
  }, [showSearch]);

  const refreshPlaylist = useCallback(async () => {
    const data = await getPlaylistWithSongs(playlistId);
    if (!data) {
      router.replace("/playlists");
      return;
    }
    setPlaylist(data);
    setSongs(data.songs ?? []);
    setCurrentUserId(session?.user?.id ?? null);

    // Band or personal: the trigger keeps band status in sync,
    // so getRepertoireAction(bandId) reads the correct value directly.
    const rep = await getRepertoireAction(bandId);
    setRepertoireMap(new Map(rep.map((r: Repertoire) => [r.song_id, r])));
  }, [playlistId, router, session?.user?.id, bandId]);

  useEffect(() => {
    setLoading(true);
    refreshPlaylist()
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Failed to load playlist",
        ),
      )
      .finally(() => setLoading(false));
  }, [refreshPlaylist]);

  // Debounced picker search: catalog + Spotify in parallel
  const runPickerSearch = useCallback(async (query: string) => {
    pickerLatestQuery.current = query;
    if (query.trim().length < 2) {
      setPickerCatalogResults([]);
      setPickerSpotifyResults([]);
      setPickerLoading(false);
      return;
    }
    setPickerLoading(true);
    try {
      const [catalog, spotify] = await Promise.all([
        searchGlobalSongs(query).catch(() => [] as GlobalSong[]),
        searchSpotify(query).catch(() => [] as SpotifyTrack[]),
      ]);
      if (pickerLatestQuery.current !== query) return;
      setPickerCatalogResults(catalog);
      setPickerSpotifyResults(spotify);
    } finally {
      if (pickerLatestQuery.current === query) setPickerLoading(false);
    }
  }, []);

  useEffect(() => {
    if (pickerDebounce.current) clearTimeout(pickerDebounce.current);
    pickerDebounce.current = setTimeout(() => {
      runPickerSearch(pickerQuery).catch(console.error);
    }, 500);
    return () => {
      if (pickerDebounce.current) clearTimeout(pickerDebounce.current);
    };
  }, [pickerQuery, runPickerSearch]);

  const currentSongIds = useMemo(
    () => new Set(songs.map((ps) => ps.song_id)),
    [songs],
  );

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const ps of songs) {
      for (const tag of repertoireMap.get(ps.song_id)?.tags ?? []) set.add(tag);
    }
    return [...set].sort((tagA, tagB) => tagA.localeCompare(tagB));
  }, [songs, repertoireMap]);

  const filteredSongs = useMemo(
    () =>
      activeTagFilter
        ? songs.filter((ps) =>
            repertoireMap.get(ps.song_id)?.tags.includes(activeTagFilter),
          )
        : songs,
    [songs, repertoireMap, activeTagFilter],
  );

  // Picker results: hide songs already in the playlist; deduplicate Spotify vs catalog
  const pickerVisibleCatalog = useMemo(
    () => pickerCatalogResults.filter((song) => !currentSongIds.has(song.id)),
    [pickerCatalogResults, currentSongIds],
  );
  const pickerCatalogKeys = useMemo(
    () =>
      new Set(
        pickerVisibleCatalog.map(
          (song) => `${song.title.toLowerCase()}|${song.artist.toLowerCase()}`,
        ),
      ),
    [pickerVisibleCatalog],
  );
  const pickerVisibleSpotify = useMemo(
    () =>
      pickerSpotifyResults.filter((track) => {
        const key = `${track.title.toLowerCase()}|${track.artist.toLowerCase()}`;
        return !pickerCatalogKeys.has(key);
      }),
    [pickerSpotifyResults, pickerCatalogKeys],
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

  // Low-level: add an already-in-repertoire song to the playlist and refresh state
  const addSongIdToPlaylist = useCallback(
    async (songId: string) => {
      await addSongToPlaylist(playlistId, songId);
      const updated = await getPlaylistWithSongs(playlistId);
      setSongs(updated?.songs ?? []);
      await autoPushIfNeeded();
    },
    [playlistId, autoPushIfNeeded],
  );

  // Add a catalog song: ensure it's in the repertoire, then add to playlist
  const handlePickerAddCatalog = async (song: GlobalSong) => {
    setPickerAddingId(song.id);
    setPickerRowErrors((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([key]) => key !== song.id),
      ),
    );
    try {
      if (!repertoireMap.has(song.id)) {
        await addSongToRepertoire(song.id);
      }
      await addSongIdToPlaylist(song.id);
    } catch (err) {
      setPickerRowErrors((prev) => ({
        ...prev,
        [song.id]: err instanceof Error ? err.message : "Failed to add",
      }));
    } finally {
      setPickerAddingId(null);
    }
  };

  // Add a Spotify track: create global song + add to repertoire, then add to playlist
  const handlePickerAddSpotify = async (track: SpotifyTrack) => {
    setPickerAddingId(track.id);
    setPickerRowErrors((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([key]) => key !== track.id),
      ),
    );
    try {
      const resolveTrackId = async (): Promise<string> => {
        try {
          const entry = await createAndAddSong({
            title: track.title,
            artist: track.artist,
            album: track.album ?? undefined,
            cover_url: track.albumArt ?? undefined,
            links: [{ label: "Spotify", url: track.spotifyUrl }],
          });
          return entry.song_id;
        } catch (err) {
          // Song already in repertoire — find its id from the current map
          if (
            err instanceof Error &&
            err.message.includes("already in your repertoire")
          ) {
            const existing = [...repertoireMap.values()].find(
              (rep) =>
                rep.song?.title.toLowerCase() === track.title.toLowerCase() &&
                rep.song?.artist.toLowerCase() === track.artist.toLowerCase(),
            );
            if (!existing) throw err;
            return existing.song_id;
          }
          throw err;
        }
      };
      const songId = await resolveTrackId();
      await addSongIdToPlaylist(songId);
    } catch (err) {
      setPickerRowErrors((prev) => ({
        ...prev,
        [track.id]: err instanceof Error ? err.message : "Failed to add",
      }));
    } finally {
      setPickerAddingId(null);
    }
  };

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
    const entry = repertoireMap.get(songId);
    if (!entry) return;
    const newStatus = nextStatus(entry.status);
    // Optimistic update
    setRepertoireMap((prev) => {
      const updated = new Map(prev);
      updated.set(songId, { ...entry, status: newStatus });
      return updated;
    });
    try {
      await updateSongStatus(entry.id, newStatus);
    } catch (err) {
      // Revert on failure
      setRepertoireMap((prev) => {
        const reverted = new Map(prev);
        reverted.set(songId, entry);
        return reverted;
      });
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

  const handleTagsChange = async (tags: string[]) => {
    setPlaylist((prev) => (prev ? { ...prev, tags } : prev));
    try {
      await updatePlaylist(playlistId, { tags });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update tags");
    }
  };

  const handleAddPlaylistTag = async (raw: string) => {
    let tagValue = raw.trim().toLowerCase();
    while (tagValue.endsWith(",")) tagValue = tagValue.slice(0, -1);
    const tag = tagValue.trim();
    setAddingPlaylistTag(false);
    setNewPlaylistTagInput("");
    if (!tag) return;
    const current = playlist?.tags ?? [];
    if (current.includes(tag)) return;
    await handleTagsChange([...current, tag]);
  };

  const handleAddSongTag = async (songId: string, tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed) return;
    const entry = repertoireMap.get(songId);
    if (!entry) return;
    if (entry.tags.includes(trimmed)) {
      setAddingTagForSong(null);
      setNewTagInput("");
      return;
    }
    const newTags = [...entry.tags, trimmed];
    setRepertoireMap((prev) => {
      const next = new Map(prev);
      next.set(songId, { ...entry, tags: newTags });
      return next;
    });
    setAddingTagForSong(null);
    setNewTagInput("");
    try {
      await updateSongTags(entry.id, newTags);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add tag");
    }
  };

  const handleRemoveSongTag = async (songId: string, tag: string) => {
    const entry = repertoireMap.get(songId);
    if (!entry) return;
    const newTags = entry.tags.filter((existingTag) => existingTag !== tag);
    setRepertoireMap((prev) => {
      const updated = new Map(prev);
      updated.set(songId, { ...entry, tags: newTags });
      return updated;
    });
    try {
      await updateSongTags(entry.id, newTags);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove tag");
    }
  };

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
              <button
                type="button"
                onClick={() => setShowSearch((prev) => !prev)}
                aria-label="Add songs"
                aria-pressed={showSearch}
                className={`p-1.5 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${
                  showSearch
                    ? "text-emerald-600 bg-emerald-50"
                    : "text-gray-400 hover:text-emerald-600"
                }`}
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
                    d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>

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

      {/* Playlist tags */}
      {playlist &&
        (playlist.band_id !== null || playlist.user_id === currentUserId) && (
          <div className="px-4 py-2 md:px-6 border-b border-gray-100 bg-white flex flex-wrap items-center gap-1.5">
            {(playlist.tags ?? []).map((tag) => (
              <span
                key={tag}
                className="group flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => {
                    handleTagsChange(
                      (playlist.tags ?? []).filter(
                        (existingTag) => existingTag !== tag,
                      ),
                    ).catch(console.error);
                  }}
                  aria-label={`Remove tag ${tag}`}
                  className="opacity-0 group-hover:opacity-100 text-emerald-400 hover:text-emerald-700 transition-opacity leading-none"
                >
                  ×
                </button>
              </span>
            ))}
            {addingPlaylistTag ? (
              <input
                ref={playlistTagInputRef}
                type="text"
                value={newPlaylistTagInput}
                onChange={(ev) => setNewPlaylistTagInput(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter")
                    handleAddPlaylistTag(newPlaylistTagInput).catch(
                      console.error,
                    );
                  if (ev.key === "Escape") {
                    setAddingPlaylistTag(false);
                    setNewPlaylistTagInput("");
                  }
                }}
                onBlur={() => {
                  if (newPlaylistTagInput.trim())
                    handleAddPlaylistTag(newPlaylistTagInput).catch(
                      console.error,
                    );
                  else {
                    setAddingPlaylistTag(false);
                    setNewPlaylistTagInput("");
                  }
                }}
                placeholder="new tag"
                className="px-2 py-0.5 rounded-full text-xs border border-emerald-300 text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-24"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAddingPlaylistTag(true);
                  setNewPlaylistTagInput("");
                }}
                aria-label="Add tag to playlist"
                className="flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs text-gray-400 border border-dashed border-gray-300 hover:border-emerald-300 hover:text-emerald-600 transition-colors"
              >
                + tag
              </button>
            )}
          </div>
        )}

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

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div className="px-4 md:px-6 pb-2 flex flex-wrap gap-1.5">
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() =>
                setActiveTagFilter(activeTagFilter === tag ? null : tag)
              }
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                activeTagFilter === tag
                  ? "bg-emerald-600 text-white border-emerald-600"
                  : "bg-white text-emerald-700 border-emerald-200 hover:border-emerald-400"
              }`}
            >
              {tag}
            </button>
          ))}
          {activeTagFilter && (
            <button
              type="button"
              onClick={() => setActiveTagFilter(null)}
              className="px-2 py-0.5 rounded-full text-xs text-gray-400 hover:text-gray-600 border border-gray-200"
            >
              × clear
            </button>
          )}
        </div>
      )}

      {/* Song list */}
      <section
        className="flex-1 overflow-y-auto px-4 py-3 md:px-6 min-h-0"
        aria-label="Songs in this playlist"
      >
        {songs.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">
            No songs yet. Use the + button in the header to search and add
            songs.
          </p>
        ) : filteredSongs.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">
            No songs tagged{" "}
            <span className="font-medium">#{activeTagFilter}</span>.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {[...filteredSongs]
              .sort((songA, songB) => songA.position - songB.position)
              .map((ps) => {
                const entry = repertoireMap.get(ps.song_id);
                const status = entry?.status ?? "unknown";
                const tags = entry?.tags ?? [];
                const cfg = STATUS_CONFIG[status];
                const isAddingTag = addingTagForSong === ps.song_id;
                return (
                  <li
                    key={ps.id}
                    className="rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      {ps.song?.cover_url ? (
                        <Image
                          src={ps.song.cover_url}
                          alt=""
                          width={40}
                          height={40}
                          className="h-10 w-10 rounded object-cover shrink-0"
                          unoptimized
                        />
                      ) : (
                        <div
                          className="h-10 w-10 rounded bg-emerald-100 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {ps.song?.title ?? "—"}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {ps.song?.artist ?? "—"}
                        </p>
                        {ps.song?.album && (
                          <p className="text-xs text-gray-400 italic truncate">
                            {ps.song.album}
                          </p>
                        )}
                      </div>
                      {ps.song?.duration_seconds != null && (
                        <span className="text-xs text-gray-400 shrink-0 tabular-nums">
                          {formatDuration(ps.song.duration_seconds)}
                        </span>
                      )}
                      {/* Status badge */}
                      <button
                        type="button"
                        onClick={() => {
                          handleStatusCycle(ps.song_id).catch(console.error);
                        }}
                        aria-label={`Status: ${cfg.label}. Click to advance.`}
                        className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium border border-current ${cfg.bgColor} ${cfg.textColor}`}
                      >
                        {cfg.label}
                      </button>
                      {/* Remove */}
                      <button
                        type="button"
                        onClick={() => {
                          handleRemoveSong(ps.song_id).catch(console.error);
                        }}
                        aria-label={`Remove ${ps.song?.title ?? "song"} from playlist`}
                        className="shrink-0 p-1 rounded text-gray-300 hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-red-400 transition-colors"
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
                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    </div>

                    {/* Tags row */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2 ml-[52px]">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="group flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() => {
                              handleRemoveSongTag(ps.song_id, tag).catch(
                                console.error,
                              );
                            }}
                            aria-label={`Remove tag ${tag}`}
                            className="opacity-0 group-hover:opacity-100 text-emerald-400 hover:text-emerald-700 transition-opacity leading-none"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {isAddingTag ? (
                        <input
                          ref={songTagInputRef}
                          type="text"
                          value={newTagInput}
                          onChange={(ev) => setNewTagInput(ev.target.value)}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter")
                              handleAddSongTag(ps.song_id, newTagInput).catch(
                                console.error,
                              );
                            if (ev.key === "Escape") {
                              setAddingTagForSong(null);
                              setNewTagInput("");
                            }
                          }}
                          onBlur={() => {
                            if (newTagInput.trim())
                              handleAddSongTag(ps.song_id, newTagInput).catch(
                                console.error,
                              );
                            else {
                              setAddingTagForSong(null);
                              setNewTagInput("");
                            }
                          }}
                          placeholder="new tag"
                          className="px-2 py-0.5 rounded-full text-xs border border-emerald-300 text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-24"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setAddingTagForSong(ps.song_id);
                            setNewTagInput("");
                          }}
                          aria-label="Add tag"
                          className="flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs text-gray-400 border border-dashed border-gray-300 hover:border-emerald-300 hover:text-emerald-600 transition-colors"
                        >
                          + tag
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </section>

      {/* Add-song search panel (toggled by the + button in the header) */}
      {showSearch && (
        <div className="border-t border-gray-100 px-4 py-3 md:px-6 shrink-0 flex flex-col gap-2">
          <input
            ref={searchInputRef}
            type="search"
            value={pickerQuery}
            onChange={(ev) => setPickerQuery(ev.target.value)}
            placeholder="Search catalog and Spotify…"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <ul
            className="max-h-60 overflow-y-auto flex flex-col gap-0.5"
            aria-live="polite"
          >
            {pickerQuery.trim().length < 2 ? (
              <li className="text-xs text-gray-400 text-center py-3">
                Type to search…
              </li>
            ) : pickerLoading ? (
              <li
                className="flex items-center gap-2 px-2 py-2 text-sm text-gray-400"
                aria-busy="true"
              >
                <Spinner /> Searching…
              </li>
            ) : pickerVisibleCatalog.length === 0 &&
              pickerVisibleSpotify.length === 0 ? (
              <li className="text-xs text-gray-400 text-center py-3">
                No results
              </li>
            ) : (
              <>
                {pickerVisibleCatalog.map((song) => (
                  <PickerRow
                    key={song.id}
                    coverUrl={song.cover_url}
                    title={song.title}
                    artist={song.artist}
                    album={song.album}
                    adding={pickerAddingId === song.id}
                    error={pickerRowErrors[song.id]}
                    onAdd={() => {
                      handlePickerAddCatalog(song).catch(console.error);
                    }}
                  />
                ))}
                {pickerVisibleSpotify.map((track) => (
                  <PickerRow
                    key={track.id}
                    coverUrl={track.albumArt}
                    title={track.title}
                    artist={track.artist}
                    album={track.album}
                    adding={pickerAddingId === track.id}
                    error={pickerRowErrors[track.id]}
                    onAdd={() => {
                      handlePickerAddSpotify(track).catch(console.error);
                    }}
                  />
                ))}
              </>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
