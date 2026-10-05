"use client";

import type { SongStatus } from "@/types/database";
import { STATUS_CONFIG, nextStatus } from "@/lib/statusConfig";

/**
 * RH-96 — one repertoire row's mastery badge, in its two forms.
 *
 * `editable` is the authoring gate, not a styling choice: a band's status is
 * authored by a band admin, a personal row's by its owner, and everyone else
 * gets the read-only pill with the caption that says why. The pill and the
 * button carry the same colours on purpose — what changes is whether the value
 * can be advanced, not what it looks like.
 */
export default function SongStatusBadge({
  status,
  editable,
  onAdvance,
}: {
  status: SongStatus;
  editable: boolean;
  onAdvance: (next: SongStatus) => void;
}) {
  const cfg = STATUS_CONFIG[status];
  const shape = `shrink-0 px-2 py-0.5 rounded-full text-xs font-medium border border-current ${cfg.bgColor} ${cfg.textColor}`;

  if (!editable) {
    return (
      <span
        title="Band status is set by a band admin"
        className={`${shape} opacity-75 cursor-default`}
      >
        {cfg.label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        onAdvance(nextStatus(status));
      }}
      aria-label={`Status: ${cfg.label}. Click to advance.`}
      className={shape}
    >
      {cfg.label}
    </button>
  );
}
