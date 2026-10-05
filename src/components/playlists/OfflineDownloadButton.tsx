"use client";

import { formatOfflineBytes } from "@/lib/offlineFormat";
import {
  useOfflinePlaylist,
  type OfflineDownloadActions,
  type OfflinePlaylistController,
} from "@/hooks/useOfflinePlaylist";
import { type OfflineStore } from "@/lib/offlineStore";

export interface OfflineDownloadButtonProps {
  playlistId: string;
  playlistName: string;
  /** The playlist's owner context, carried into every read the download makes. */
  bandId: string | null;
  /** Required, never defaulted — injected by the page (F21). */
  actions: OfflineDownloadActions;
  /** Defaults to the real `OFFLINE_STORE`; a test passes its own. */
  store?: OfflineStore;
  /**
   * True while the device has no network (RH-99). A download crosses the
   * network and therefore cannot complete, so "Available offline" and "Refresh
   * offline copy" are *disabled* — offline is read-only by intent, and nothing
   * is queued for later. "Remove offline copy" stays enabled: it is a purely
   * local write that completes offline.
   *
   * Supplied by `PlaylistDetailView`, this route's single `useOfflineStatus()`
   * caller, so this component stays presentational.
   */
  offline?: boolean;
}

/** The busy state: a disabled control plus the x / y song counter. */
function DownloadingControl({ progress }: { progress: OfflinePlaylistController["progress"] }) {
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <>
      <button
        type="button"
        aria-busy="true"
        disabled
        className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3 text-emerald-800"
      >
        <span className="font-semibold">Downloading...</span>
        <span className="ml-auto text-sm tabular-nums" aria-live="polite">
          {progress.done} / {progress.total} songs
        </span>
      </button>
      <div className="mt-2 h-1.5 rounded-full bg-emerald-100 overflow-hidden">
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${percent}%` }} />
      </div>
    </>
  );
}

/** The stored state: what is kept, when it was taken, and the two affordances. */
function DownloadedControl({
  offline,
  isOffline,
}: {
  offline: OfflinePlaylistController;
  /** The device's network state, not the download's — see the prop doc. */
  isOffline: boolean;
}) {
  const summary = offline.summary;
  return (
    <div className="w-full rounded-xl border border-emerald-200 bg-white px-4 py-3 flex items-center gap-3">
      <span aria-hidden="true" className="text-emerald-600">
        ✓
      </span>
      <div>
        <p className="font-semibold text-gray-900">Available offline</p>
        <p className="text-xs text-gray-500">
          {summary ? formatOfflineBytes(summary.bytes) : "—"} &middot; downloaded{" "}
          {offline.downloadedAgo ?? "unknown"}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          aria-label="Refresh offline copy"
          onClick={() => void offline.download()}
          disabled={isOffline}
          className="rounded-md p-2 text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:text-gray-300 disabled:hover:bg-transparent"
        >
          <span aria-hidden="true">⟳</span>
        </button>
        <span className="h-4 w-px bg-gray-200" />
        <button
          type="button"
          aria-label="Remove offline copy"
          onClick={() => void offline.remove()}
          className="rounded-md p-2 text-red-500 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          <span aria-hidden="true">🗑</span>
        </button>
      </div>
    </div>
  );
}

/**
 * The per-playlist offline control (RH-79), rendered by the `/playlists/[id]`
 * island.
 *
 * Three states, each with a distinct accessible name: idle ("Available
 * offline"), in progress (a busy control carrying an `x / y` song counter) and
 * downloaded (size, date, refresh and remove). A failure renders as an inline
 * alert — never `alert()` or `confirm()` — and leaves the idle control in
 * place, which is true: the store rolled the whole download back.
 *
 * The design writes the label "Disponível offline"; it ships in English because
 * AGENTS.md (F25) scopes i18n to the landing page and writes application copy
 * inline.
 */
export function OfflineDownloadButton({
  playlistId,
  playlistName,
  bandId,
  actions,
  store,
  offline: isOffline = false,
}: OfflineDownloadButtonProps) {
  const offline = useOfflinePlaylist({ playlistId, playlistName, bandId, actions, store });

  return (
    <div className="px-4 md:px-6 py-3 border-b border-gray-100">
      {offline.status === "downloading" && <DownloadingControl progress={offline.progress} />}

      {offline.status === "downloaded" && (
        <DownloadedControl offline={offline} isOffline={isOffline} />
      )}

      {offline.status === "idle" && (
        <button
          type="button"
          onClick={() => void offline.download()}
          disabled={isOffline}
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 flex items-center gap-3 hover:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:hover:border-gray-200"
        >
          <span aria-hidden="true" className="text-gray-400">
            ⤓
          </span>
          <span className="font-semibold text-gray-900">Available offline</span>
        </button>
      )}

      {offline.error && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start justify-between gap-3"
        >
          <p className="text-sm text-red-700">{offline.error}</p>
          <button
            type="button"
            onClick={offline.dismissError}
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
