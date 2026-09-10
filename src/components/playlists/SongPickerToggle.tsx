"use client";

export interface SongPickerToggleProps {
  /** Whether the add-song panel is currently open. */
  open: boolean;
  /** Open the panel, or close it when it is already open. */
  onToggle: () => void;
}

/**
 * The header `+` button that opens the add-song panel on `/playlists/[id]`.
 *
 * It travels with the panel (RH-67) rather than staying on the page: it carries
 * the panel's `aria-pressed` state and the open/closed class ternary, and the
 * e2e net finds it by the accessible name `Add songs`.
 */
export function SongPickerToggle({ open, onToggle }: SongPickerToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Add songs"
      aria-pressed={open}
      className={`p-1.5 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${
        open
          ? "text-emerald-600 bg-emerald-50"
          : "text-gray-400 hover:text-emerald-600"
      }`}
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
          d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );
}
