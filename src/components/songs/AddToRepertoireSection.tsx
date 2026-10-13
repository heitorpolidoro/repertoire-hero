"use client";

import type { RepertoireSearchController } from "@/hooks/useRepertoireSearch";
import type { ManualEntryActions } from "@/hooks/useManualEntry";
import { SongGroupCard } from "@/components/playlists/SongGroupCard";
import { ManualEntryPanel } from "./ManualEntryPanel";

interface AddToRepertoireSectionProps {
  search: RepertoireSearchController;
  query: string;
  manualActions: ManualEntryActions;
  onAdded: () => Promise<void>;
}

/**
 * The dashboard's "Add to your repertoire" section (RH-151 results, RH-152
 * manual entry). It is mounted for any query long enough to search, so the
 * manual-entry panel is there under the results and when there are none.
 */
export function AddToRepertoireSection({
  search,
  query,
  manualActions,
  onAdded,
}: AddToRepertoireSectionProps) {
  const noMatches = !search.loading && search.results.length === 0;
  return (
    <section aria-label="Add to your repertoire" className="mt-4">
      {/* Divider */}
      <div className="flex items-center gap-3 mb-3">
        <hr className="flex-1 border-gray-200" />
        <span className="text-xs font-medium text-gray-400">Add to your repertoire</span>
        <hr className="flex-1 border-gray-200" />
      </div>

      {/* One card per song (RH-151) */}
      <ul className="flex flex-col gap-2" aria-live="polite">
        {search.results.map((row) => (
          <SongGroupCard
            key={row.id}
            row={row}
            adding={search.addingId === row.id}
            error={search.rowErrors[row.id]}
            onAdd={(picked) => {
              void search.addRow(picked);
            }}
          />
        ))}

        {search.loading && (
          <li
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400"
            aria-busy="true"
          >
            <svg
              className="animate-spin h-4 w-4 text-emerald-500 shrink-0"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Searching Spotify...
          </li>
        )}
      </ul>
      {noMatches && <p className="px-3 py-2 text-sm text-gray-400">No matches. Add it by hand.</p>}

      <ManualEntryPanel actions={manualActions} query={query} onAdded={onAdded} />
    </section>
  );
}
