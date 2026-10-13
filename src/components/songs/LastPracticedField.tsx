"use client";

import type { Repertoire } from "@/types/database";

/** The loaded `last_practiced` as the `YYYY-MM-DD` UTC day the date input shows; blank when unset. */
export const lastPracticedDraft = (song?: Repertoire): string => {
  const stored = song?.last_practiced;
  if (!stored) return "";
  const at = new Date(stored);
  return Number.isNaN(at.getTime()) ? "" : at.toISOString().slice(0, 10);
};

/**
 * What an edit-panel save adds to its payload: nothing while the draft still
 * shows the loaded day, the new day when it changed, `null` when it was cleared.
 */
export const lastPracticedPatch = (
  draft: string,
  song?: Repertoire,
): { last_practiced?: string | null } => {
  if (draft === lastPracticedDraft(song)) return {};
  return { last_practiced: draft || null };
};

interface LastPracticedFieldProps {
  /** Edit-only: create mode renders nothing. */
  visible: boolean;
  value: string;
  onChange: (value: string) => void;
}

/** The edit panel's practice date: a date input plus a control that blanks it. */
export function LastPracticedField({ visible, value, onChange }: LastPracticedFieldProps) {
  if (!visible) return null;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="sf-last-practiced" className="text-sm font-medium text-gray-700">
        Last practiced
      </label>
      <div className="flex items-center gap-3">
        <input
          id="sf-last-practiced"
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear last practiced"
            className="text-xs font-medium text-gray-500 hover:text-gray-800"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
