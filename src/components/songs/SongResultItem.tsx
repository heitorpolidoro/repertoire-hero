"use client";

import Image from "next/image";

/**
 * RH-77 — the shared search-result row, moved out of `src/app/page.tsx` when
 * the dashboard became a client island. One component per file is the
 * convention under `src/components`.
 */
interface SongResultItemProps {
  coverUrl: string | null | undefined;
  title: string;
  artist: string;
  album?: string | null;
  adding: boolean;
  error?: string;
  onAdd: () => void;
}

const SongResultItem = ({
  coverUrl,
  title,
  artist,
  album,
  adding,
  error,
  onAdd,
}: SongResultItemProps) => {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-sm">
      {coverUrl ? (
        <Image
          src={coverUrl}
          alt={`${title} cover`}
          width={40}
          height={40}
          className="h-10 w-10 rounded object-cover shrink-0"
          unoptimized
        />
      ) : (
        <div
          className="h-10 w-10 rounded bg-gray-100 shrink-0"
          aria-hidden="true"
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{title}</p>
        <p className="text-xs text-gray-500 truncate">{artist}</p>
        {album && (
          <p className="text-xs text-gray-400 italic truncate">{album}</p>
        )}
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={onAdd}
          disabled={adding}
          aria-label={`Add ${title} by ${artist} to repertoire`}
          className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {adding ? "Adding..." : "Add"}
        </button>
        {error && (
          <p className="text-xs text-red-500 text-right max-w-[120px]">
            {error}
          </p>
        )}
      </div>
    </li>
  );
};

export default SongResultItem;
