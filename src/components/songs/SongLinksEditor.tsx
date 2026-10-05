"use client";

import type { SongLink } from "@/types/database";

/** A link row being edited. `id` is a React key, not a stored value. */
export type EditableLink = SongLink & { id?: string };

interface SongLinksEditorProps {
  links: EditableLink[];
  onChange: (links: EditableLink[]) => void;
}

/**
 * The link-rows editor, extracted from `SongForm` (RH-97) so `CorrectionModal`
 * can offer `links` too without a second copy of the markup — `jscpd` runs at
 * `minTokens: 50` / `minLines: 8` and two copies of this would trip it.
 *
 * It owns no state: the caller holds the list, which is what lets the song form
 * keep sending it to `updateSong` and the correction modal diff it against the
 * catalog's own links.
 */
export function SongLinksEditor({ links, onChange }: SongLinksEditorProps) {
  const updateLink = (index: number, field: keyof SongLink, value: string) => {
    onChange(
      links.map((link, i) => (i === index ? { ...link, [field]: value } : link)),
    );
  };

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-medium text-gray-700">Links</legend>
      {links.map((link, idx) => (
        <div key={link.id || idx} className="flex gap-2 items-start">
          <div className="flex flex-col gap-1 flex-1">
            <input
              type="text"
              value={link.label}
              onChange={(e) => updateLink(idx, "label", e.target.value)}
              placeholder="Label (e.g. YouTube, Chords)"
              aria-label={`Label for link ${idx + 1}`}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <input
              type="url"
              value={link.url}
              onChange={(e) => updateLink(idx, "url", e.target.value)}
              placeholder="https://"
              aria-label={`URL for link ${idx + 1}`}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <button
            type="button"
            onClick={() => onChange(links.filter((_, i) => i !== idx))}
            aria-label={`Remove link ${idx + 1}`}
            className="mt-1 text-gray-400 hover:text-red-500 transition-colors text-lg leading-none shrink-0"
          >
            &times;
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([...links, { label: "", url: "", id: crypto.randomUUID() }])
        }
        className="self-start text-sm font-medium text-emerald-600 hover:text-emerald-800 transition-colors"
      >
        + Add link
      </button>
    </fieldset>
  );
}
