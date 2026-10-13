"use client";

import type { LinkDraftRow } from "@/lib/catalogFields";

interface CorrectionLinkRowsProps {
  rows: LinkDraftRow[];
  onChange: (rows: LinkDraftRow[]) => void;
  /** The link row that was clicked, focused on open. */
  focusLinkId?: string;
}

const INPUT_CLASS =
  "rounded-lg border border-gray-300 px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-50 disabled:text-gray-400 disabled:line-through";

/**
 * The correction form's links block (RH-138): the catalog's own link rows, keyed
 * by their stable id, each with an editable label and url and a Remove / Undo
 * control. There is deliberately no way to add a row here — additions stay
 * direct — and a row left alone sends nothing.
 */
export function CorrectionLinkRows({ rows, onChange, focusLinkId }: CorrectionLinkRowsProps) {
  if (rows.length === 0) return null;

  const patch = (id: string, change: Partial<LinkDraftRow>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...change } : row)));

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs font-semibold text-gray-700">Links - decide each row</legend>
      <ul className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <li
            key={row.id}
            data-link-id={row.id}
            className="flex flex-col gap-1.5 rounded-xl border border-gray-200 p-2"
          >
            <input
              type="text"
              aria-label={`Label for link ${index + 1}`}
              value={row.label}
              disabled={row.removed}
              onChange={(e) => patch(row.id, { label: e.target.value })}
              placeholder="Label"
              className={INPUT_CLASS}
            />
            <input
              type="url"
              aria-label={`URL for link ${index + 1}`}
              value={row.url}
              disabled={row.removed}
              autoFocus={focusLinkId === row.id}
              onChange={(e) => patch(row.id, { url: e.target.value })}
              placeholder="https://..."
              className={INPUT_CLASS}
            />
            <button
              type="button"
              onClick={() => patch(row.id, { removed: !row.removed })}
              className={`self-start text-[11px] px-2 py-0.5 rounded border ${
                row.removed ? "bg-white text-gray-700" : "text-red-700 border-red-200"
              }`}
            >
              {row.removed ? "Undo remove" : "Remove this link"}
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
