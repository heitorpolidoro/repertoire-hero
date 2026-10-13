"use client";

import { useState } from "react";
import type { Song } from "@/types/database";
import {
  catalogDraftFromSong,
  changedCatalogFields,
  changedLinkRows,
  linkDraftFromSong,
  type CatalogColumn,
  type CatalogDraft,
  type LinkChangeInput,
  type LinkDraftRow,
} from "@/lib/catalogFields";
import { CorrectionLinkRows } from "./CorrectionLinkRows";
import { CorrectionModalHeader } from "./CorrectionModalHeader";

/**
 * The correction payload. A `type` alias, not an `interface`: only an alias gets
 * an implicit index signature, and without one it cannot be passed to a
 * `Record<string, unknown>` parameter (see the action's signature).
 *
 * Every catalog column is optional because only the ones the user actually
 * changed are sent (RH-97): `parseCatalogSuggestionPayload` accepts any non-empty
 * subset, and a queue row naming one column is what RH-107's one-row-per-field
 * model stores. `linkChanges` (RH-138) names the link rows touched, each by its
 * `song_links.id` and only what changed on it.
 */
export type SongCorrectionInput = {
  title?: string;
  artist?: string;
  album?: string | null;
  standard_key?: string | null;
  cover_url?: string | null;
  duration_seconds?: number | null;
  linkChanges?: LinkChangeInput[];
  reason: string | null;
};

export interface CorrectionModalProps {
  song: Song;
  /**
   * Values to open with instead of the catalog's own — the proposals a save was
   * refused on, so nothing has to be retyped. They still count as changes,
   * because they are compared against the catalog row, not against this.
   */
  prefill?: Partial<CatalogDraft>;
  /** The field that was clicked, focused on open. */
  focusField?: CatalogColumn;
  /** The link row that was clicked, focused on open. */
  focusLinkId?: string;
  onClose: () => void;
  onSuccess: () => void;
  /** The injected catalog-correction Server Action — `src/components` never imports `@/app` (F21). */
  onSubmitCorrection: (songId: string, data: SongCorrectionInput) => Promise<unknown>;
}

const INPUT_CLASS =
  "rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500";

export function CorrectionModal({
  song,
  prefill,
  focusField,
  focusLinkId,
  onClose,
  onSuccess,
  onSubmitCorrection,
}: CorrectionModalProps) {
  // The catalog row as it stands is the baseline every change is measured
  // against, so it is computed once and never follows the draft.
  const [base] = useState<CatalogDraft>(() => catalogDraftFromSong(song));
  const [baseLinks] = useState<LinkDraftRow[]>(() => linkDraftFromSong(song.links));
  const [linkRows, setLinkRows] = useState<LinkDraftRow[]>(baseLinks);
  const [draft, setDraft] = useState<CatalogDraft>(() => ({
    ...catalogDraftFromSong(song),
    ...prefill,
  }));
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CatalogDraft>(key: K, value: CatalogDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim() || !draft.artist.trim()) {
      setError("Title and artist are required.");
      return;
    }

    const changed = changedCatalogFields(base, draft);
    const linkChanges = changedLinkRows(baseLinks, linkRows);
    if (Object.keys(changed).length === 0 && linkChanges.length === 0) {
      setError("Change at least one value to suggest a correction.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await onSubmitCorrection(song.id, {
        ...changed,
        ...(linkChanges.length > 0 ? { linkChanges } : {}),
        reason: reason.trim() || null,
      });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit correction request.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      open
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 w-full h-full border-none backdrop-blur-xs"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl flex flex-col gap-4 text-gray-900 border border-gray-100">
        <CorrectionModalHeader onClose={onClose} />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="cm-title" className="text-xs font-semibold text-gray-700">Song Title</label>
            <input
              id="cm-title"
              type="text"
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
              autoFocus={focusField === "title"}
              required
              className={INPUT_CLASS}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="cm-artist" className="text-xs font-semibold text-gray-700">Artist</label>
            <input
              id="cm-artist"
              type="text"
              value={draft.artist}
              onChange={(e) => set("artist", e.target.value)}
              autoFocus={focusField === "artist"}
              required
              className={INPUT_CLASS}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="cm-album" className="text-xs font-semibold text-gray-700">Album</label>
              <input
                id="cm-album"
                type="text"
                value={draft.album}
                onChange={(e) => set("album", e.target.value)}
                autoFocus={focusField === "album"}
                className={INPUT_CLASS}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="cm-standard-key" className="text-xs font-semibold text-gray-700">Standard Key</label>
              <input
                id="cm-standard-key"
                type="text"
                value={draft.standard_key}
                onChange={(e) => set("standard_key", e.target.value)}
                autoFocus={focusField === "standard_key"}
                placeholder="e.g. Am, G#"
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="cm-cover-url" className="text-xs font-semibold text-gray-700">Cover Image URL</label>
              <input
                id="cm-cover-url"
                type="url"
                value={draft.cover_url}
                onChange={(e) => set("cover_url", e.target.value)}
                autoFocus={focusField === "cover_url"}
                placeholder="https://..."
                className={INPUT_CLASS}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="cm-duration" className="text-xs font-semibold text-gray-700">Duration</label>
              <input
                id="cm-duration"
                type="text"
                value={draft.duration}
                onChange={(e) => set("duration", e.target.value)}
                autoFocus={focusField === "duration_seconds"}
                placeholder="ex: 3:45 or 225"
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <CorrectionLinkRows rows={linkRows} onChange={setLinkRows} focusLinkId={focusLinkId} />

          <div className="flex flex-col gap-1">
            <label htmlFor="cm-reason" className="text-xs font-semibold text-gray-700">Reason / Notes for Admin (Optional)</label>
            <input
              id="cm-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Corrected typo in artist name"
              className={INPUT_CLASS}
            />
          </div>

          {error && (
            <p role="alert" className="text-xs text-red-600 bg-red-50 rounded-lg p-2.5">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-60"
            >
              {submitting ? "Submitting..." : "Submit for Moderation"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
