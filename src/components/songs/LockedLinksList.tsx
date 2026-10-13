"use client";

import type { SongLink } from "@/types/database";

interface LockedLinksListProps {
  links: SongLink[];
  /** Opens the correction form with this link row focused (RH-138). */
  onSuggest: (linkId: string | undefined) => void;
}

/**
 * The catalog's link rows as the song form shows them once the catalog has any:
 * read-only, each with its own "Suggest a correction" control, because a
 * correction targets one row rather than the array.
 */
export function LockedLinksList({ links, onSuggest }: LockedLinksListProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-gray-700">Links</span>
      <ul className="flex flex-col gap-2" aria-label="Catalog links">
        {links.map((link) => (
          <li key={link.url} className="flex items-center justify-between gap-2 text-sm text-gray-900">
            <span className="break-all">{link.label || link.url}</span>
            <button
              type="button"
              onClick={() => onSuggest(link.id)}
              aria-label={`Suggest a correction to link ${link.label || link.url}`}
              className="shrink-0 text-[11px] font-medium text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 px-2 py-1 rounded-lg transition-colors"
            >
              Suggest a correction
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
