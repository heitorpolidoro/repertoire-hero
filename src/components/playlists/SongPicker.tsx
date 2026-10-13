"use client";

import { useEffect, useRef } from "react";
import { SongGroupCard } from "@/components/playlists/SongGroupCard";
import { Spinner } from "@/components/ui/Spinner";
import { shouldSearchPicker, type SongPickerController } from "@/lib/songPicker";

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
 * **same** `<ul aria-live="polite">` and through `SongGroupCard` (RH-150). There
 * never were two sections to merge: the list was always one, and what was wrong
 * is that one song occupied two rows in it. Nothing a user sees about the panel
 * changes except that those two rows are now one — no section heading and no
 * catalog tag.
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
            <SongGroupCard
              key={row.id}
              row={row}
              adding={picker.addingId === row.id}
              error={picker.rowErrors[row.id]}
              onAdd={(picked) => {
                void picker.addRow(picked);
              }}
            />
          ))
        )}
      </ul>
    </div>
  );
}
