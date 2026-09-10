"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, type Dispatch } from "react";
import { PlaylistSpotifyStrip } from "@/components/playlists/PlaylistSpotifyStrip";
import { SongPickerToggle } from "@/components/playlists/SongPickerToggle";
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
}

/**
 * RH-70 — the sticky header of `/playlists/[id]`: the back arrow, the cover,
 * the title or the inline rename input, the three action buttons and the
 * Spotify strip.
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
}: PlaylistDetailHeaderProps) {
  const renaming = panel.kind === "rename";

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
                if (ev.key === "Enter") onRename().catch(console.error);
                if (ev.key === "Escape") dispatch({ type: "close" });
              }}
              className="flex-1 rounded border border-emerald-300 px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              aria-label="Playlist name"
            />
            <button
              type="button"
              onClick={() => {
                onRename().catch(console.error);
              }}
              className="text-xs text-emerald-600 font-medium hover:text-emerald-800 focus:outline-none focus:underline"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: "close" })}
              className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus:underline"
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
          <div className="flex items-center gap-0.5 shrink-0">
            {/* Add songs */}
            <SongPickerToggle
              open={panel.kind === "picker"}
              onToggle={() => dispatch({ type: "toggle-picker" })}
            />

            <button
              type="button"
              onClick={() =>
                dispatch({ type: "open-rename", name: playlist.name })
              }
              aria-label="Rename playlist"
              className="p-1.5 rounded text-gray-400 hover:text-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
            </button>

            {panel.kind === "delete-confirm" ? (
              <span className="flex items-center gap-1 text-xs px-1">
                <span className="text-gray-600">Sure?</span>
                <button
                  type="button"
                  onClick={() => {
                    onDelete().catch(console.error);
                  }}
                  className="text-red-500 font-medium hover:text-red-700 focus:outline-none focus:underline"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "close" })}
                  className="text-gray-500 hover:text-gray-700 focus:outline-none focus:underline"
                >
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => dispatch({ type: "open-delete-confirm" })}
                aria-label="Delete playlist"
                className="p-1.5 rounded text-gray-400 hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
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
                    d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      <PlaylistSpotifyStrip
        playlist={playlist}
        syncing={syncing}
        onSync={onSync}
      />
    </header>
  );
}
