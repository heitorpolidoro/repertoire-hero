"use client";

import {
  canDeleteVersion,
  deleteDisabledReason,
  radiusSummary,
  versionDisplayLabel,
  type RadiusState,
} from "@/lib/catalogAdminPlan";
import type { CatalogVersionOption } from "@/types/database";

interface CatalogVersionRowProps {
  version: CatalogVersionOption;
  radius: RadiusState | undefined;
  busy: boolean;
  /** Present only while a split is being composed: renders the tick box. */
  splitChoice: { checked: boolean; onToggle: () => void } | null;
  canMerge: boolean;
  onMerge: () => void;
  onDelete: () => void;
}

function RadiusLine({ radius }: { radius: RadiusState | undefined }) {
  if (!radius || radius.status === "loading") {
    return <span className="text-xs text-gray-400">Loading counts...</span>;
  }
  if (radius.status === "error") {
    return <span className="text-xs text-red-600">Counts unavailable: {radius.message}</span>;
  }
  return <span className="text-xs text-gray-600">{radiusSummary(radius.radius)}</span>;
}

/** One version of a song: its label, the counts it sustains, and merge / delete. */
export function CatalogVersionRow({
  version,
  radius,
  busy,
  splitChoice,
  canMerge,
  onMerge,
  onDelete,
}: CatalogVersionRowProps) {
  const label = versionDisplayLabel(version);
  const reason = deleteDisabledReason(radius);

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2" data-testid="catalog-version-row">
      {splitChoice && (
        <input
          type="checkbox"
          aria-label={`Select ${label}`}
          checked={splitChoice.checked}
          disabled={busy}
          onChange={splitChoice.onToggle}
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{label}</p>
        {version.albumName && version.albumName !== label && (
          <p className="text-xs text-gray-500 truncate">{version.albumName}</p>
        )}
        <RadiusLine radius={radius} />
      </div>
      <button
        type="button"
        onClick={onMerge}
        disabled={busy || !canMerge}
        className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        Merge into...
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy || !canDeleteVersion(radius)}
        title={reason ?? undefined}
        aria-label={`Delete ${label}`}
        className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        Delete
      </button>
    </li>
  );
}
