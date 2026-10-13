"use client";

import type { SongStatus } from "@/types/database";
import { ALL_STATUSES, STATUS_CONFIG } from "@/lib/statusConfig";

const ALL_STATUS_FILTERS: Array<{ value: SongStatus | null; label: string }> = [
  { value: null, label: "All" },
  ...ALL_STATUSES.map((s) => ({
    value: s as SongStatus,
    label: STATUS_CONFIG[s].label,
  })),
];

/** The dashboard's "Filter by status" pill row, moved out verbatim (RH-170, for the line budget). */
export function StatusFilterPills({
  selected,
  onSelect,
}: {
  selected: SongStatus | null;
  onSelect: (status: SongStatus | null) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter by status"
      className="flex gap-2 mt-3 overflow-x-auto pb-1 scrollbar-none"
    >
      {ALL_STATUS_FILTERS.map(({ value, label }) => {
        const isActive = selected === value;
        const cfg = value ? STATUS_CONFIG[value] : null;
        return (
          <button
            key={value ?? "all"}
            type="button"
            onClick={() => onSelect(value)}
            aria-pressed={isActive}
            className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              isActive
                ? cfg
                  ? `${cfg.bgColor} ${cfg.textColor} border-current`
                  : "bg-emerald-600 text-white border-emerald-600"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
