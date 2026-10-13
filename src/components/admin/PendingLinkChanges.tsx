import type { PendingLinkChange } from "@/types/pendingLinkChange";

interface PendingLinkChangesProps {
  changes: PendingLinkChange[];
  /** Suggestion ids the admin has marked to reject; every other row is accepted. */
  rejectedIds: readonly string[];
  disabled: boolean;
  onToggle: (suggestionId: string) => void;
}

const TITLE_OF_COLUMN: Record<PendingLinkChange["column"], string> = {
  removed: "Remove",
  url: "Edit URL",
  label: "Edit label",
};

function describeCurrent(change: PendingLinkChange): string {
  const { label, url } = change.current;
  if (change.column === "label") return label;
  if (change.column === "url") return url;
  return `${label || url} - ${url}`;
}

/**
 * The link-row suggestions of one queue card (RH-138), one entry per
 * `song_links` row change with its own Accept / Reject verdict. Presentational
 * and stateless: the verdicts live in `ModerationQueue`.
 */
export function PendingLinkChanges({ changes, rejectedIds, disabled, onToggle }: PendingLinkChangesProps) {
  if (changes.length === 0) return null;

  return (
    <ul className="space-y-2" aria-label="Link changes">
      {changes.map((change, index) => {
        const rejected = rejectedIds.includes(change.suggestion_id);
        const proposed = change.column === "removed" ? null : String(change.value);
        return (
          <li
            key={change.suggestion_id}
            className="rounded-xl border border-gray-200 p-2 flex items-start justify-between gap-2 text-xs"
          >
            <div>
              <p className="font-semibold">{TITLE_OF_COLUMN[change.column]}</p>
              <p className={proposed === null ? "text-gray-600 break-all" : "text-gray-400 line-through break-all"}>
                {describeCurrent(change)}
              </p>
              {proposed !== null && <p className="text-emerald-900 break-all">{proposed}</p>}
            </div>
            <div className="flex gap-1 shrink-0">
              <button
                type="button"
                disabled={disabled}
                aria-pressed={!rejected}
                aria-label={`Accept link change ${index + 1}`}
                onClick={() => rejected && onToggle(change.suggestion_id)}
                className={`px-2 py-1 rounded-lg border ${rejected ? "" : "bg-emerald-600 text-white"}`}
              >
                Accept
              </button>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={rejected}
                aria-label={`Reject link change ${index + 1}`}
                onClick={() => !rejected && onToggle(change.suggestion_id)}
                className={`px-2 py-1 rounded-lg border ${rejected ? "bg-red-600 text-white" : ""}`}
              >
                Reject
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
