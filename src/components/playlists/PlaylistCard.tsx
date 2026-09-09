"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  formatPlaylistDuration,
  playlistDurationSeconds,
} from "@/lib/playlistList";
import type { Playlist } from "@/types/database";

// ---------------------------------------------------------------------------
// Inline rename editor
// ---------------------------------------------------------------------------

interface PlaylistNameEditorProps {
  editName: string;
  inputRef: { current: HTMLInputElement | null };
  onChange: (val: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

const PlaylistNameEditor = ({
  editName,
  inputRef,
  onChange,
  onSubmit,
  onCancel,
}: PlaylistNameEditorProps) => (
  <div
    className="flex items-center gap-2"
    onClick={(ev) => ev.stopPropagation()}
  >
    <input
      ref={inputRef}
      type="text"
      value={editName}
      onChange={(ev) => onChange(ev.target.value)}
      onKeyDown={(ev) => {
        if (ev.key === "Enter") onSubmit();
        if (ev.key === "Escape") onCancel();
      }}
      className="flex-1 rounded border border-emerald-300 px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
    />
    <button
      type="button"
      onClick={onSubmit}
      className="text-xs text-emerald-600 font-medium hover:text-emerald-800"
    >
      Save
    </button>
    <button
      type="button"
      onClick={onCancel}
      className="text-xs text-gray-500 hover:text-gray-700"
    >
      Cancel
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// Playlist card
// ---------------------------------------------------------------------------

interface PlaylistCardProps {
  playlist: Playlist;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onClick: () => void;
}

export const PlaylistCard = ({
  playlist,
  onDelete,
  onRename,
  onClick,
}: PlaylistCardProps) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(playlist.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) renameInputRef.current?.focus();
  }, [editing]);

  const handleRenameSubmit = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== playlist.name) onRename(playlist.id, trimmed);
    setEditing(false);
  };

  const songCount = Array.isArray(playlist.songs)
    ? playlist.songs.length
    : null;
  const totalSeconds = playlistDurationSeconds(playlist);
  const totalDuration =
    totalSeconds > 0 ? formatPlaylistDuration(totalSeconds) : null;

  return (
    <li
      className="rounded-lg border border-gray-100 bg-white shadow-sm px-4 py-3 flex items-center gap-3 cursor-pointer hover:border-emerald-200 hover:shadow-md transition-all"
      onClick={(ev) => {
        if ((ev.target as HTMLElement).closest("button, input")) return;
        onClick();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") onClick();
      }}
      aria-label={`Open ${playlist.name}`}
    >
      {/* Cover */}
      {playlist.cover_url ? (
        <Image
          src={playlist.cover_url}
          alt=""
          width={48}
          height={48}
          className="h-12 w-12 rounded object-cover shrink-0"
          unoptimized
        />
      ) : (
        <div
          className="h-12 w-12 rounded bg-emerald-100 shrink-0 flex items-center justify-center text-xl"
          aria-hidden="true"
        >
          🎵
        </div>
      )}

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <PlaylistNameEditor
            editName={editName}
            inputRef={renameInputRef}
            onChange={setEditName}
            onSubmit={handleRenameSubmit}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <p className="text-sm font-semibold text-gray-900 truncate">
              {playlist.name}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              {songCount !== null && (
                <span className="text-xs text-gray-400">
                  {songCount} {songCount === 1 ? "song" : "songs"}
                </span>
              )}
              {totalDuration && (
                <span className="text-xs text-gray-400 tabular-nums">
                  {totalDuration}
                </span>
              )}
              {playlist.spotify_playlist_id && (
                <span className="text-xs text-green-600 flex items-center gap-0.5">
                  <span aria-hidden="true">🔄</span>
                  {playlist.sync_with_spotify ? "Auto-sync" : "Synced"}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Action icons */}
      {!editing && (
        <div className="shrink-0 flex items-center gap-0.5">
          <button
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              setEditName(playlist.name);
              setEditing(true);
            }}
            aria-label={`Rename ${playlist.name}`}
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

          {confirmDelete ? (
            <span
              className="flex items-center gap-1 text-xs px-1"
              onClick={(ev) => ev.stopPropagation()}
            >
              <span className="text-gray-600">Sure?</span>
              <button
                type="button"
                onClick={() => {
                  onDelete(playlist.id);
                  setConfirmDelete(false);
                }}
                className="text-red-500 font-medium hover:text-red-700 focus:outline-none focus:underline"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-gray-500 hover:text-gray-700 focus:outline-none focus:underline"
              >
                No
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                setConfirmDelete(true);
              }}
              aria-label={`Delete ${playlist.name}`}
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
    </li>
  );
};
