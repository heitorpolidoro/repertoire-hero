"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { PickedSelectionController } from "@/hooks/usePickedSelection";

/** RH-170 - the "Select songs" entry button, hidden while the mode is on. */
export function SelectSongsButton({ picker }: { picker: PickedSelectionController }) {
  if (picker.active) return null;
  return (
    <button
      type="button"
      onClick={picker.enter}
      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
    >
      Select songs
    </button>
  );
}

/** RH-170 - the bar shown in picker mode: count, Cancel, "Start practice". */
export function SongPickerBar({ picker }: { picker: PickedSelectionController }) {
  if (!picker.active) return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
      <span className="font-medium text-gray-900" role="status">{picker.count} picked</span>
      <span className="flex gap-2">
        <button
          type="button"
          onClick={picker.cancel}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-gray-700"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={picker.confirm}
          disabled={!picker.canStart}
          className="rounded bg-emerald-600 px-2 py-1 text-white disabled:opacity-40"
        >
          Start practice
        </button>
      </span>
    </div>
  );
}

interface PickableRowLinkProps {
  picker: PickedSelectionController;
  versionId: string;
  href: string;
  className: string;
  /** Normal-mode click (the dashboard drops the stale queue here). */
  onOpen?: () => void;
  children: ReactNode;
}

/**
 * RH-170 - a row's tap target: the Fast View link normally, a toggle button with
 * its pick number in picker mode. Each screen keeps its own row markup inside.
 */
export function PickableRowLink({ picker, versionId, href, className, onOpen, children }: PickableRowLinkProps) {
  if (!picker.active) {
    return (
      <Link href={href} onClick={onOpen} className={className}>
        {children}
      </Link>
    );
  }
  const number = picker.pickNumber(versionId);
  return (
    <button
      type="button"
      onClick={() => picker.toggle(versionId)}
      aria-pressed={number !== null}
      className={className}
    >
      <span
        data-testid="pick-badge"
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${
          number !== null ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-300"
        }`}
      >
        {number ?? ""}
      </span>
      {children}
    </button>
  );
}
