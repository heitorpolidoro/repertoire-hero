"use client";

import type { Song, SongStatus } from "@/types/database";
import { ALL_STATUSES, STATUS_CONFIG } from "@/lib/statusConfig";
import { LastPracticedField } from "./LastPracticedField";

/** The form values the "My repertoire" section edits. */
export interface RepertoireFormValues {
  key: string;
  status: SongStatus;
  tagsInput: string;
}

/** Splits the comma-separated tags input into trimmed, non-empty tags. */
export const parseTags = (raw: string): string[] => {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
};

interface SongFormRepertoireSectionProps {
  /** The catalog row behind the entry, or `null` in create mode. */
  catalog: Song | null;
  values: RepertoireFormValues;
  isEditMode: boolean;
  practiced: string;
  onPracticedChange: (value: string) => void;
  onPatch: (patch: Partial<RepertoireFormValues>) => void;
  onSuggestKey: () => void;
}

/** The "My repertoire" group: the owner's own key, status, tags and practice date. */
export function SongFormRepertoireSection({
  catalog,
  values,
  isEditMode,
  practiced,
  onPracticedChange,
  onPatch,
  onSuggestKey,
}:SongFormRepertoireSectionProps) {
  return (
    <section aria-labelledby="sf-repertoire-heading" className="flex flex-col gap-5">
      <h3 id="sf-repertoire-heading" className="text-sm font-semibold text-gray-900">
        My repertoire
      </h3>

      {/* Key — personal, so always editable; the catalog's key sits beside it. */}
      <div className="flex flex-col gap-1">
        <label htmlFor="sf-key" className="text-sm font-medium text-gray-700">
          Key
        </label>
        <div className="flex items-center gap-3">
          <input
            id="sf-key"
            type="text"
            value={values.key}
            onChange={(e) => onPatch({ key: e.target.value })}
            placeholder="ex: Am, G, C#"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 w-32"
          />
          <span className="text-xs text-gray-500">your key</span>
        </div>
        {catalog?.standard_key && (
          <div className="flex items-center justify-between gap-3 mt-1">
            <p className="text-xs text-gray-600">
              Catalog key:{" "}
              <span className="font-medium text-gray-900">
                {catalog.standard_key}
              </span>
            </p>
            <button
              type="button"
              onClick={onSuggestKey}
              aria-label="Suggest a correction to the catalog key"
              className="text-[11px] font-medium text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 px-2 py-1 rounded-lg transition-colors"
            >
              Suggest a correction
            </button>
          </div>
        )}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-gray-700">Status</legend>

        <div className="flex flex-wrap gap-2" role="radiogroup">
          {ALL_STATUSES.map((s) => {
            const cfg = STATUS_CONFIG[s];
            const checked = values.status === s;
            return (
              <label key={s} className="cursor-pointer">
                <input
                  type="radio"
                  name="sf-status"
                  value={s}
                  checked={checked}
                  onChange={() => onPatch({ status: s })}
                  className="sr-only"
                />
                <span
                  className={`inline-block px-3 py-1 rounded-full text-xs font-medium border-2 transition-colors ${cfg.bgColor} ${cfg.textColor} ${
                    checked ? "border-current" : "border-transparent"
                  }`}
                >
                  {cfg.label}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="sf-tags" className="text-sm font-medium text-gray-700">Tags</label>
        <input
          id="sf-tags"
          type="text"
          value={values.tagsInput}
          onChange={(e) => onPatch({ tagsInput: e.target.value })}
          placeholder="bossa nova, 80s, samba (comma-separated)"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        {values.tagsInput && (
          <ul className="flex flex-wrap gap-1.5 mt-1" aria-label="Tag preview">
            {parseTags(values.tagsInput).map((tag) => (
              <li
                key={tag}
                className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs"
              >
                {tag}
              </li>
            ))}
          </ul>
        )}
      </div>

      <LastPracticedField visible={isEditMode} value={practiced} onChange={onPracticedChange} />
    </section>
  );
}
