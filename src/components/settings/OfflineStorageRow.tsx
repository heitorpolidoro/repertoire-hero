"use client";

export interface OfflineStorageRowProps {
  /** The playlist name or the song title; also names the Remove button. */
  name: string;
  /** The `·`-separated line under the name. */
  detail: string;
  onRemove: () => void;
}

/**
 * One row of the `/settings` offline storage lists (RH-194): a stored playlist
 * or a stored song, with its Remove button. Both lists share it so a playlist
 * row and a song row cannot drift apart.
 */
export function OfflineStorageRow({ name, detail, onRemove }: OfflineStorageRowProps) {
  return (
    <li className="flex items-center gap-3 py-3">
      <div>
        <p className="text-sm font-medium text-gray-900">{name}</p>
        <p className="text-xs text-gray-400">{detail}</p>
      </div>
      <button
        type="button"
        aria-label={`Remove ${name} from this device`}
        onClick={onRemove}
        className="ml-auto rounded-md px-3 py-1.5 text-xs text-red-600 border border-red-200 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500"
      >
        Remove
      </button>
    </li>
  );
}
