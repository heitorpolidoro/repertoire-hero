"use client";

import type { RefusedCatalogField } from "@/types/database";
import { CATALOG_FIELD_LABELS, describeCatalogValue } from "@/lib/catalogFields";

interface CatalogRefusalNoticeProps {
  refused: RefusedCatalogField[];
  /** Opens the correction form holding the refused values. */
  onSuggest: () => void;
}

/**
 * The backstop (RH-97): what a save says when the shared catalog kept its own
 * values for some columns.
 *
 * The song form renders populated shared fields read-only, so this is reachable
 * only through the race that shape cannot close — the form is drawn from the
 * catalog as it was when it opened, and someone else can fill a blank in
 * between. Rare, but the alternative is reporting the save as a plain success,
 * which is the defect this task exists to remove.
 */
export function CatalogRefusalNotice({ refused, onSuggest }: CatalogRefusalNoticeProps) {
  if (refused.length === 0) return null;

  return (
    <div
      role="alert"
      className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-col gap-3"
    >
      <p className="text-sm font-semibold text-amber-900">
        Your own changes were saved. The shared catalog kept its values for the
        fields below, because someone else had already filled them in.
      </p>
      <ul className="flex flex-col gap-2 text-sm">
        {refused.map((field) => (
          <li key={field.column} className="flex flex-col">
            <span className="font-medium text-amber-900">
              {CATALOG_FIELD_LABELS[field.column]}
            </span>
            <span className="text-amber-800">
              catalog has {describeCatalogValue(field.current)}, you entered{" "}
              {describeCatalogValue(field.proposed)}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onSuggest}
        className="self-start px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors"
      >
        Suggest these as corrections
      </button>
    </div>
  );
}
