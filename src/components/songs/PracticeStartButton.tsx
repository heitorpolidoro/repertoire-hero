"use client";

import type { PracticeStartController } from "@/hooks/usePracticeStart";

/**
 * RH-168 - the "Start practice" button and its source menu (whole repertoire,
 * or one playlist), shared by the band screen and the personal dashboard.
 * Presentational: `usePracticeStart` owns every decision.
 */
export function PracticeStartButton({ practice }: { practice: PracticeStartController }) {
  const { open, playlists, pending, message, toggle, start } = practice;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
      >
        {pending ? "Starting..." : "Start practice"}
      </button>
      {open && (
        <ul
          role="menu"
          aria-label="Practice source"
          className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg"
        >
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => start({ kind: "repertoire" })}
              className="w-full px-3 py-2 text-left text-gray-900 hover:bg-gray-100"
            >
              Whole repertoire
            </button>
          </li>
          {playlists.map((playlist) => (
            <li key={playlist.id} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => start({ kind: "playlist", id: playlist.id, name: playlist.name })}
                className="w-full truncate px-3 py-2 text-left text-gray-900 hover:bg-gray-100"
              >
                {playlist.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p role="status" className="mt-2 text-sm text-gray-500">
          {message}
        </p>
      )}
    </div>
  );
}
