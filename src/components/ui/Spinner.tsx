"use client";

/**
 * The small emerald spinner `/playlists/[id]` renders next to anything in
 * flight. It lived on that page until RH-67 moved the add-song panel out; the
 * page and the panel both draw it, so it sits in `ui/` — the one cross-area
 * component directory — rather than being copied into both.
 */
export function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-emerald-500"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8H4z"
      />
    </svg>
  );
}
