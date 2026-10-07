"use client";

import Image from "next/image";

/**
 * One result row of the add-song picker, drawn identically for a catalog song
 * and a Spotify track. Moved out of `/playlists/[id]` by RH-67, markup
 * unchanged: the e2e net locates it as a `listitem` carrying a button named
 * exactly `Add`.
 */
export interface PickerRowProps {
  coverUrl?: string | null;
  title: string;
  artist: string;
  album?: string | null;
  /**
   * The representative recording's release year, rendered beside the album
   * (RH-108). The album and the year are what actually distinguish two rows of
   * one song — `Bad`, `Bad (Remastered)` 1987, `Bad (Remastered)` 2025 — and
   * RH-112's version list leads with the same pair.
   */
  year?: string | null;
  adding: boolean;
  error?: string;
  onAdd: () => void;
}

export function PickerRow({
  coverUrl,
  title,
  artist,
  album,
  year,
  adding,
  error,
  onAdd,
}: PickerRowProps) {
  const albumLine = [album, year].filter(Boolean).join(" · ");
  return (
    <li className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
      {coverUrl ? (
        <Image
          src={coverUrl}
          alt=""
          width={32}
          height={32}
          className="h-8 w-8 rounded object-cover shrink-0"
          unoptimized
        />
      ) : (
        <div
          className="h-8 w-8 rounded bg-emerald-100 shrink-0"
          aria-hidden="true"
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-900 truncate">{title}</p>
        <p className="text-xs text-gray-500 truncate">{artist}</p>
        {albumLine && (
          <p className="text-xs text-gray-400 italic truncate">{albumLine}</p>
        )}
      </div>
      <div className="shrink-0 flex flex-col items-end gap-0.5">
        <button
          type="button"
          onClick={onAdd}
          disabled={adding}
          className="text-xs text-emerald-600 font-medium hover:text-emerald-800 focus:outline-none focus:underline disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {adding ? "Adding…" : "Add"}
        </button>
        {error && (
          <p className="text-xs text-red-500 text-right max-w-[120px]">{error}</p>
        )}
      </div>
    </li>
  );
}
