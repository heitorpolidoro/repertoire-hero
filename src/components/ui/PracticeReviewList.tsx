"use client";

import { StatusNotes } from "@/components/ui/StatusNotes";
import type {
  PracticeReviewController,
  PracticeReviewLevels,
  PracticeReviewRow,
} from "@/hooks/usePracticeReview";

export interface PracticeReviewListProps {
  review: PracticeReviewController;
  /** Every row to review, in order. */
  rows: PracticeReviewRow[];
  /** Current level per version id; a missing id renders as unassessed. */
  levels: PracticeReviewLevels;
  /** The level control follows the caller's read-only rule (band playlists). */
  readOnly: boolean;
  /** Cancel / close: discards the state and writes nothing. */
  onClose: () => void;
}

/**
 * RH-159 — the whole-playlist "Review practice" dialog. Presentational: every
 * decision lives in `usePracticeReview`.
 */
export function PracticeReviewList({
  review,
  rows,
  levels,
  readOnly,
  onClose,
}: PracticeReviewListProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Review practice"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="flex max-h-full w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Review practice</h2>
          <button
            type="button"
            onClick={review.toggleAll}
            className="text-xs font-medium text-emerald-700 hover:text-emerald-900 focus:outline-none focus:underline"
          >
            {review.allTicked ? "Untick all" : "Tick all"}
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto px-4 py-2">
          {rows.map((row) => {
            const { title, versionId } = row;
            const status =
              review.levels.get(versionId) ??
              levels.get(versionId)?.status ??
              "unknown";
            return (
              <li key={versionId} className="flex items-center gap-3 py-1.5">
                <input
                  type="checkbox"
                  checked={review.ticked.has(versionId)}
                  onChange={() => review.toggle(versionId)}
                  aria-label={`Practised ${title}`}
                  className="h-4 w-4 shrink-0 accent-emerald-600"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-900">{title}</p>
                  <p className="truncate text-xs text-gray-500">{row.artist}</p>
                </div>
                <StatusNotes
                  status={status}
                  readOnly={readOnly}
                  onChange={(next) => review.setLevel(versionId, next)}
                />
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1 text-sm text-gray-600 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={review.ticked.size === 0 || review.submitting}
            onClick={() => {
              review.confirm().catch(console.error);
            }}
            className="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
