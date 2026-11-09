"use client";

export interface PlaylistSongOfflineMarkProps {
  /** The song's title, named in the trash button's accessible name. */
  title: string;
  /** Whether this song is on this device in the playlist's owner context. */
  stored: boolean;
  /** True while this playlist downloads; never set by the network state. */
  disabled: boolean;
  onRemove: () => void;
}

const ICON = {
  viewBox: "0 0 24 24",
  className: "h-4 w-4",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * RH-193 — whether one playlist song is on this device, on its resting row.
 *
 * Stored: an emerald check mark (`On this device`) and a trash button that
 * removes that one song from the device — a local write, so it needs no
 * network and no confirmation, and it never touches the playlist itself (the
 * row's `Remove <title> from playlist` X does that). Not stored: a grey dashed
 * circle (`Not on this device`) and no button; this task adds no per-row
 * download.
 *
 * Width: the mark is 16px and the trash 24px (`p-1` around a 16px icon) with a
 * 4px gap — the numbers `PlaylistSongRow`'s width budget is written against.
 * The icons are inline lucide shapes (`circle-check`, `trash-2`,
 * `circle-dashed`); the project ships no icon package.
 */
export function PlaylistSongOfflineMark({ title, stored, disabled, onRemove }: PlaylistSongOfflineMarkProps) {
  if (!stored) {
    return (
      <span role="img" aria-label="Not on this device" title="Not on this device" className="shrink-0 text-gray-400">
        <svg aria-hidden="true" {...ICON}>
          <path d="M10.1 2.182a10 10 0 0 1 3.8 0" />
          <path d="M13.9 21.818a10 10 0 0 1-3.8 0" />
          <path d="M17.609 3.721a10 10 0 0 1 2.69 2.7" />
          <path d="M2.182 13.9a10 10 0 0 1 0-3.8" />
          <path d="M20.279 17.609a10 10 0 0 1-2.7 2.69" />
          <path d="M21.818 10.1a10 10 0 0 1 0 3.8" />
          <path d="M3.721 6.391a10 10 0 0 1 2.7-2.69" />
          <path d="M6.391 20.279a10 10 0 0 1-2.69-2.7" />
        </svg>
      </span>
    );
  }
  return (
    <span className="shrink-0 flex items-center gap-1">
      <span role="img" aria-label="On this device" title="On this device" className="text-emerald-600">
        <svg aria-hidden="true" {...ICON}>
          <circle cx="12" cy="12" r="10" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${title} from this device`}
        className="p-1 rounded text-red-500 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:text-gray-300 disabled:hover:bg-transparent"
      >
        <svg aria-hidden="true" {...ICON}>
          <path d="M3 6h18" />
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          <line x1="10" x2="10" y1="11" y2="17" />
          <line x1="14" x2="14" y1="11" y2="17" />
        </svg>
      </button>
    </span>
  );
}
