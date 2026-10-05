"use client";

export interface PlaylistReorderControlsProps {
  /** The song's title, which both accessible names are built from. */
  title: string;
  /** True for the top row: there is nothing above it to swap with. */
  first: boolean;
  /** True for the bottom row. */
  last: boolean;
  /** Moves the row one place; the list binds the controller's `moveSong`. */
  onMove: (direction: "up" | "down") => void;
}

/**
 * RH-103 — the up/down pair of a reorder-mode row.
 *
 * These are not a fallback for a failed drag: a pointer gesture needs a
 * non-pointer equivalent and this is it, so the whole path is reachable from
 * the keyboard — Tab to *Reorder*, Enter, Tab to a row's *Move … up*. Both
 * buttons are 44 × 44, and each is disabled at the end of the list where it
 * would do nothing. (The controller short-circuits there anyway; `disabled` is
 * what tells a screen-reader user before they press it.)
 *
 * Its own file so `PlaylistSongRow` does not grow a second concern and
 * `PlaylistSongReorderRow` stays a composition.
 */
export function PlaylistReorderControls({
  title,
  first,
  last,
  onMove,
}: PlaylistReorderControlsProps) {
  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        onClick={() => onMove("up")}
        disabled={first}
        aria-label={`Move ${title} up`}
        className="flex h-11 w-11 items-center justify-center rounded text-gray-400 hover:text-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:text-gray-200"
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
            d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onMove("down")}
        disabled={last}
        aria-label={`Move ${title} down`}
        className="flex h-11 w-11 items-center justify-center rounded text-gray-400 hover:text-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:text-gray-200"
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
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </div>
  );
}
