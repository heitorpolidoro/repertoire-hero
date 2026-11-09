"use client";

import { useId } from "react";
import { formatOfflineBytes } from "@/lib/offlineFormat";
import type { OfflinePlaylistController } from "@/hooks/useOfflinePlaylist";

export interface OfflineDownloadButtonProps {
  /**
   * The page's one offline controller (RH-193), owned by `PlaylistDetailView`
   * and shared with the song rows, so a row removal and this control's count
   * change in the same render.
   */
  controller: OfflinePlaylistController;
  /**
   * True while the device has no network (RH-99). A download crosses the
   * network and therefore cannot complete, so "Make available offline", "Try
   * again", "Download N missing songs" and "Refresh offline copy" are
   * *disabled* — offline is read-only by intent, and nothing is queued for
   * later. "Remove offline copy" stays enabled: it is a purely local write that
   * completes offline.
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

/** "Download 1 missing song" / "Download N missing songs" (RH-193). */
function missingLabel(missing: number): string {
  return `Download ${missing} missing song${missing === 1 ? "" : "s"}`;
}

/**
 * The stored state: how many of the live entries are kept, their size, when
 * the list was taken, the two affordances, and — when some live entry is not
 * on the device — the missing-only download (RH-193).
 */
function DownloadedControl({
  offline,
  isOffline,
}: {
  offline: OfflinePlaylistController;
  /** The device's network state, not the download's — see the prop doc. */
  isOffline: boolean;
}) {
  const missing = offline.total - offline.stored;
  return (
    <div className="w-full rounded-xl border border-emerald-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="text-emerald-600">
          ✓
        </span>
        <div>
          <p className="font-semibold text-gray-900">Available offline</p>
          <p className="text-xs text-gray-500">
            {offline.stored} of {offline.total} songs &middot; {formatOfflineBytes(offline.bytes)} &middot;
            downloaded {offline.downloadedAgo ?? "unknown"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Refresh offline copy"
            onClick={() => void offline.refresh()}
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
      {missing > 0 && (
        <button
          type="button"
          onClick={() => void offline.download()}
          disabled={isOffline}
          className="mt-2 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:bg-gray-200 disabled:text-gray-400 disabled:hover:bg-gray-200"
        >
          {missingLabel(missing)}
        </button>
      )}
    </div>
  );
}

/** The idle offline hint, shown under the control only while offline (RH-188). */
const OFFLINE_HINT = "Connect to the internet to download this playlist.";

/**
 * The idle state (RH-188): an explicit, filled emerald action, so it never
 * reads as the downloaded state's status text. Offline it is disabled and
 * described by a one-line hint rendered under it. RH-193: when some live entry
 * is already on the device (no list stored), a second line says how many.
 */
function IdleControl({
  offline,
  isOffline,
  hintId,
}: {
  offline: OfflinePlaylistController;
  isOffline: boolean;
  hintId: string;
}) {
  return (
    <>
      <button
        type="button"
        onClick={() => void offline.download()}
        disabled={isOffline}
        aria-describedby={isOffline ? hintId : undefined}
        className="w-full rounded-xl bg-emerald-600 px-4 py-3 flex items-center justify-center gap-2 font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:bg-gray-200 disabled:text-gray-400 disabled:hover:bg-gray-200"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
        Make available offline
      </button>
      {isOffline && (
        <p id={hintId} className="mt-2 text-xs text-gray-500">
          {OFFLINE_HINT}
        </p>
      )}
      {offline.stored > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          {offline.stored} of {offline.total} songs are already on this device.
        </p>
      )}
    </>
  );
}

/**
 * The inline alert — never `alert()` or `confirm()`. A download failure offers
 * "Try again", which fetches only the songs still missing; a removal failure
 * (one song, or the whole copy) does not, because retrying a local delete is
 * not what the message asks for (RH-193).
 */
function OfflineAlert({ offline, isOffline }: { offline: OfflinePlaylistController; isOffline: boolean }) {
  return (
    <div
      role="alert"
      className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-3"
    >
      <p className="flex-1 text-sm text-red-700">{offline.error}</p>
      {offline.errorRetryable && (
        <button
          type="button"
          onClick={() => void offline.download()}
          disabled={isOffline}
          className="rounded-md border border-red-300 px-2.5 py-1 text-sm font-semibold text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Try again
        </button>
      )}
      <button
        type="button"
        onClick={offline.dismissError}
        aria-label="Dismiss offline download error"
        className="text-red-400 hover:text-red-600 text-xs focus:outline-none"
      >
        ✕
      </button>
    </div>
  );
}

/**
 * The per-playlist offline control (RH-79), rendered by the `/playlists/[id]`
 * island.
 *
 * Three states, each with a distinct accessible name: idle ("Make available
 * offline", RH-188), in progress (a busy control carrying an `x / y` song
 * counter) and downloaded ("Available offline": `N of M songs`, size, date,
 * refresh and remove, plus "Download N missing songs" when the live list holds
 * songs the device does not — RH-193). "Refresh offline copy" refetches every
 * song (RH-192).
 *
 * Presentational since RH-193: the controller arrives as a prop, because the
 * song rows read the same one.
 *
 * The design writes the label "Disponível offline"; it ships in English because
 * AGENTS.md (F25) scopes i18n to the landing page and writes application copy
 * inline.
 */
export function OfflineDownloadButton({
  controller: offline,
  offline: isOffline = false,
}: OfflineDownloadButtonProps) {
  const hintId = useId();

  return (
    <div className="px-4 md:px-6 py-3 border-b border-gray-100">
      {offline.status === "downloading" && <DownloadingControl progress={offline.progress} />}

      {offline.status === "downloaded" && (
        <DownloadedControl offline={offline} isOffline={isOffline} />
      )}

      {offline.status === "idle" && (
        <IdleControl offline={offline} isOffline={isOffline} hintId={hintId} />
      )}

      {offline.error && <OfflineAlert offline={offline} isOffline={isOffline} />}
    </div>
  );
}
