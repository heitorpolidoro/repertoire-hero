"use client";

import { useMemo } from "react";
import { summarisePlaylistMastery } from "@/lib/playlistDetail";
import { formatPlaylistDuration } from "@/lib/playlistList";
import { STATUS_CONFIG, STATUS_ORDER } from "@/lib/statusConfig";
import type { PlaylistSong, Repertoire, SongStatus } from "@/types/database";

/**
 * Solid bar colours that match STATUS_CONFIG (Tailwind bg classes won't work
 * inside an inline-style width, so the stacked bar uses raw hex values).
 *
 * Four rows, not five: RH-102 took `unknown` out of the bar. It is not a stage
 * with a share of its own — it is the part of the grey track below that no
 * segment covers, which is why the record is keyed by the four `STATUS_ORDER`
 * stages and the legend names the rest in words.
 */
const STATUS_BAR_COLORS: Record<Exclude<SongStatus, "unknown">, string> = {
  learning: "#93c5fd", // blue-300
  practicing: "#fde047", // yellow-300
  polishing: "#fdba74", // orange-300
  mastered: "#86efac", // green-300
};

/** One stage's colour, by the key the four-stage record actually holds. */
function barColor(status: SongStatus): string {
  return STATUS_BAR_COLORS[status as Exclude<SongStatus, "unknown">];
}

export interface PlaylistSummaryProps {
  songs: PlaylistSong[];
  repertoireMap: Map<string, Repertoire>;
}

/**
 * How far along the playlist is: the score pill, the total playing time, the
 * stacked distribution bar and its legend. Hidden entirely for an empty
 * playlist. Every number comes from `summarisePlaylistMastery`, whose score and
 * label RH-102 left exactly as they were.
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

      {/* Stacked distribution bar: the four stages over a grey track, whose
          uncovered remainder is the unassessed share (RH-102). */}
      <div
        className="flex h-2 rounded-full overflow-hidden gap-px bg-gray-200"
        aria-label="Status distribution"
      >
        {STATUS_ORDER.map((statusKey) => {
          const pct = (counts[statusKey] / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={statusKey}
              style={{ width: `${pct}%`, backgroundColor: barColor(statusKey) }}
              title={`${STATUS_CONFIG[statusKey].label}: ${counts[statusKey]}`}
            />
          );
        })}
      </div>

      {/* Legend: a swatch per stage present, then the unassessed count in plain
          words — it has no segment, so it gets no swatch. */}
      <div
        className="flex flex-wrap gap-x-3 gap-y-1 mt-2"
        aria-label="Status distribution legend"
      >
        {STATUS_ORDER.filter((statusKey) => counts[statusKey] > 0).map(
          (statusKey) => (
            <span
              key={statusKey}
              className="flex items-center gap-1 text-xs text-gray-500"
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: barColor(statusKey) }}
                aria-hidden="true"
              />
              {STATUS_CONFIG[statusKey].label} ({counts[statusKey]})
            </span>
          ),
        )}
        {counts.unknown > 0 && (
          <span className="flex items-center gap-1 text-xs text-gray-500">
            {counts.unknown} unassessed
          </span>
        )}
      </div>
    </div>
  );
}
