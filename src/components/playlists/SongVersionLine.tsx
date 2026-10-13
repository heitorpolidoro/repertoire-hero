"use client";

import { versionLineText } from "@/lib/songVersionLine";
import type { SearchVersionCandidate } from "@/lib/songSearchMerge";

export interface SongVersionLineProps {
  version: SearchVersionCandidate;
  adding: boolean;
  onAdd: () => void;
}

/**
 * One listed version of an expanded card. Every version is drawn the same:
 * nothing marks one above the others.
 */
export function SongVersionLine({ version, adding, onAdd }: SongVersionLineProps) {
  const line = versionLineText(version);
  return (
    <li className="flex items-center gap-2 py-1">
      <div className="flex-1 min-w-0">
        {line && <p className="text-xs text-gray-500 truncate">{line}</p>}
        {version.label && (
          <p data-testid="version-label" className="text-xs text-gray-400 truncate">
            {version.label}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={adding}
        className="shrink-0 text-xs text-emerald-600 font-medium hover:text-emerald-800 focus:outline-none focus:underline disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {adding ? "Adding…" : "Add"}
      </button>
    </li>
  );
}
