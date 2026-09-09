"use client";

import Link from "next/link";
import { useState } from "react";
import {
  SpotifyImportListItem,
  type PendingImport,
} from "@/components/playlists/SpotifyImportListItem";
import type { SpotifyPlaylist } from "@/types/database";

interface SpotifyImportPanelProps {
  playlists: SpotifyPlaylist[];
  /** The list request issued by the tab button is still in flight. */
  loading: boolean;
  /**
   * The list route answered `{ connected: false }` (or failed). The tab itself
   * is enabled from a server-side row check, so the two can disagree for a user
   * whose refresh token was revoked — the panel is where that is explained.
   */
  connected: boolean;
  /** The active band context, the destination of the import. */
  bandId: string | null;
  onClose: () => void;
  onImported: () => Promise<void>;
}

export const SpotifyImportPanel = ({
  playlists,
  loading,
  connected,
  bandId,
  onClose,
  onImported,
}: SpotifyImportPanelProps) => {
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

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

  if (loading) {
    return (
      <p className="text-sm text-gray-500 text-center py-6" aria-live="polite">
        Loading Spotify playlists...
      </p>
    );
  }

  if (!connected) {
    return (
      <p className="text-sm text-gray-500 text-center py-6">
        Connect your Spotify account in{" "}
        <Link
          href="/profile"
          className="text-emerald-600 hover:underline focus:outline-none focus:underline"
          onClick={onClose}
        >
          Profile & Settings
        </Link>{" "}
        to import playlists.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2" role="list">
      {playlists.length === 0 && (
        <li className="text-sm text-gray-400 text-center py-6">
          No Spotify playlists found.
        </li>
      )}
      {playlists.map((sp) => (
        <SpotifyImportListItem
          key={sp.id}
          sp={sp}
          pendingImport={pendingImport}
          importingId={importingId}
          error={importError}
          onSelect={() => setPendingImport({ playlist: sp, syncWithSpotify: false })}
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
  );
};
