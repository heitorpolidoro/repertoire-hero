"use client";

import Link from "next/link";
import { PlaylistSongIdentity } from "@/components/playlists/PlaylistSongIdentity";
import { TagEditRow } from "@/components/playlists/TagEditRow";
import type { TagEditorController } from "@/hooks/useTagEditor";
import { formatPlaylistDuration } from "@/lib/playlistList";
import { STATUS_CONFIG } from "@/lib/statusConfig";
import type { PlaylistSong, Repertoire } from "@/types/database";

/**
 * What the row can ask the page to do. The page still owns `handleRemoveSong`
 * and `handleStatusCycle`, so the row reaches them by injection (F21) and keeps
 * the `.catch(console.error)` at each call site — a failure surfaces through
 * the page's error banner, never as an unhandled rejection. RH-69 replaced the
 * seven tag props with the one controller below, which the page shares between
 * every row and the playlist's own tag bar.
 */
export interface PlaylistSongHandlers {
  onStatusCycle: (songId: string) => Promise<void>;
  onRemoveSong: (songId: string) => Promise<void>;
  tagEditor: TagEditorController;
}

export interface PlaylistSongRowProps extends PlaylistSongHandlers {
  playlistSong: PlaylistSong;
  /** The owner's repertoire entry for this song, when they have one. */
  entry?: Repertoire;
  playlistId: string;
  /** The band being browsed, or `null` in personal context. */
  bandId: string | null;
}

/**
 * One song of `/playlists/[id]`: identity (linked to Fast View when the owner
 * has a repertoire entry), duration, mastery status, the remove button and the
 * per-song tag row. Moved out of the page by RH-68 with its markup unchanged.
 */
export function PlaylistSongRow({
  playlistSong: ps,
  entry,
  playlistId,
  bandId,
  tagEditor,
  onStatusCycle,
  onRemoveSong,
}: PlaylistSongRowProps) {
  const cfg = STATUS_CONFIG[entry?.status ?? "unknown"];

  return (
    <li className="rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-sm hover:border-emerald-200 hover:shadow transition-all group">
      <div className="flex items-center gap-3">
        {entry ? (
          <Link
            href={`/songs/${entry.id}/fast-view?returnTo=/playlists/${playlistId}${bandId ? `&bandId=${bandId}` : ''}`}
            className="flex-1 flex items-center gap-3 min-w-0"
          >
            <PlaylistSongIdentity song={ps.song} linked />
          </Link>
        ) : (
          <PlaylistSongIdentity song={ps.song} linked={false} />
        )}
        {ps.song?.duration_seconds != null && (
          <span className="text-xs text-gray-400 shrink-0 tabular-nums">
            {formatPlaylistDuration(ps.song.duration_seconds)}
          </span>
        )}
        {/* Status badge — read-only in band mode (computed by trigger), cycles in personal mode */}
        {bandId ? (
          <span
            title="Band status is computed from all members"
            className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium border border-current opacity-75 cursor-default ${cfg.bgColor} ${cfg.textColor}`}
          >
            {cfg.label}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              onStatusCycle(ps.song_id).catch(console.error);
            }}
            aria-label={`Status: ${cfg.label}. Click to advance.`}
            className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium border border-current ${cfg.bgColor} ${cfg.textColor}`}
          >
            {cfg.label}
          </button>
        )}
        {/* Remove */}
        <button
          type="button"
          onClick={() => {
            onRemoveSong(ps.song_id).catch(console.error);
          }}
          aria-label={`Remove ${ps.song?.title ?? "song"} from playlist`}
          className="shrink-0 p-1 rounded text-gray-300 hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-red-400 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Tags row — the same markup the playlist's own tag bar renders */}
      <TagEditRow
        subject={ps.song_id}
        tags={entry?.tags ?? []}
        editor={tagEditor}
        addLabel="Add tag"
        className="flex flex-wrap items-center gap-1.5 mt-2 ml-[52px]"
      />
    </li>
  );
}
