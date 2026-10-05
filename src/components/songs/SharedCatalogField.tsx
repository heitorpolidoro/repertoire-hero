"use client";

import type { ReactNode } from "react";

interface SharedCatalogFieldProps {
  id: string;
  label: string;
  /**
   * What the shared catalog holds for this column right now.
   *
   * Three states, and they are not the same thing:
   *   - a non-empty string — the catalog has a value, so it renders as plain
   *     text with a "Suggest a correction" control and no input at all;
   *   - `""` — the catalog row exists but this column is blank, so the field is
   *     editable and says so: filling it in adds the value for everyone;
   *   - `null` — there is no catalog row yet (the form is creating the song),
   *     so the field is simply editable.
   */
  catalogValue: string | null;
  /** The draft value, used only while the field is editable. */
  value: string;
  onChange: (value: string) => void;
  onSuggest: () => void;
  type?: string;
  placeholder?: string;
  inputClassName?: string;
  /** Rendered under the input while it is editable — e.g. the cover preview. */
  children?: ReactNode;
}

/**
 * One shared `global_songs` field in the song form (RH-97).
 *
 * The catalog is a wiki: a blank may be filled by anyone, a value may not be
 * overwritten by one repertoire owner. `updateSong` has always enforced that
 * and used to report success anyway; this component is the form telling the
 * truth about it instead — the populated case is a fact being stated, not a box
 * someone forgot to enable, and its correction route is `CorrectionModal`.
 */
export function SharedCatalogField({
  id,
  label,
  catalogValue,
  value,
  onChange,
  onSuggest,
  type = "text",
  placeholder,
  inputClassName = "",
  children,
}: SharedCatalogFieldProps) {
  if (catalogValue !== null && catalogValue !== "") {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-gray-900 font-medium pt-0.5 break-all">
            {catalogValue}
          </p>
          <button
            type="button"
            onClick={onSuggest}
            aria-label={`Suggest a correction to ${label}`}
            className="shrink-0 text-[11px] font-medium text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 px-2 py-1 rounded-lg transition-colors"
          >
            Suggest a correction
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 ${inputClassName}`}
      />
      {catalogValue === "" && (
        <p className="text-[11px] text-gray-500">
          The catalog has no {label.toLowerCase()} for this song yet — filling it
          in adds it for everyone.
        </p>
      )}
      {children}
    </div>
  );
}
