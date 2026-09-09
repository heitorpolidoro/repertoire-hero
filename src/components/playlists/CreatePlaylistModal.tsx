"use client";

import { useEffect, useRef, useState } from "react";
// The only island that reads the band context: it is the destination of a
// Spotify import and nothing else on this route depends on it (RH-63).
import { useBandContextStore } from "@/store/bandContextStore";
import {
  CreatePlaylistTabs,
  type CreatePlaylistTab,
} from "@/components/playlists/CreatePlaylistTabs";
import { SpotifyImportPanel } from "@/components/playlists/SpotifyImportPanel";
import type { SpotifyPlaylist } from "@/types/database";

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
// Create Playlist Modal (New playlist + From Spotify tabs)
// ---------------------------------------------------------------------------

interface CreatePlaylistModalProps {
  /** Resolved on the server by `hasSpotifyConnection(userId)` — never `null`. */
  spotifyConnected: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onImported: () => Promise<void>;
}

/**
 * The one island that reads the band context. It is mounted only after a click
 * on `+ New Playlist`, never during hydration, so no server-rendered markup
 * depends on the localStorage-backed store and there is no mismatch to guard.
 * The context has exactly one destination: the `band_id` of a Spotify import.
 */
export const CreatePlaylistModal = ({
  spotifyConnected,
  onClose,
  onCreate,
  onImported,
}: CreatePlaylistModalProps) => {
  const bandId = useBandContextStore((s) => s.bandId());
  const [activeTab, setActiveTab] = useState<CreatePlaylistTab>("new");
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Spotify list state. Loaded from the tab button's handler, never on mount.
  const [spotifyPlaylists, setSpotifyPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [spotifyLoading, setSpotifyLoading] = useState(false);
  const [spotifyLoadFailed, setSpotifyLoadFailed] = useState(false);
  const hasLoadedSpotify = useRef(false);

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

  const loadSpotifyPlaylists = async () => {
    if (hasLoadedSpotify.current) return;
    hasLoadedSpotify.current = true;
    setSpotifyLoading(true);
    try {
      const res = await fetch("/api/spotify/playlists");
      const body = (await res.json()) as SpotifyPlaylist[] | { connected: false };
      if (!Array.isArray(body) && body.connected === false) {
        setSpotifyLoadFailed(true);
      } else {
        setSpotifyPlaylists(body as SpotifyPlaylist[]);
      }
    } catch {
      // The tab is enabled from a cheap server-side row check, so a token that
      // no longer refreshes lands here: show the "connect your account" copy
      // rather than an error the user cannot act on differently.
      setSpotifyLoadFailed(true);
    } finally {
      setSpotifyLoading(false);
    }
  };

  const handleOpenSpotifyTab = () => {
    setActiveTab("spotify");
    loadSpotifyPlaylists().catch(console.error);
  };

  const handleCreate = async () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      await onCreate(name);
      onClose();
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create playlist",
      );
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="New Playlist"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">New Playlist</h2>
          <ModalCloseButton onClose={onClose} />
        </div>

        {/* Tabs */}
        <CreatePlaylistTabs
          activeTab={activeTab}
          canShowSpotifyTab={spotifyConnected}
          onSelectNew={() => setActiveTab("new")}
          onSelectSpotify={handleOpenSpotifyTab}
        />

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {activeTab === "new" ? (
            <div className="flex flex-col gap-3">
              <label
                htmlFor="modal-playlist-name"
                className="text-sm font-medium text-gray-700"
              >
                Playlist name
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
                placeholder="e.g. Gig setlist"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {createError && (
                <p className="text-xs text-red-500">{createError}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <SpotifyImportPanel
                playlists={spotifyPlaylists}
                loading={spotifyLoading}
                connected={!spotifyLoadFailed}
                bandId={bandId}
                onClose={onClose}
                onImported={onImported}
              />
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
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleCreate().catch(console.error)}
              disabled={isCreating || !newPlaylistName.trim()}
              className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isCreating ? "Creating..." : "Create"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
