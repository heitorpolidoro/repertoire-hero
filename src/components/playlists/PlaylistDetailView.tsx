"use client";

import { useRouter } from "next/navigation";
import { PlaylistDetailHeader } from "@/components/playlists/PlaylistDetailHeader";
import { PlaylistSongList } from "@/components/playlists/PlaylistSongList";
import { PlaylistSummary } from "@/components/playlists/PlaylistSummary";
import { PlaylistTagBar } from "@/components/playlists/PlaylistTagBar";
import { SongPicker } from "@/components/playlists/SongPicker";
import { TagFilterBar } from "@/components/playlists/TagFilterBar";
import {
  usePlaylistDetail,
  type PlaylistDetailActions,
} from "@/hooks/usePlaylistDetail";
import type { SongPickerActions } from "@/hooks/useSongPicker";
import type { Playlist, Repertoire } from "@/types/database";

export interface PlaylistDetailViewProps {
  /** Read on the server by `getPlaylistWithSongs(id, userId)`; never fetched here. */
  playlist: Playlist;
  /** The playlist owner's repertoire, read on the server under `playlist.band_id`. */
  repertoire: Repertoire[];
  /** Resolved from the session on the server — the tag bar's ownership gate (F13). */
  currentUserId: string | null;
  actions: PlaylistDetailActions;
  pickerActions: SongPickerActions;
}

/**
 * RH-71 — the one `"use client"` island of `/playlists/[id]`, and the
 * composition root of everything RH-67..RH-70 extracted.
 *
 * It owns the router and nothing else: the controller hook holds the state and
 * the commands, and the two navigations it needs arrive there as `onRefresh`
 * and `onDeleted`. There is no mount effect and no loading branch — the server
 * ships finished markup, and the streamed fallback while it is produced is
 * `src/app/loading.tsx`, the same one `/bands` and `/playlists` show.
 */
export function PlaylistDetailView({
  playlist,
  repertoire,
  currentUserId,
  actions,
  pickerActions,
}: PlaylistDetailViewProps) {
  const router = useRouter();
  const detail = usePlaylistDetail({
    playlist,
    repertoire,
    actions,
    pickerActions,
    onRefresh: () => router.refresh(),
    onDeleted: () => router.replace("/playlists"),
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header: back, cover, title or rename input, actions and Spotify */}
      <PlaylistDetailHeader
        playlist={detail.playlist}
        panel={detail.panel}
        dispatch={detail.dispatch}
        syncing={detail.sync.syncing}
        onRename={detail.rename}
        onDelete={detail.remove}
        onSync={detail.sync.pull}
      />

      {/* Playlist tags — the bar owns the ownership gate */}
      <PlaylistTagBar
        playlist={detail.playlist}
        currentUserId={currentUserId}
        editor={detail.playlistTagEditor}
      />

      {/* Playlist level summary */}
      <PlaylistSummary songs={detail.songs} repertoireMap={detail.repertoireMap} />

      {/* Error */}
      {detail.error && (
        <div className="shrink-0 flex items-center justify-between px-4 py-2 bg-red-50 border-b border-red-100">
          <p className="text-xs text-red-600">{detail.error}</p>
          <button
            type="button"
            onClick={detail.dismissError}
            className="text-xs text-red-400 hover:text-red-600 ml-3 focus:outline-none"
          >
            ✕
          </button>
        </div>
      )}

      {/* Song search filter within playlist */}
      {detail.songs.length > 0 && (
        <div className="px-4 md:px-6 pt-3 pb-2">
          <div className="relative">
            <input
              type="text"
              value={detail.songFilterQuery}
              onChange={(e) => detail.changeSongFilterQuery(e.target.value)}
              placeholder="Filter playlist by title or artist..."
              className="w-full pl-9 pr-8 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
            <svg
              className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            {detail.songFilterQuery && (
              <button
                type="button"
                onClick={() => detail.changeSongFilterQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-bold"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tag filter */}
      <TagFilterBar
        tags={detail.allTags}
        activeTag={detail.activeTagFilter}
        onChange={detail.changeTagFilter}
      />

      {/* Song list */}
      <PlaylistSongList
        songs={detail.songs}
        filteredSongs={detail.filteredSongs}
        repertoireMap={detail.repertoireMap}
        playlistId={detail.playlist.id}
        bandId={playlist.band_id}
        activeTagFilter={detail.activeTagFilter}
        songFilterQuery={detail.songFilterQuery}
        tagEditor={detail.songTagEditor}
        onStatusCycle={detail.cycleStatus}
        onRemoveSong={detail.removeSong}
      />

      {/* Add-song search panel (toggled by the + button in the header) */}
      {detail.panel.kind === "picker" && <SongPicker picker={detail.picker} />}
    </div>
  );
}
