"use client";

import type { RefObject } from "react";
import {
  PlaylistSongRow,
  type PlaylistSongHandlers,
} from "@/components/playlists/PlaylistSongRow";
import { sortPlaylistSongs } from "@/lib/playlistDetail";
import type { PlaylistSong, Repertoire } from "@/types/database";

export interface PlaylistSongListProps extends PlaylistSongHandlers {
  /** Every song of the playlist — what decides the "no songs yet" state. */
  songs: PlaylistSong[];
  /** The songs left after the page's tag and text filters. */
  filteredSongs: PlaylistSong[];
  repertoireMap: Map<string, Repertoire>;
  playlistId: string;
  bandId: string | null;
  /** Only used to word the no-match message; the filtering happens on the page. */
  activeTagFilter: string | null;
  songFilterQuery: string;
  addingTagForSong: string | null;
  newTagInput: string;
  tagInputRef: RefObject<HTMLInputElement | null>;
}

/**
 * The `<section aria-label="Songs in this playlist">` of `/playlists/[id]` and
 * its three states: no songs at all, no song matching the active filter, or one
 * `PlaylistSongRow` per filtered song in playlist order. It holds no filtering
 * decision of its own — the page hands it both lists.
 */
export function PlaylistSongList({
  songs,
  filteredSongs,
  repertoireMap,
  playlistId,
  bandId,
  activeTagFilter,
  songFilterQuery,
  addingTagForSong,
  ...rowProps
}: PlaylistSongListProps) {
  return (
    <section
      className="flex-1 overflow-y-auto px-4 py-3 md:px-6 min-h-0"
      aria-label="Songs in this playlist"
    >
      {songs.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-12">
          No songs yet. Use the + button in the header to search and add songs.
        </p>
      ) : filteredSongs.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-12">
          {activeTagFilter
            ? `No songs tagged #${activeTagFilter}.`
            : `No songs matching "${songFilterQuery}".`}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sortPlaylistSongs(filteredSongs).map((ps) => (
            <PlaylistSongRow
              key={ps.id}
              {...rowProps}
              playlistSong={ps}
              entry={repertoireMap.get(ps.song_id)}
              playlistId={playlistId}
              bandId={bandId}
              isAddingTag={addingTagForSong === ps.song_id}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
