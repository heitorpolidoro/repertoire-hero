"use client";

import { PlaylistReorderControls } from "@/components/playlists/PlaylistReorderControls";
import { PlaylistSongIdentity } from "@/components/playlists/PlaylistSongIdentity";
import type { PlaylistReorderHandleProps } from "@/hooks/usePlaylistReorderDrag";
import { logger } from "@/lib/logger";
import type { PlaylistSong } from "@/types/database";

export interface PlaylistSongReorderRowProps {
  playlistSong: PlaylistSong;
  /** True for the top row of the list — its *up* button is disabled. */
  first: boolean;
  /** True for the bottom row. */
  last: boolean;
  /** True while this row is the one being dragged: it lifts and follows. */
  dragging: boolean;
  /** How far the pointer has travelled since `pointerdown`, in px. */
  offset: number;
  /** The drag measures this row's midpoint off the node handed back here. */
  registerRow: (node: HTMLLIElement | null) => void;
  /** Bound on the handle only — see `usePlaylistReorderDrag`. */
  handleProps: PlaylistReorderHandleProps;
  /** The one-place move; the list binds the controller's `moveSong`. */
  onMove: (versionId: string, direction: "up" | "down") => Promise<void>;
}

/**
 * RH-103 — one song while `/playlists/[id]` is in reorder mode: the grip
 * handle, the identity block and the up/down pair, and nothing else.
 *
 * At a 390px viewport the row's content box is 334px, and after RH-102 the
 * resting row already spends 264px of it on the cover, the duration, the
 * four-note control, the remove button and its gaps — 82px for title and
 * artist. A 44px handle beside all of that would leave 26px, which is not
 * shippable. So what yields while you reorder is everything the row is not
 * doing while you reorder it: the duration, the status control, the remove
 * button and the tag row are not rendered here, and title and artist get
 * 126px — more than they have the rest of the time. Nothing yields
 * permanently; `PlaylistSongRow` is untouched and comes straight back.
 *
 * Hiding the status control also removes the only chance of a tap meant for a
 * note landing on a drag.
 *
 * A separate component rather than a branch inside `PlaylistSongRow` so neither
 * file carries the other's concern; the identity block is shared, so jscpd sees
 * no clone.
 */
export function PlaylistSongReorderRow({
  playlistSong: ps,
  first,
  last,
  dragging,
  offset,
  registerRow,
  handleProps,
  onMove,
}: PlaylistSongReorderRowProps) {
  const title = ps.song?.title ?? "song";

  return (
    <li
      ref={registerRow}
      data-dragging={dragging ? "true" : undefined}
      // `pan-y`, like the scroll container: the browser decides by where the
      // finger landed, and everything except the handle below is a scroll.
      style={{
        touchAction: "pan-y",
        transform: dragging ? `translateY(${offset}px)` : undefined,
      }}
      className={`relative flex select-none items-center gap-2 rounded-lg border bg-white pr-1 ${
        dragging
          ? "z-10 border-emerald-300 shadow-lg"
          : "border-gray-100 shadow-sm"
      }`}
    >
      {/* The handle, and the only element that swallows the touch gesture. */}
      <button
        type="button"
        data-reorder-handle="true"
        aria-label={`Drag ${title} to reorder`}
        style={{ touchAction: "none" }}
        className="flex h-14 w-11 shrink-0 cursor-grab items-center justify-center rounded-l-lg text-gray-300 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 active:cursor-grabbing"
        {...handleProps}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M7 4a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0 6a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0 6a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm9-12a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0 6a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0 6a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
        </svg>
      </button>

      <PlaylistSongIdentity song={ps.song} label={ps.label} linked={false} />

      <PlaylistReorderControls
        title={title}
        first={first}
        last={last}
        onMove={(direction) => {
          // The controller owns the failure: it rolls the order back and fills
          // the error banner, so nothing is left here but the rejection a
          // caller must not drop.
          onMove(ps.version_id, direction).catch((cause: unknown) =>
            logger.error("Playlist reorder move failed", cause),
          );
        }}
      />
    </li>
  );
}
