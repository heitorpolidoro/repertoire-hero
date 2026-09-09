"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { applyPlaylistOverlay } from "@/lib/playlistList";
import { PlaylistGroupList } from "@/components/playlists/PlaylistGroupList";
import { CreatePlaylistModal } from "@/components/playlists/CreatePlaylistModal";
import type { Playlist } from "@/types/database";

/**
 * The Server Actions this island calls. Injected by `src/app/playlists/page.tsx`
 * rather than imported, so `src/components` never points back into `src/app` (F21).
 */
export interface PlaylistsViewActions {
  createPlaylist(data: { name: string; description?: string }): Promise<Playlist>;
  updatePlaylist(id: string, data: { name?: string }): Promise<void>;
  deletePlaylist(id: string): Promise<void>;
}

interface PlaylistsViewProps {
  /** Read on the server by `getUserPlaylists(userId)`; this island never fetches. */
  playlists: Playlist[];
  /** A server-side read failure, surfaced in the same banner as a mutation failure. */
  initialError: string | null;
  /** Resolved on the server by `hasSpotifyConnection(userId)` — never `null`. */
  spotifyConnected: boolean;
  actions: PlaylistsViewActions;
}

export function PlaylistsView({
  playlists,
  initialError,
  spotifyConnected,
  actions,
}: PlaylistsViewProps) {
  const router = useRouter();
  const [pageError, setPageError] = useState<string | null>(initialError);
  const [showCreateModal, setShowCreateModal] = useState(false);
  // The props are the source of truth: copying the list into state would freeze
  // it, because a useState initialiser is ignored on re-render and a
  // router.refresh() would then never be visible. These two hold only the
  // in-flight local edits, applied on top of the props at render time.
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [renames, setRenames] = useState<Record<string, string>>({});

  const visiblePlaylists = applyPlaylistOverlay(playlists, { removedIds, renames });

  const handleDelete = async (id: string) => {
    setRemovedIds((prev) => [...prev, id]);
    try {
      await actions.deletePlaylist(id);
      router.refresh();
    } catch (err) {
      setRemovedIds((prev) => prev.filter((removed) => removed !== id));
      setPageError(
        err instanceof Error ? err.message : "Failed to delete playlist",
      );
    }
  };

  const handleRename = async (id: string, name: string) => {
    setRenames((prev) => ({ ...prev, [id]: name }));
    try {
      await actions.updatePlaylist(id, { name });
      router.refresh();
    } catch (err) {
      setRenames((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setPageError(
        err instanceof Error ? err.message : "Failed to rename playlist",
      );
    }
  };

  const handleCreatePlaylist = async (name: string) => {
    await actions.createPlaylist({ name });
    router.refresh();
  };

  const handleImported = async () => {
    router.refresh();
  };

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-4 md:px-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-gray-900">Playlists</h1>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="shrink-0 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
        >
          + New Playlist
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

        <PlaylistGroupList
          playlists={visiblePlaylists}
          spotifyConnected={spotifyConnected}
          onOpen={(id) => router.push(`/playlists/${id}`)}
          onDelete={(id) => handleDelete(id).catch(console.error)}
          onRename={(id, name) => handleRename(id, name).catch(console.error)}
        />
      </section>

      {/* Create / Import modal */}
      {showCreateModal && (
        <CreatePlaylistModal
          spotifyConnected={spotifyConnected}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreatePlaylist}
          onImported={handleImported}
        />
      )}
    </div>
  );
}
