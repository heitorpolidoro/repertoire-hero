"use client";

import { useState } from "react";
import { StatusNotes } from "@/components/ui/StatusNotes";
import type { SongStatus } from "@/types/database";

export interface PractiseButtonProps {
  /** Names the song for the button's accessible name. */
  title: string;
  /** The row's current level, shown by the level control once revealed. */
  status: SongStatus;
  /** The level control follows the row's own read-only rule (band playlists). */
  readOnly: boolean;
  /** Writes the date. Resolves `false` when it failed — the page shows the error. */
  onPractise: () => Promise<boolean>;
  /** The optional level, issued as a status-only write that never touches the date. */
  onLevel: (status: SongStatus) => void;
}

/**
 * RH-158 — the per-song "Practised" button. A tap writes the date at once; only
 * a successful write reveals the level control, so a failed one leaves the row
 * as it was. Choosing a level, or dismissing, closes the control again.
 */
export function PractiseButton({ title, status, readOnly, onPractise, onLevel }: PractiseButtonProps) {
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);

  const tap = async () => {
    setBusy(true);
    try {
      setRevealed(await onPractise());
    } finally {
      setBusy(false);
    }
  };

  if (revealed) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <StatusNotes
          status={status}
          readOnly={readOnly}
          onChange={(next) => {
            setRevealed(false);
            onLevel(next);
          }}
        />
        <button
          type="button"
          onClick={() => setRevealed(false)}
          aria-label={`Dismiss level for ${title}`}
          className="shrink-0 rounded px-1 text-xs text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        tap().catch(console.error);
      }}
      aria-label={`Mark ${title} as practised`}
      className="shrink-0 rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:border-emerald-300 hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-50"
    >
      Practised
    </button>
  );
}
