"use client";

import { Spinner } from "@/components/ui/Spinner";
import type { PlaylistOfflineIndicatorState } from "@/lib/playlistOfflineMenu";

/**
 * RH-201 — the compact offline icon after the playlist name: a spinner named
 * "Downloading <done> / <total> songs" while a run is in flight, a cloud-check
 * named "Available offline" once downloaded (its tooltip carries the count),
 * and nothing otherwise. `shrink-0`, so the name truncates first.
 */
export function PlaylistOfflineIndicator({ state }: { state: PlaylistOfflineIndicatorState | null }) {
  if (!state) return null;
  if (state.kind === "downloading") {
    return (
      <span role="img" aria-label={state.label} title={state.label} className="inline-flex shrink-0">
        <Spinner colorClassName="text-emerald-700" />
      </span>
    );
  }
  return (
    <span role="img" aria-label={state.label} title={state.title} className="inline-flex shrink-0 text-emerald-600">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
        <path d="m9 14 2 2 4-4" />
      </svg>
    </span>
  );
}
