"use client";

import { useMemo } from "react";
import { summarisePlaylistMastery } from "@/lib/playlistDetail";
import { formatPlaylistDuration } from "@/lib/playlistList";
import { STATUS_CONFIG, STATUS_ORDER } from "@/lib/statusConfig";
import type { PlaylistSong, Repertoire, SongStatus } from "@/types/database";

// Solid bar colors that match STATUS_CONFIG (Tailwind bg classes won't work inside
// inline-style width, so we use raw hex values for the stacked bar segments).
const STATUS_BAR_COLORS: Record<SongStatus, string> = {
  unknown: "#d1d5db", // gray-300
  learning: "#93c5fd", // blue-300
  practicing: "#fde047", // yellow-300
  polishing: "#fdba74", // orange-300
  mastered: "#86efac", // green-300
};

export interface PlaylistSummaryProps {
  songs: PlaylistSong[];
  repertoireMap: Map<string, Repertoire>;
}

/**
 * How far along the playlist is: the score pill, the total playing time, the
 * stacked distribution bar and its legend. Hidden entirely for an empty
 * playlist. Every number comes from `summarisePlaylistMastery`.
 */
export function PlaylistSummary({ songs, repertoireMap }: PlaylistSummaryProps) {
  const { counts, totalSeconds, total, score, scoreStatus } = useMemo(
    () => summarisePlaylistMastery(songs, repertoireMap),
    [songs, repertoireMap],
  );

  if (total === 0) return null;

  const cfg = STATUS_CONFIG[scoreStatus];

  return (
    <div className="px-4 py-3 md:px-6 border-b border-gray-100 bg-gray-50">
      {/* Score + total duration */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500">
          Playlist level
          {totalSeconds > 0 && (
            <span className="ml-2 text-gray-400 font-normal">
              {formatPlaylistDuration(totalSeconds)}
            </span>
          )}
        </span>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full border border-current ${cfg.bgColor} ${cfg.textColor}`}
        >
          {cfg.label} &middot; {score}%
        </span>
      </div>

      {/* Stacked distribution bar */}
      <div
        className="flex h-2 rounded-full overflow-hidden gap-px"
        aria-label="Status distribution"
      >
        {STATUS_ORDER.map((statusKey) => {
          const pct = (counts[statusKey] / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={statusKey}
              style={{
                width: `${pct}%`,
                backgroundColor: STATUS_BAR_COLORS[statusKey],
              }}
              title={`${STATUS_CONFIG[statusKey].label}: ${counts[statusKey]}`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {STATUS_ORDER.filter((statusKey) => counts[statusKey] > 0).map(
          (statusKey) => (
            <span
              key={statusKey}
              className="flex items-center gap-1 text-xs text-gray-500"
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: STATUS_BAR_COLORS[statusKey] }}
                aria-hidden="true"
              />
              {STATUS_CONFIG[statusKey].label} ({counts[statusKey]})
            </span>
          ),
        )}
      </div>
    </div>
  );
}
