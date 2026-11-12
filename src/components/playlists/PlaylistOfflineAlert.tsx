"use client";

import type { OfflinePlaylistController } from "@/hooks/useOfflinePlaylist";

export interface PlaylistOfflineAlertProps {
  /** The page's one offline controller (RH-193), owned by `PlaylistDetailView`. */
  controller: OfflinePlaylistController;
  /**
   * True while the device has no network (RH-99): "Try again" crosses the
   * network, so it is disabled. Supplied by the route's single
   * `useOfflineStatus()` caller.
   */
  offline?: boolean;
}

/**
 * The playlist's inline offline alert — never `alert()` or `confirm()`.
 * Rendered only while the controller holds an error, in the slot the RH-79
 * full-width offline block used to occupy (RH-201 moved the actions into the
 * header's "More actions" menu). A download failure offers "Try again", which
 * fetches only the songs still missing; a removal failure (one song, or the
 * whole copy) does not, because retrying a local delete is not what the
 * message asks for (RH-193).
 */
export function PlaylistOfflineAlert({ controller: offline, offline: isOffline = false }: PlaylistOfflineAlertProps) {
  if (!offline.error) return null;
  return (
    <div className="px-4 md:px-6 py-3 border-b border-gray-100">
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-3"
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
    </div>
  );
}
