"use client";

import { Fragment, useRef } from "react";
import { PlaylistSongReorderRow } from "@/components/playlists/PlaylistSongReorderRow";
import {
  PlaylistSongRow,
  type PlaylistSongHandlers,
} from "@/components/playlists/PlaylistSongRow";
import { usePlaylistReorderDrag } from "@/hooks/usePlaylistReorderDrag";
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
  /**
   * RH-103 — true while the list is in reorder mode. The controller never
   * reports it while a filter is active, so a reorder row is always a row of
   * the whole playlist.
   */
  reordering: boolean;
  /** One place up or down; the controller short-circuits at the ends. */
  onMoveSong: (songId: string, direction: "up" | "down") => Promise<void>;
  /** The drag's commit, with the full permuted `playlist_songs.id` order. */
  onReorderSongs: (orderedIds: string[]) => Promise<void>;
}

/**
 * The `<section aria-label="Songs in this playlist">` of `/playlists/[id]` and
 * its three states: no songs at all, no song matching the active filter, or one
 * row per filtered song in playlist order. It holds no filtering decision of
 * its own — the page hands it both lists.
 *
 * RH-103 made it the gesture's host too: it owns the scroll container (whose
 * `touch-action` stays `pan-y`, so only a press on a row's handle drags),
 * chooses the resting row or the reorder row, hands the drag the nodes it
 * measures midpoints from and renders the insertion line. Every decision behind
 * that lives in `usePlaylistReorderDrag` and `@/lib/playlistReorderDrag`.
 */
export function PlaylistSongList({
  songs,
  filteredSongs,
  repertoireMap,
  playlistId,
  bandId,
  activeTagFilter,
  songFilterQuery,
  reordering,
  onMoveSong,
  onReorderSongs,
  ...rowProps
}: PlaylistSongListProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const ordered = sortPlaylistSongs(filteredSongs);
  const drag = usePlaylistReorderDrag({
    orderedIds: ordered.map((ps) => ps.id),
    onReorder: onReorderSongs,
    containerRef,
  });

  return (
    <section
      ref={containerRef}
      // The container keeps `pan-y` so a press anywhere but a handle scrolls.
      style={{ touchAction: "pan-y" }}
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
          {ordered.map((ps, index) =>
            reordering ? (
              <Fragment key={ps.id}>
                {drag.insertionIndex === index ? <ReorderInsertionLine /> : null}
                <PlaylistSongReorderRow
                  playlistSong={ps}
                  first={index === 0}
                  last={index === ordered.length - 1}
                  dragging={drag.draggingIndex === index}
                  offset={drag.offset}
                  registerRow={drag.registerRow(index)}
                  handleProps={drag.handleProps(index)}
                  onMove={onMoveSong}
                />
              </Fragment>
            ) : (
              <PlaylistSongRow
                key={ps.id}
                {...rowProps}
                playlistSong={ps}
                entry={repertoireMap.get(ps.song_id)}
                playlistId={playlistId}
                bandId={bandId}
              />
            ),
          )}
          {reordering && drag.insertionIndex === ordered.length ? (
            <ReorderInsertionLine />
          ) : null}
        </ul>
      )}
    </section>
  );
}

/**
 * The 2px line marking where the dragged row would land. An `<li>` rather than
 * a `<div>` because it is a child of the `<ul>`, and `role="presentation"` so
 * it is neither a list item to a screen reader nor a row to a `getAllByRole`.
 * The other rows deliberately do not move while a drag is in flight, so the
 * list never jumps under the finger — this line is the only feedback that does.
 */
function ReorderInsertionLine() {
  return (
    <li
      role="presentation"
      aria-hidden="true"
      data-testid="reorder-insertion-line"
      className="-my-1 h-0.5 rounded bg-emerald-500"
    />
  );
}
