"use client";

import Image from "next/image";
import type { SpotifyPlaylist } from "@/types/database";

export interface PendingImport {
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

export const SpotifyImportListItem = ({
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
