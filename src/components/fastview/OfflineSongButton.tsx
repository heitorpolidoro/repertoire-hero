"use client";

import { useOfflineSong } from "@/hooks/useOfflineSong";
import type { OfflineCaptureActions } from "@/lib/offlineCapture";
import { formatOfflineBytes } from "@/lib/offlineFormat";
import type { OfflineStore } from "@/lib/offlineStore";

export interface OfflineSongButtonProps {
  versionId: string;
  /** The page's `?bandId=` owner context. */
  bandId: string | null;
  /** Required, never defaulted — injected by the page (F21). */
  actions: OfflineCaptureActions;
  /** Defaults to the real `OFFLINE_STORE`; a test passes its own. */
  store?: OfflineStore;
  /**
   * True while the device has no network (RH-99): download and refresh are
   * disabled, remove stays enabled because it is a purely local write. Supplied
   * by the Fast View page, the route's single `useOfflineStatus()` caller.
   */
  offline?: boolean;
}

/**
 * The single-song offline control on the Fast View page (RH-116).
 *
 * Same three states and visual language as the playlist's control (idle,
 * downloading `1 / 1`, downloaded with size, age, refresh and remove); a
 * failure is an inline alert and leaves the idle control in place, which is
 * true because the store rolled the download back. Application copy is inline
 * English (AGENTS.md F25).
 */
export function OfflineSongButton({
  versionId,
  bandId,
  actions,
  store,
  offline: isOffline = false,
}: OfflineSongButtonProps) {
  const song = useOfflineSong({ versionId, bandId, actions, store });

  return (
    <div className="mt-3">
      {song.status === "downloading" && (
        <button
          type="button"
          aria-busy="true"
          disabled
          className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3 text-emerald-800"
        >
          <span className="font-semibold">Downloading...</span>
          <span className="ml-auto text-sm tabular-nums" aria-live="polite">
            {song.progress.done} / {song.progress.total} songs
          </span>
        </button>
      )}

      {song.status === "downloaded" && (
        <div className="w-full rounded-xl border border-emerald-200 bg-white px-4 py-3 flex items-center gap-3">
          <span aria-hidden="true" className="text-emerald-600">
            ✓
          </span>
          <div>
            <p className="font-semibold text-gray-900">Available offline</p>
            <p className="text-xs text-gray-500">
              {song.summary ? formatOfflineBytes(song.summary.bytes) : "—"} &middot; downloaded{" "}
              {song.downloadedAgo ?? "unknown"}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              aria-label="Refresh offline copy"
              onClick={() => void song.download()}
              disabled={isOffline}
              className="rounded-md p-2 text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:text-gray-300 disabled:hover:bg-transparent"
            >
              <span aria-hidden="true">⟳</span>
            </button>
            <span className="h-4 w-px bg-gray-200" />
            <button
              type="button"
              aria-label="Remove offline copy"
              onClick={() => void song.remove()}
              className="rounded-md p-2 text-red-500 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <span aria-hidden="true">🗑</span>
            </button>
          </div>
        </div>
      )}

      {song.status === "idle" && (
        <>
          <button
            type="button"
            onClick={() => void song.download()}
            disabled={isOffline}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 flex items-center gap-3 hover:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:hover:border-gray-200"
          >
            <span aria-hidden="true" className="text-gray-400">
              ⤓
            </span>
            <span className="font-semibold text-gray-900">Available offline</span>
          </button>
          {isOffline && (
            <p className="mt-1 text-xs text-gray-500">Offline: connect to download.</p>
          )}
        </>
      )}

      {song.error && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start justify-between gap-3"
        >
          <p className="text-sm text-red-700">{song.error}</p>
          <button
            type="button"
            onClick={song.dismissError}
            aria-label="Dismiss offline download error"
            className="text-red-400 hover:text-red-600 text-xs focus:outline-none"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
