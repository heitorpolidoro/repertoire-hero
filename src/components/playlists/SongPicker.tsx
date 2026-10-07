"use client";

import { useEffect, useRef } from "react";
import { PickerRow } from "@/components/playlists/PickerRow";
import { Spinner } from "@/components/ui/Spinner";
import { shouldSearchPicker, type SongPickerController } from "@/lib/songPicker";
import type { SongSearchRow } from "@/lib/songSearchMerge";

/**
 * The year of the row's representative candidate, or null.
 *
 * A release date is `YYYY-MM-DD` from the catalog and may be a bare `YYYY` or
 * `YYYY-MM` from Spotify, so the year is always its first four characters.
 */
function rowYear(row: SongSearchRow): string | null {
  return row.versions[0]?.releaseDate?.slice(0, 4) ?? null;
}

export interface SongPickerProps {
  /** The controller from `useSongPicker`; the panel decides nothing itself. */
  picker: SongPickerController;
}

/**
 * The add-song panel of `/playlists/[id]`, moved out of the page by RH-67 with
 * its markup unchanged. It renders the four states in their original order —
 * prompt, searching, empty, results — and owns only the input ref and the focus
 * the page used to apply when the panel opened. The page unmounts this
 * component when the panel closes, which is what the e2e net asserts.
 *
 * RH-108 replaced the two `.map`s with one over `picker.results`, inside the
 * **same** `<ul aria-live="polite">` and through the same `PickerRow`. There
 * never were two sections to merge: the list was always one, and what was wrong
 * is that one song occupied two rows in it. Nothing a user sees about the panel
 * changes except that those two rows are now one — no section heading, no
 * "in catalog" tag, no re-layout.
 */
export function SongPicker({ picker }: SongPickerProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  return (
    <div className="border-t border-gray-100 px-4 py-3 md:px-6 shrink-0 flex flex-col gap-2">
      <input
        ref={searchInputRef}
        type="search"
        value={picker.query}
        onChange={(ev) => picker.changeQuery(ev.target.value)}
        placeholder="Search catalog and Spotify…"
        className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
      <ul
        className="max-h-60 overflow-y-auto flex flex-col gap-0.5"
        aria-live="polite"
      >
        {!shouldSearchPicker(picker.query) ? (
          <li className="text-xs text-gray-400 text-center py-3">
            Type to search…
          </li>
        ) : picker.loading ? (
          <li
            className="flex items-center gap-2 px-2 py-2 text-sm text-gray-400"
            aria-busy="true"
          >
            <Spinner /> Searching…
          </li>
        ) : picker.results.length === 0 ? (
          <li className="text-xs text-gray-400 text-center py-3">No results</li>
        ) : (
          picker.results.map((row) => (
            <PickerRow
              key={row.id}
              coverUrl={row.coverUrl}
              title={row.title}
              artist={row.artist}
              album={row.album}
              year={rowYear(row)}
              adding={picker.addingId === row.id}
              error={picker.rowErrors[row.id]}
              onAdd={() => {
                void picker.addRow(row);
              }}
            />
          ))
        )}
      </ul>
    </div>
  );
}
