"use client";

import { Spinner } from "@/components/ui/Spinner";
import { formatSyncedAgo } from "@/lib/playlistSync";
import type { Playlist } from "@/types/database";

export interface PlaylistSpotifyStripProps {
  /** The loaded playlist. An unlinked one renders nothing at all. */
  playlist: Playlist;
  /** True while a pull is in flight: the button disables and spins. */
  syncing: boolean;
  /** Pull from Spotify. Settles either way — failures reach the page banner. */
  onSync: () => Promise<void>;
}

/**
 * The green strip under the playlist title: whether the playlist auto-syncs,
 * how long ago it last did, and the button that pulls from Spotify now.
 *
 * It travels apart from `PlaylistDetailHeader` (RH-70) because three of its
 * four states — unlinked, auto-sync on versus linked only, never synced versus
 * synced — are decisions no header test would otherwise reach, and because it
 * gives the header 19 lines of headroom under the base budget. Same call
 * `PlaylistSongIdentity` (RH-68) and `TagEditRow` (RH-69) made.
 */
export function PlaylistSpotifyStrip({
  playlist,
  syncing,
  onSync,
}: PlaylistSpotifyStripProps) {
  if (!playlist.spotify_playlist_id) return null;

  return (
    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50">
      <span className="text-xs text-green-700 flex items-center gap-1.5">
        <span aria-hidden="true">🔄</span>
        {playlist.sync_with_spotify ? "Auto-sync on" : "Synced with Spotify"}
        {playlist.last_synced_at && (
          <span className="text-green-600">
            &middot; {formatSyncedAgo(playlist.last_synced_at)}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => {
          onSync().catch(console.error);
        }}
        disabled={syncing}
        aria-label="Sync with Spotify"
        className="flex items-center gap-1.5 text-xs text-green-700 border border-green-300 rounded-md px-2.5 py-1 hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-green-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {syncing ? <Spinner /> : <span aria-hidden="true">🔄</span>}
        Sync
      </button>
    </div>
  );
}
