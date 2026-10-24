"use client";

import Link from "next/link";
import { PlaylistSongIdentity } from "@/components/playlists/PlaylistSongIdentity";
import { PractiseButton } from "@/components/playlists/PractiseButton";
import { TagEditRow } from "@/components/playlists/TagEditRow";
import type { TagEditorController } from "@/hooks/useTagEditor";
import { StatusNotes } from "@/components/ui/StatusNotes";
import { formatPlaylistDuration } from "@/lib/playlistList";
import type { PlaylistSong, Repertoire, SongStatus } from "@/types/database";

/**
 * What the row can ask the page to do. The page still owns `handleRemoveSong`
 * and the status write, so the row reaches them by injection (F21) and keeps
 * the `.catch(console.error)` at each call site — a failure surfaces through
 * the page's error banner, never as an unhandled rejection. RH-69 replaced the
 * seven tag props with the one controller below, which the page shares between
 * every row and the playlist's own tag bar.
 */
export interface PlaylistSongHandlers {
  /**
   * RH-102: the tap names the status it wants, up or down. RH-125: the subject
   * is the entry's `version_id`, which is what the repertoire map is keyed by.
   */
  onStatusChange: (versionId: string, status: SongStatus) => Promise<void>;
  onRemoveSong: (versionId: string) => Promise<void>;
  /** RH-158: writes the date; resolves `false` when it failed (the page shows why). */
  onPractise: (versionId: string) => Promise<boolean>;
  /** RH-158: the level chosen after the tap — status only, never the date. */
  onPractiseStatus: (versionId: string, status: SongStatus) => Promise<void>;
  tagEditor: TagEditorController;
}

export interface PlaylistSongRowProps extends PlaylistSongHandlers {
  playlistSong: PlaylistSong;
  /**
   * The owner's repertoire entry for this version, when they have one.
   *
   * Still optional, and no longer gates the Fast View link (RH-132) — only the
   * mastery status and the tags it carries.
   */
  entry?: Repertoire;
  /** The band being browsed, or `null` in personal context. */
  bandId: string | null;
  /**
   * Called as the row is opened, before the `<Link>` navigation proceeds. The
   * list uses it to write the tab's song queue, because a row knows only its
   * own song and the setlist is the whole playlist (RH-133).
   */
  onOpenFastView: () => void;
}

/**
 * One song of `/playlists/[id]`: identity (always linked to Fast View),
 * duration, mastery status, the remove button and the per-song tag row. Moved
 * out of the page by RH-68 with its markup unchanged.
 *
 * RH-133 shortened the href: the deleted playlist return parameter it used to
 * carry is gone, because the origin Back goes to is recorded in the tab's song
 * queue instead — which the list writes through `onOpenFastView` as this row is
 * opened. `?bandId=` stays, and is still the only owner the destination reads.
 *
 * RH-132 made the link unconditional. Fast View is addressed by
 * `song_versions.id` now and the owner comes from `?bandId=`, so a row the
 * owner holds no repertoire entry for opens at version defaults, read-only —
 * it is no longer a dead identity line. The `entry` prop stays: `StatusNotes`
 * and the tag row still read it, and its absence is still "not in this
 * repertoire", which they render as `unknown` and no tags.
 *
 * RH-183 — the width budget. At a 375px phone the row's content box is 317px
 * (375 − the list's `px-4` − the row's border and `px-3`). The fixed controls
 * take ~309px of it: duration ~28, `StatusNotes` ~139, "Practised" ~70, remove
 * 24, plus four 12px gaps — which left the title 0px once RH-158 added
 * "Practised". So below `sm` the line wraps: line 1 is the Fast View link,
 * the duration and the remove button; line 2 is the controls wrapper (status
 * notes + "Practised"), full width and indented to the text column (the same
 * 52px the tag row uses), and itself wrapping, so the revealed level control
 * drops onto its own line instead of overflowing. At `sm` and wider the row is
 * the single line it always was, in the same order. Every control is rendered
 * once — `order-last` moves the wrapper, nothing is duplicated and hidden — so
 * each accessible name still resolves to one element per row.
 */
export function PlaylistSongRow({
  playlistSong: ps,
  entry,
  bandId,
  tagEditor,
  onStatusChange,
  onRemoveSong,
  onPractise,
  onPractiseStatus,
  onOpenFastView,
}: PlaylistSongRowProps) {

  return (
    <li className="rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-sm hover:border-emerald-200 hover:shadow transition-all group">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:flex-nowrap">
        <Link
          href={`/songs/${ps.version_id}/fast-view${bandId ? `?bandId=${bandId}` : ''}`}
          onClick={onOpenFastView}
          className="flex-1 flex items-center gap-3 min-w-0"
        >
          <PlaylistSongIdentity song={ps.song} label={ps.label} linked />
        </Link>
        {ps.song?.duration_seconds != null && (
          <span className="text-xs text-gray-400 shrink-0 tabular-nums">
            {formatPlaylistDuration(ps.song.duration_seconds)}
          </span>
        )}
        {/* RH-183: the controls wrapper — a second, indented, wrapping line
            below `sm` (after the remove button, by `order-last`), an inline
            part of the single line at `sm` and wider. */}
        <div className="order-last basis-full flex flex-wrap items-center gap-x-3 gap-y-1 pl-[52px] sm:order-none sm:basis-auto sm:shrink-0 sm:flex-nowrap sm:pl-0">
          {/* RH-102: the four notes and the stage name, replacing the pill badge.
              The predicate is the one this call site already had — read-only on a
              band playlist, writable on a personal one. Making a band row
              writable here stays RH-71's named follow-up; this task changes what
              the control is, not who may write it. */}
          <StatusNotes
            status={entry?.status ?? "unknown"}
            readOnly={Boolean(bandId)}
            onChange={(next) => {
              onStatusChange(ps.version_id, next).catch(console.error);
            }}
          />
          <PractiseButton
            title={ps.song?.title ?? "song"}
            status={entry?.status ?? "unknown"}
            readOnly={Boolean(bandId)}
            onPractise={() => onPractise(ps.version_id)}
            onLevel={(next) => {
              onPractiseStatus(ps.version_id, next).catch(console.error);
            }}
          />
        </div>
        {/* Remove */}
        <button
          type="button"
          onClick={() => {
            onRemoveSong(ps.version_id).catch(console.error);
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
        subject={ps.version_id}
        tags={entry?.tags ?? []}
        editor={tagEditor}
        addLabel="Add tag"
        className="flex flex-wrap items-center gap-1.5 mt-2 ml-[52px]"
      />
    </li>
  );
}
