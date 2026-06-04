"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useBandContextStore } from "@/store/bandContextStore";
import {
  getUserPlaylistsAction as getUserPlaylists,
  createPlaylistAction as createPlaylist,
  deletePlaylistAction as deletePlaylist,
  updatePlaylistAction as updatePlaylist,
} from "@/app/actions/playlists";
import type { Playlist, SpotifyPlaylist } from "@/types/database";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatDuration = (totalSeconds: number): string => {
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${mins}:${String(secs).padStart(2, "0")}`;
};

// ---------------------------------------------------------------------------
// Shared modal close button
// ---------------------------------------------------------------------------

const ModalCloseButton = ({ onClose }: { onClose: () => void }) => (
  <button
    type="button"
    onClick={onClose}
    aria-label="Close modal"
    className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded"
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
        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  </button>
);

// ---------------------------------------------------------------------------
// Spotify import list item
// ---------------------------------------------------------------------------

interface PendingImport {
  playlist: SpotifyPlaylist;
  syncWithSpotify: boolean;
}

interface SpotifyImportListItemProps {
  sp: SpotifyPlaylist;
  pendingImport: PendingImport | null;
  importingId: string | null;
  error: string | null;
  onSelect: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onSyncToggle: (checked: boolean) => void;
}

const SpotifyImportListItem = ({
  sp,
  pendingImport,
  importingId,
  error,
  onSelect,
  onConfirm,
  onCancel,
  onSyncToggle,
}: SpotifyImportListItemProps) => {
  const isPending = pendingImport?.playlist.id === sp.id;
  if (isPending) {
    return (
      <li>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 flex flex-col gap-3">
          <p className="text-sm font-medium text-gray-800">
            Import &ldquo;{sp.name}&rdquo;?
          </p>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={pendingImport?.syncWithSpotify ?? false}
              onChange={(ev) => onSyncToggle(ev.target.checked)}
              className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
            />
            Keep synced with Spotify
          </label>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={importingId === sp.id}
              className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {importingId === sp.id ? "Importing..." : "Import"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </li>
    );
  }
  return (
    <li>
      <div className="flex items-center gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-sm">
        {sp.cover_url ? (
          <Image
            src={sp.cover_url}
            alt={`${sp.name} cover`}
            width={40}
            height={40}
            className="h-10 w-10 rounded object-cover shrink-0"
            unoptimized
          />
        ) : (
          <div
            className="h-10 w-10 rounded bg-emerald-100 shrink-0 flex items-center justify-center text-lg"
            aria-hidden="true"
          >
            🎵
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {sp.name}
          </p>
          <p className="text-xs text-gray-500">{sp.total_tracks} tracks</p>
        </div>
        <button
          type="button"
          onClick={onSelect}
          className="shrink-0 px-3 py-1 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
        >
          Import
        </button>
      </div>
    </li>
  );
};

// ---------------------------------------------------------------------------
// Create Playlist Modal (Nova Playlist + Importar do Spotify tabs)
// ---------------------------------------------------------------------------

type CreatePlaylistTab = "new" | "spotify";

interface CreatePlaylistModalProps {
  spotifyConnected: boolean | null;
  spotifyPlaylists: SpotifyPlaylist[];
  bandId: string | null;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onImported: () => Promise<void>;
}

const CreatePlaylistModal = ({
  spotifyConnected,
  spotifyPlaylists,
  bandId,
  onClose,
  onCreate,
  onImported,
}: CreatePlaylistModalProps) => {
  const [activeTab, setActiveTab] = useState<CreatePlaylistTab>("new");
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Spotify import state
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === "new") nameInputRef.current?.focus();
  }, [activeTab]);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleCreate = async () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      await onCreate(name);
      onClose();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create playlist");
    } finally {
      setIsCreating(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingImport) return;
    setImportingId(pendingImport.playlist.id);
    setImportError(null);
    try {
      const res = await fetch(
        `/api/spotify/playlists/${pendingImport.playlist.id}/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sync_with_spotify: pendingImport.syncWithSpotify,
            band_id: bandId ?? undefined,
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Import failed (${res.status})`);
      }
      await onImported();
      onClose();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Unexpected error");
      setImportingId(null);
    }
  };

  const canShowSpotifyTab = spotifyConnected === true;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Nova Playlist"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Nova Playlist</h2>
          <ModalCloseButton onClose={onClose} />
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          <button
            type="button"
            onClick={() => setActiveTab("new")}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-500 ${
              activeTab === "new"
                ? "text-emerald-700 border-b-2 border-emerald-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Nova playlist
          </button>
          <button
            type="button"
            onClick={() => {
              if (canShowSpotifyTab) setActiveTab("spotify");
            }}
            disabled={!canShowSpotifyTab}
            title={!canShowSpotifyTab ? "Conecte sua conta do Spotify nas Configurações" : undefined}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-500 ${
              activeTab === "spotify"
                ? "text-emerald-700 border-b-2 border-emerald-600"
                : canShowSpotifyTab
                  ? "text-gray-500 hover:text-gray-700"
                  : "text-gray-300 cursor-not-allowed"
            }`}
          >
            Do Spotify
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {activeTab === "new" ? (
            <div className="flex flex-col gap-3">
              <label
                htmlFor="modal-playlist-name"
                className="text-sm font-medium text-gray-700"
              >
                Nome da playlist
              </label>
              <input
                ref={nameInputRef}
                id="modal-playlist-name"
                type="text"
                value={newPlaylistName}
                onChange={(ev) => setNewPlaylistName(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") handleCreate().catch(console.error);
                }}
                placeholder="Ex: Setlist do show"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {createError && (
                <p className="text-xs text-red-500">{createError}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {!canShowSpotifyTab ? (
                <p className="text-sm text-gray-500 text-center py-6">
                  Conecte sua conta do Spotify nas{" "}
                  <Link
                    href="/profile"
                    className="text-emerald-600 hover:underline focus:outline-none focus:underline"
                    onClick={onClose}
                  >
                    Configurações
                  </Link>{" "}
                  para importar playlists.
                </p>
              ) : (
                <ul className="flex flex-col gap-2" role="list">
                  {spotifyPlaylists.length === 0 && (
                    <li className="text-sm text-gray-400 text-center py-6">
                      Nenhuma playlist do Spotify encontrada.
                    </li>
                  )}
                  {spotifyPlaylists.map((sp) => (
                    <SpotifyImportListItem
                      key={sp.id}
                      sp={sp}
                      pendingImport={pendingImport}
                      importingId={importingId}
                      error={importError}
                      onSelect={() =>
                        setPendingImport({ playlist: sp, syncWithSpotify: false })
                      }
                      onConfirm={() => handleConfirmImport().catch(console.error)}
                      onCancel={() => setPendingImport(null)}
                      onSyncToggle={(checked) =>
                        setPendingImport((prev) =>
                          prev ? { ...prev, syncWithSpotify: checked } : prev,
                        )
                      }
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Footer (only for "new" tab) */}
        {activeTab === "new" && (
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-600 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => handleCreate().catch(console.error)}
              disabled={isCreating || !newPlaylistName.trim()}
              className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isCreating ? "Criando..." : "Criar"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Playlist card
// ---------------------------------------------------------------------------

interface PlaylistNameEditorProps {
  editName: string;
  inputRef: { current: HTMLInputElement | null };
  onChange: (val: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

const PlaylistNameEditor = ({
  editName,
  inputRef,
  onChange,
  onSubmit,
  onCancel,
}: PlaylistNameEditorProps) => (
  <div
    className="flex items-center gap-2"
    onClick={(ev) => ev.stopPropagation()}
  >
    <input
      ref={inputRef}
      type="text"
      value={editName}
      onChange={(ev) => onChange(ev.target.value)}
      onKeyDown={(ev) => {
        if (ev.key === "Enter") onSubmit();
        if (ev.key === "Escape") onCancel();
      }}
      className="flex-1 rounded border border-emerald-300 px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
    />
    <button
      type="button"
      onClick={onSubmit}
      className="text-xs text-emerald-600 font-medium hover:text-emerald-800"
    >
      Save
    </button>
    <button
      type="button"
      onClick={onCancel}
      className="text-xs text-gray-500 hover:text-gray-700"
    >
      Cancel
    </button>
  </div>
);

interface PlaylistCardProps {
  playlist: Playlist;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onClick: () => void;
}

const PlaylistCard = ({
  playlist,
  onDelete,
  onRename,
  onClick,
}: PlaylistCardProps) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(playlist.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) renameInputRef.current?.focus();
  }, [editing]);

  const handleRenameSubmit = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== playlist.name) onRename(playlist.id, trimmed);
    setEditing(false);
  };

  const songCount = Array.isArray(playlist.songs)
    ? playlist.songs.length
    : null;
  const totalSeconds = Array.isArray(playlist.songs)
    ? playlist.songs.reduce(
        (sum: number, ps: { song?: { duration_seconds?: number | null } }) =>
          sum + (ps.song?.duration_seconds ?? 0),
        0,
      )
    : 0;
  const totalDuration = totalSeconds > 0 ? formatDuration(totalSeconds) : null;

  return (
    <li
      className="rounded-lg border border-gray-100 bg-white shadow-sm px-4 py-3 flex items-center gap-3 cursor-pointer hover:border-emerald-200 hover:shadow-md transition-all"
      onClick={(ev) => {
        if ((ev.target as HTMLElement).closest("button, input")) return;
        onClick();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") onClick();
      }}
      aria-label={`Open ${playlist.name}`}
    >
      {/* Cover */}
      {playlist.cover_url ? (
        <Image
          src={playlist.cover_url}
          alt=""
          width={48}
          height={48}
          className="h-12 w-12 rounded object-cover shrink-0"
          unoptimized
        />
      ) : (
        <div
          className="h-12 w-12 rounded bg-emerald-100 shrink-0 flex items-center justify-center text-xl"
          aria-hidden="true"
        >
          🎵
        </div>
      )}

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <PlaylistNameEditor
            editName={editName}
            inputRef={renameInputRef}
            onChange={setEditName}
            onSubmit={handleRenameSubmit}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <p className="text-sm font-semibold text-gray-900 truncate">
              {playlist.name}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              {songCount !== null && (
                <span className="text-xs text-gray-400">
                  {songCount} {songCount === 1 ? "song" : "songs"}
                </span>
              )}
              {totalDuration && (
                <span className="text-xs text-gray-400 tabular-nums">
                  {totalDuration}
                </span>
              )}
              {playlist.spotify_playlist_id && (
                <span className="text-xs text-green-600 flex items-center gap-0.5">
                  <span aria-hidden="true">🔄</span>
                  {playlist.sync_with_spotify ? "Auto-sync" : "Synced"}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Action icons */}
      {!editing && (
        <div className="shrink-0 flex items-center gap-0.5">
          <button
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              setEditName(playlist.name);
              setEditing(true);
            }}
            aria-label={`Rename ${playlist.name}`}
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
            <span
              className="flex items-center gap-1 text-xs px-1"
              onClick={(ev) => ev.stopPropagation()}
            >
              <span className="text-gray-600">Sure?</span>
              <button
                type="button"
                onClick={() => {
                  onDelete(playlist.id);
                  setConfirmDelete(false);
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
              onClick={(ev) => {
                ev.stopPropagation();
                setConfirmDelete(true);
              }}
              aria-label={`Delete ${playlist.name}`}
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
    </li>
  );
};

// ---------------------------------------------------------------------------
// Playlist grouping
// ---------------------------------------------------------------------------

interface PlaylistGroup {
  type: "personal" | "band";
  bandId?: string;
  bandName?: string;
  playlists: Playlist[];
}

const buildPlaylistGroups = (playlists: Playlist[]): PlaylistGroup[] => {
  const personal = playlists.filter((pl) => pl.band_id === null);
  const bandMap = new Map<string, { name: string; playlists: Playlist[] }>();
  for (const pl of playlists) {
    if (pl.band_id === null) continue;
    const existing = bandMap.get(pl.band_id);
    if (existing) {
      existing.playlists.push(pl);
    } else {
      bandMap.set(pl.band_id, {
        name: pl.band?.name ?? pl.band_id,
        playlists: [pl],
      });
    }
  }
  const bandGroups: PlaylistGroup[] = [...bandMap.entries()]
    .sort(([, infoA], [, infoB]) => infoA.name.localeCompare(infoB.name))
    .map(([bandId, { name, playlists: bandPlaylists }]) => ({
      type: "band" as const,
      bandId,
      bandName: name,
      playlists: bandPlaylists,
    }));
  const groups: PlaylistGroup[] = [];
  if (personal.length > 0)
    groups.push({ type: "personal", playlists: personal });
  groups.push(...bandGroups);
  return groups;
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const PlaylistsPage = () => {
  const router = useRouter();
  const bandId = useBandContextStore((s) => s.bandId());
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [spotifyConnected, setSpotifyConnected] = useState<boolean | null>(null);
  const [spotifyPlaylists, setSpotifyPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const loadPlaylists = useCallback(async () => {
    try {
      const data = await getUserPlaylists();
      setPlaylists(data);
    } catch (err) {
      setPageError(
        err instanceof Error ? err.message : "Failed to load playlists",
      );
    }
  }, []);

  const loadSpotifyStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/spotify/playlists");
      const body = (await res.json()) as
        | SpotifyPlaylist[]
        | { connected: false };
      if (!Array.isArray(body) && body.connected === false) {
        setSpotifyConnected(false);
      } else {
        setSpotifyConnected(true);
        setSpotifyPlaylists(body as SpotifyPlaylist[]);
      }
    } catch {
      setSpotifyConnected(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPlaylists().catch(console.error);
    loadSpotifyStatus().catch(console.error);
  }, [loadPlaylists, loadSpotifyStatus]);

  const handleDelete = async (id: string) => {
    try {
      await deletePlaylist(id);
      setPlaylists((prev) => prev.filter((pl) => pl.id !== id));
    } catch (err) {
      setPageError(
        err instanceof Error ? err.message : "Failed to delete playlist",
      );
    }
  };

  const handleRename = async (id: string, name: string) => {
    setPlaylists((prev) =>
      prev.map((pl) => (pl.id === id ? { ...pl, name } : pl)),
    );
    try {
      await updatePlaylist(id, { name });
    } catch (err) {
      setPageError(
        err instanceof Error ? err.message : "Failed to rename playlist",
      );
      await loadPlaylists();
    }
  };

  const handleCreatePlaylist = async (name: string) => {
    await createPlaylist({ name });
    await loadPlaylists();
  };

  const handleImported = async () => {
    await loadPlaylists();
  };

  const groupedPlaylists = useMemo(
    () => buildPlaylistGroups(playlists),
    [playlists],
  );
  const personalGroup = groupedPlaylists.find((g) => g.type === "personal");
  const bandGroups = groupedPlaylists.filter((g) => g.type === "band");

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-4 md:px-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-gray-900">Playlists</h1>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="shrink-0 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
        >
          + Nova Playlist
        </button>
      </header>

      <section className="flex-1 overflow-y-auto px-4 py-4 md:px-6 flex flex-col gap-4">
        {/* Error banner */}
        {pageError && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between gap-3"
          >
            <p className="text-sm text-red-700">{pageError}</p>
            <button
              type="button"
              onClick={() => setPageError(null)}
              aria-label="Dismiss error"
              className="text-red-500 hover:text-red-700 text-xs shrink-0 focus:outline-none focus:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Playlist list grouped by band */}
        {playlists.length === 0 && spotifyConnected !== null ? (
          <div
            className="flex flex-col items-center justify-center h-40 text-center gap-2"
            aria-live="polite"
          >
            <p className="text-gray-500 font-medium">No playlists yet</p>
            <p className="text-sm text-gray-400">
              Create your first playlist with the &ldquo;+ Nova Playlist&rdquo;
              button
              {spotifyConnected && " or import one from Spotify"}.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Personal section */}
            <section aria-label="My playlists">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  My playlists
                </p>
              </div>
              {personalGroup ? (
                <ul className="flex flex-col gap-3" role="list">
                  {personalGroup.playlists.map((playlist) => (
                    <PlaylistCard
                      key={playlist.id}
                      playlist={playlist}
                      onClick={() => router.push(`/playlists/${playlist.id}`)}
                      onDelete={(id) => handleDelete(id).catch(console.error)}
                      onRename={(id, name) =>
                        handleRename(id, name).catch(console.error)
                      }
                    />
                  ))}
                </ul>
              ) : (
                playlists.length > 0 && (
                  <p className="text-sm text-gray-400 text-center py-4">
                    No personal playlists yet.
                  </p>
                )
              )}
            </section>

            {/* Band sections */}
            {bandGroups.map((group) => (
              <section
                key={group.bandId}
                aria-label={`Band: ${group.bandName}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Link
                    href={`/bands/${group.bandId}`}
                    className="flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-900 focus:outline-none focus:underline"
                  >
                    🎸 {group.bandName}
                  </Link>
                </div>
                <ul className="flex flex-col gap-3" role="list">
                  {group.playlists.map((playlist) => (
                    <PlaylistCard
                      key={playlist.id}
                      playlist={playlist}
                      onClick={() => router.push(`/playlists/${playlist.id}`)}
                      onDelete={(id) => handleDelete(id).catch(console.error)}
                      onRename={(id, name) =>
                        handleRename(id, name).catch(console.error)
                      }
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>

      {/* Create / Import modal */}
      {showCreateModal && (
        <CreatePlaylistModal
          spotifyConnected={spotifyConnected}
          spotifyPlaylists={spotifyPlaylists}
          bandId={bandId}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreatePlaylist}
          onImported={handleImported}
        />
      )}
    </div>
  );
};

export default PlaylistsPage;
