"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useRef, useState, type Dispatch, type ReactNode } from "react";
import { PlaylistDeleteModal } from "@/components/playlists/PlaylistDeleteModal";
import { PlaylistHeaderMenu } from "@/components/playlists/PlaylistHeaderMenu";
import { PlaylistSpotifyStrip } from "@/components/playlists/PlaylistSpotifyStrip";
import { Spinner } from "@/components/ui/Spinner";
import {
  renameDraft,
  type PlaylistPanel,
  type PlaylistPanelAction,
} from "@/lib/playlistPanels";
import type { Playlist } from "@/types/database";

export interface PlaylistDetailHeaderProps {
  /** The loaded playlist: its name, cover and Spotify link. */
  playlist: Playlist;
  /** Which panel is open — at most one, by construction. */
  panel: PlaylistPanel;
  /** How the header opens, closes and types into a panel. */
  dispatch: Dispatch<PlaylistPanelAction>;
  /** True while a Spotify pull is in flight. */
  syncing: boolean;
  /** Commits the drafted name; the page binds the update it runs. */
  onRename: () => Promise<void>;
  /** Deletes the playlist; the page binds the write and the redirect. */
  onDelete: () => Promise<void>;
  /** Pulls from Spotify. */
  onSync: () => Promise<void>;
  /**
   * RH-103 — whether to offer the *Reorder* item at all. The island folds two
   * facts into it: the caller may reorder this playlist (personal, or band
   * admin), and no filter is narrowing the list. While a filter is active the
   * visible list is a subset, so "the row above" on screen is not the row above
   * in the playlist and the mode would lie.
   */
  canReorder: boolean;
  /** True while the list is in reorder mode; the top-level button reads *Done*. */
  reordering: boolean;
  /** Enters or leaves that mode. */
  onToggleReorder: () => void;
  /** RH-159 — opens the whole-playlist practice review; omit to hide the item. */
  onReviewPractice?: () => void;
  /** RH-172 — the "Start practice" button, mounted by the view; omit for an empty playlist. */
  startPractice?: ReactNode;
}

/**
 * RH-70 — the sticky header of `/playlists/[id]`: the back arrow, the cover,
 * the title or the inline rename input, the action group and the Spotify strip.
 *
 * RH-172: the action group is "Start practice" (when given), "Done" while
 * reordering and the three-dots menu that holds every secondary action. The
 * delete confirmation is a modal, so the header stays one row.
 *
 * It receives the panel state and its `dispatch` rather than a boolean and a
 * callback per panel, for the reason RH-69 handed a whole `TagEditorController`
 * to `TagEditRow`: unpacking the union at the page boundary would put
 * `panel.kind === …` back on the page, which is exactly what moving here
 * removed. The two Server Actions arrive already bound, as `onRename` and
 * `onDelete`, so the import-direction rule (F21) holds with no actions bundle.
 */
export function PlaylistDetailHeader({
  playlist,
  panel,
  dispatch,
  syncing,
  onRename,
  onDelete,
  onSync,
  canReorder,
  reordering,
  onToggleReorder,
  onReviewPractice,
  startPractice,
}: PlaylistDetailHeaderProps) {
  const renaming = panel.kind === "rename";
  // The rename in flight: Save says so and cannot fire twice.
  const [saving, setSaving] = useState(false);
  // The dots button, so the delete modal can hand focus back to it.
  const menuButton = useRef<HTMLButtonElement>(null);

  const rename = () => {
    if (saving) return;
    setSaving(true);
    onRename()
      .catch(console.error)
      .finally(() => setSaving(false));
  };

  // Focus on mount, instead of the page's deleted effect and instead of
  // `autoFocus`, which is avoided here for the accessibility reason the page's
  // comment recorded. Memoised with an empty dependency list so React attaches
  // it once per mount: an inline arrow would detach and re-attach on every
  // render and could pull focus back after the user has tabbed to Save.
  const focusOnMount = useCallback((node: HTMLInputElement | null) => {
    node?.focus();
  }, []);

  return (
    <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 md:px-6 shrink-0">
      <div className="flex items-center gap-3">
        {/* Back */}
        <Link
          href="/playlists"
          aria-label="Back to playlists"
          className="p-1.5 rounded text-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 shrink-0"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
              clipRule="evenodd"
            />
          </svg>
        </Link>

        {/* Cover */}
        {playlist.cover_url && (
          <Image
            src={playlist.cover_url}
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 rounded object-cover shrink-0"
            unoptimized
          />
        )}

        {/* Name / edit input */}
        {renaming ? (
          <div className="flex-1 flex items-center gap-2">
            <input
              ref={focusOnMount}
              type="text"
              value={renameDraft(panel)}
              onChange={(ev) =>
                dispatch({ type: "change-rename-draft", draft: ev.target.value })
              }
              onKeyDown={(ev) => {
                if (ev.key === "Enter") rename();
                if (ev.key === "Escape") dispatch({ type: "close" });
              }}
              disabled={saving}
              className="flex-1 rounded border border-emerald-300 px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
              aria-label="Playlist name"
            />
            <button
              type="button"
              onClick={() => rename()}
              disabled={saving}
              className="flex items-center gap-1 text-xs text-emerald-600 font-medium hover:text-emerald-800 focus:outline-none focus:underline disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? (
                <>
                  <Spinner />
                  Saving…
                </>
              ) : (
                "Save"
              )}
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: "close" })}
              disabled={saving}
              className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus:underline disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <h1 className="flex-1 text-lg font-bold text-gray-900 truncate">
            {playlist.name}
          </h1>
        )}

        {/* Actions */}
        {!renaming && (
          <div className="flex items-center gap-1 shrink-0">
            {startPractice}
            {reordering && <DoneReorderingButton onClick={onToggleReorder} />}
            <PlaylistHeaderMenu
              buttonRef={menuButton}
              canReorder={canReorder}
              reordering={reordering}
              onReorder={onToggleReorder}
              onReviewPractice={onReviewPractice}
              onAddSongs={() => dispatch({ type: "toggle-picker" })}
              onRename={() => dispatch({ type: "open-rename", name: playlist.name })}
              onDelete={() => dispatch({ type: "open-delete-confirm" })}
            />
          </div>
        )}
      </div>

      {panel.kind === "delete-confirm" && (
        <PlaylistDeleteModal
          onDelete={onDelete}
          onCancel={() => dispatch({ type: "close" })}
          returnFocusRef={menuButton}
        />
      )}

      <PlaylistSpotifyStrip
        playlist={playlist}
        syncing={syncing}
        onSync={onSync}
      />
    </header>
  );
}

/**
 * The *Done* button of reorder mode (RH-103). Entering the mode is the menu's
 * "Reorder"; leaving it stays a visible top-level button.
 *
 * The accessible name is `Done reordering` — the visible label is the shorter
 * `Done`, which on its own would not say what is being finished.
 */
function DoneReorderingButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={true}
      aria-label="Done reordering"
      className="px-2 py-1 rounded text-xs font-medium bg-emerald-600 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
    >
      Done
    </button>
  );
}
