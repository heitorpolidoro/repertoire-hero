"use client";

import { useState } from "react";
import Image from "next/image";
import { SongVersionLine } from "@/components/playlists/SongVersionLine";
import { versionYear } from "@/lib/songVersionLine";
import type { SongSearchRow } from "@/lib/songSearchMerge";

export interface SongGroupCardProps {
  row: SongSearchRow;
  /** Row-level: while true every `Add` of the card is disabled. */
  adding: boolean;
  error?: string;
  /** Adds the row as given; its `versions[0]` is the version that is added. */
  onAdd: (row: SongSearchRow) => void;
}

/**
 * One merged row of the add-song picker. Collapsed it shows the representative
 * version (`versions[0]`) with one card-level `Add`; expanded it lists every
 * version, each with its own `Add`, and drops the card-level one.
 */
export function SongGroupCard({ row, adding, error, onAdd }: SongGroupCardProps) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = row.versions.length > 0;
  const showExpanded = expanded && canExpand;
  const albumLine = [row.album, versionYear(row.versions[0]?.releaseDate ?? null)]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="rounded px-2 py-1.5 hover:bg-gray-50">
      <div className="flex items-center gap-2">
        {row.coverUrl ? (
          <Image
            src={row.coverUrl}
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded object-cover shrink-0"
            unoptimized
          />
        ) : (
          <div className="h-8 w-8 rounded bg-emerald-100 shrink-0" aria-hidden="true" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-900 truncate">{row.title}</p>
          <p className="text-xs text-gray-500 truncate">{row.artist}</p>
          {albumLine && (
            <p className="text-xs text-gray-400 italic truncate">{albumLine}</p>
          )}
        </div>
        {canExpand && (
          <button
            type="button"
            aria-expanded={showExpanded}
            aria-label={showExpanded ? "Hide versions" : "Show versions"}
            onClick={() => setExpanded((open) => !open)}
            className="shrink-0 text-xs text-gray-500 hover:text-gray-800 focus:outline-none focus:underline"
          >
            {showExpanded ? "▲" : "▼"}
          </button>
        )}
        {!showExpanded && (
          <button
            type="button"
            onClick={() => onAdd(row)}
            disabled={adding}
            className="shrink-0 text-xs text-emerald-600 font-medium hover:text-emerald-800 focus:outline-none focus:underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {adding ? "Adding…" : "Add"}
          </button>
        )}
      </div>
      {showExpanded && (
        <ul className="mt-1 ml-10 flex flex-col">
          {row.versions.map((version, index) => (
            <SongVersionLine
              key={version.versionId ?? version.spotifyTrackId ?? index}
              version={version}
              adding={adding}
              onAdd={() => onAdd({ ...row, versions: [version] })}
            />
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-red-500 text-right">{error}</p>}
    </li>
  );
}
