"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Song,
  RefusedCatalogField,
  SongLink,
  SongStatus,
  SongUpdateResult,
  Repertoire,
} from "@/types/database";
import { ALL_STATUSES, STATUS_CONFIG } from "@/lib/statusConfig";
import {
  catalogDraftFromRefusals,
  catalogDraftFromSong,
  isCatalogFieldEmpty,
  parseDurationInput,
  type CatalogColumn,
  type CatalogDraft,
} from "@/lib/catalogFields";
import { useRepertoireStore } from "@/store/repertoireStore";
import { CatalogRefusalNotice } from "./CatalogRefusalNotice";
import { CorrectionModal, type CorrectionModalProps } from "./CorrectionModal";
import { SharedCatalogField } from "./SharedCatalogField";
import { SongLinksEditor, type EditableLink } from "./SongLinksEditor";

type SongFormCreateInput = {
  title: string;
  artist: string;
  album?: string;
  standard_key?: string;
  cover_url?: string;
  duration_seconds?: number;
  links?: SongLink[];
};

type SongFormEditInput = {
  title: string;
  artist: string;
  album?: string | null;
  key: string | null;
  status: SongStatus;
  tags: string[];
  links: SongLink[];
  cover_url?: string | null;
  duration_seconds?: number | null;
};

/**
 * The Server Actions the form and its correction modal call. Injected rather
 * than imported, so `src/components` never points back into `src/app` (F21).
 */
export interface SongFormActions {
  createAndAddSong: (data: SongFormCreateInput) => Promise<Repertoire>;
  updateSong: (entry: Repertoire, data: SongFormEditInput) => Promise<SongUpdateResult>;
  updateSongStatus: (repertoireId: string, status: SongStatus) => Promise<void>;
  updateSongTags: (repertoireId: string, tags: string[]) => Promise<void>;
  submitCatalogSuggestion: CorrectionModalProps["onSubmitCorrection"];
}

interface SongFormProps {
  song?: Repertoire;
  onClose: () => void;
  onSuccess: () => void;
  actions: SongFormActions;
}

interface FormState {
  title: string;
  artist: string;
  album: string;
  key: string;
  cover_url: string;
  youtube_url: string;
  duration: string;
  status: SongStatus;
  tagsInput: string;
  links: EditableLink[];
}

/** What a "Suggest a correction" control opens the modal with. */
type CorrectionRequest = {
  focusField?: CatalogColumn;
  prefill?: Partial<CatalogDraft>;
};

// Helper re-exported so the dialog can call parseTags without duplication
export const parseTags = (raw: string): string[] => {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
};

const extractYoutubeAndOtherLinks = (
  links: SongLink[],
): { youtubeUrl: string; otherLinks: Array<SongLink & { id: string }> } => {
  const allLinks = links ? [...links] : [];
  const youtubeLink = allLinks.find((l) => l.label.toLowerCase() === "youtube");
  const filteredLinks = allLinks.filter(
    (l) => l.label.toLowerCase() !== "youtube",
  );
  return {
    youtubeUrl: youtubeLink?.url ?? "",
    otherLinks: filteredLinks.map((l) => ({
      ...l,
      id: l.url || crypto.randomUUID(),
    })),
  };
};

const mapFormFields = (
  song: Repertoire,
  inner: Song,
  youtubeUrl: string,
  otherLinks: Array<SongLink & { id: string }>,
): FormState => {
  return {
    title: inner.title,
    artist: inner.artist,
    album: inner.album ?? "",
    key: song.key ?? inner.standard_key ?? "",
    cover_url: inner.cover_url ?? "",
    youtube_url: youtubeUrl,
    duration:
      inner.duration_seconds != null ? String(inner.duration_seconds) : "",
    status: song.status ?? "unknown",
    tagsInput: song.tags ? song.tags.join(", ") : "",
    links: otherLinks,
  };
};

const buildInitialState = (song?: Repertoire): FormState => {
  const stateMap: Record<string, () => FormState> = {
    NO_SONG: () => ({
      title: "",
      artist: "",
      album: "",
      key: "",
      cover_url: "",
      youtube_url: "",
      duration: "",
      status: "unknown",
      tagsInput: "",
      links: [],
    }),
    NO_INNER: () => ({
      title: "",
      artist: "",
      album: "",
      key: song?.key ?? "",
      cover_url: "",
      youtube_url: "",
      duration: "",
      status: song?.status ?? "unknown",
      tagsInput: song?.tags ? song.tags.join(", ") : "",
      links: [],
    }),
    FULL: () => {
      const inner = song!.song!;
      const { youtubeUrl, otherLinks } = extractYoutubeAndOtherLinks(
        song!.song!.links,
      );
      return mapFormFields(song!, inner, youtubeUrl, otherLinks);
    },
  };

  const key = !song ? "NO_SONG" : !song.song ? "NO_INNER" : "FULL";

  return stateMap[key]();
};

/** The shared text columns the form renders through `SharedCatalogField`. */
type SharedTextColumn = "title" | "artist" | "album" | "cover_url" | "duration_seconds";

/**
 * What the catalog holds for one shared text field, in `SharedCatalogField`'s
 * three-state vocabulary: `null` when there is no catalog row yet, `""` when
 * the row leaves the column blank (so it stays editable — filling a blank
 * overwrites nobody), the value itself otherwise.
 */
const sharedText = (
  catalog: Song | null,
  column: SharedTextColumn,
): string | null => {
  if (!catalog) return null;
  if (isCatalogFieldEmpty(catalog, column)) return "";
  const draft = catalogDraftFromSong(catalog);
  if (column === "duration_seconds") return draft.duration;
  return draft[column];
};

/**
 * The catalog row behind a repertoire entry, or `null` in create mode.
 *
 * Module scope, like the two payload builders below: `SongForm` sits exactly at
 * its F20 `complexity` ceiling, and the ratchet may only shrink, so a decision
 * that does not need the component's state is made outside it.
 */
const catalogOf = (song?: Repertoire): Song | null => song?.song ?? null;

/** The links fieldset follows the catalog rule as a unit, like the `links` column itself. */
const areLinksLocked = (catalog: Song | null): boolean =>
  catalog !== null && !isCatalogFieldEmpty(catalog, "links");

const editPayload = (form: FormState, links: SongLink[]): SongFormEditInput => ({
  title: form.title.trim(),
  artist: form.artist.trim(),
  album: form.album.trim() || null,
  key: form.key.trim() || null,
  cover_url: form.cover_url.trim() || null,
  duration_seconds: parseDurationInput(form.duration),
  status: form.status,
  tags: parseTags(form.tagsInput),
  links,
});

const createPayload = (form: FormState, links: SongLink[]): SongFormCreateInput => ({
  title: form.title.trim(),
  artist: form.artist.trim(),
  album: form.album.trim() || undefined,
  standard_key: form.key.trim() || undefined,
  cover_url: form.cover_url.trim() || undefined,
  duration_seconds: parseDurationInput(form.duration) ?? undefined,
  links,
});

export default function SongForm({
  song,
  onClose,
  onSuccess,
  actions,
}: SongFormProps) {
  const isEditMode = Boolean(song);
  const catalog = catalogOf(song);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { loadSongs } = useRepertoireStore();

  const [form, setForm] = useState<FormState>(() => buildInitialState(song));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [correction, setCorrection] = useState<CorrectionRequest | null>(null);
  const [refused, setRefused] = useState<RefusedCatalogField[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const linksLocked = areLinksLocked(catalog);

  // Open dialog on mount, close on backdrop click
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) onClose();
  };

  // ---- field helpers ----

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // ---- submit ----

  /** The links to propose: the catalog's own when they are locked, so an untouched save proposes nothing. */
  const submittedLinks = (): SongLink[] => {
    if (linksLocked) return catalog!.links;
    const links = form.links
      .map(({ label, url }) => ({ label, url }))
      .filter((l) => l.url.trim());
    if (!form.youtube_url.trim()) return links;
    return [{ label: "YouTube", url: form.youtube_url.trim() }, ...links];
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }

    setSubmitting(true);

    try {
      const links = submittedLinks();

      if (isEditMode && song) {
        const result = await actions.updateSong(song, editPayload(form, links));
        await loadSongs();
        // A refused shared column is not a plain success: stay open and say so.
        if (result?.refused?.length) {
          setRefused(result.refused);
          return;
        }
      } else {
        const tags = parseTags(form.tagsInput);
        const entry = await actions.createAndAddSong(createPayload(form, links));
        // Apply status and tags after creation
        await Promise.all([
          form.status !== "unknown"
            ? actions.updateSongStatus(entry.id, form.status)
            : Promise.resolve(),
          tags.length > 0
            ? actions.updateSongTags(entry.id, tags)
            : Promise.resolve(),
        ]);
        await loadSongs();
      }

      onSuccess();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      aria-label={isEditMode ? "Edit song" : "Add song"}
      className="w-full max-w-lg rounded-2xl p-0 shadow-xl backdrop:bg-black/50 open:flex open:flex-col"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900">
          {isEditMode ? "Edit song" : "Add song"}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-gray-400 hover:text-gray-600 transition-colors text-xl leading-none"
        >
          &times;
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="overflow-y-auto px-6 py-5 flex flex-col gap-5 max-h-[80vh]"
      >
        <CatalogRefusalNotice
          refused={refused}
          onSuggest={() => setCorrection({ prefill: catalogDraftFromRefusals(refused) })}
        />

        <SharedCatalogField
          id="sf-title"
          label="Title"
          catalogValue={sharedText(catalog, "title")}
          value={form.title}
          onChange={(v) => setField("title", v)}
          onSuggest={() => setCorrection({ focusField: "title" })}
          placeholder="Song name"
        />

        <SharedCatalogField
          id="sf-artist"
          label="Artist"
          catalogValue={sharedText(catalog, "artist")}
          value={form.artist}
          onChange={(v) => setField("artist", v)}
          onSuggest={() => setCorrection({ focusField: "artist" })}
          placeholder="Artist name"
        />

        <SharedCatalogField
          id="sf-album"
          label="Album"
          catalogValue={sharedText(catalog, "album")}
          value={form.album}
          onChange={(v) => setField("album", v)}
          onSuggest={() => setCorrection({ focusField: "album" })}
          placeholder="Album name"
        />

        {/* Key — personal, so always editable; the catalog's key sits beside it. */}
        <div className="flex flex-col gap-1">
          <label htmlFor="sf-key" className="text-sm font-medium text-gray-700">
            Key
          </label>
          <div className="flex items-center gap-3">
            <input
              id="sf-key"
              type="text"
              value={form.key}
              onChange={(e) => setField("key", e.target.value)}
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
                onClick={() => setCorrection({ focusField: "standard_key" })}
                aria-label="Suggest a correction to the catalog key"
                className="text-[11px] font-medium text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 px-2 py-1 rounded-lg transition-colors"
              >
                Suggest a correction
              </button>
            </div>
          )}
        </div>

        <SharedCatalogField
          id="sf-duration"
          label="Duration"
          catalogValue={sharedText(catalog, "duration_seconds")}
          value={form.duration}
          onChange={(v) => setField("duration", v)}
          onSuggest={() => setCorrection({ focusField: "duration_seconds" })}
          placeholder="ex: 3:45 ou 225"
          inputClassName="w-32"
        />

        <SharedCatalogField
          id="sf-cover-url"
          label="Cover Image URL"
          catalogValue={sharedText(catalog, "cover_url")}
          value={form.cover_url}
          onChange={(v) => setField("cover_url", v)}
          onSuggest={() => setCorrection({ focusField: "cover_url" })}
          type="url"
          placeholder="https://..."
        >
          {form.cover_url.trim() && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={form.cover_url.trim()}
              alt="Cover preview"
              className="mt-1 h-16 w-16 rounded object-cover"
            />
          )}
        </SharedCatalogField>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-gray-700">Status</legend>

          <div className="flex flex-wrap gap-2" role="radiogroup">
            {ALL_STATUSES.map((s) => {
              const cfg = STATUS_CONFIG[s];
              const checked = form.status === s;
              return (
                <label key={s} className="cursor-pointer">
                  <input
                    type="radio"
                    name="sf-status"
                    value={s}
                    checked={checked}
                    onChange={() => setField("status", s)}
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
            value={form.tagsInput}
            onChange={(e) => setField("tagsInput", e.target.value)}
            placeholder="bossa nova, 80s, samba (comma-separated)"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          {form.tagsInput && (
            <ul className="flex flex-wrap gap-1.5 mt-1" aria-label="Tag preview">
              {parseTags(form.tagsInput).map((tag) => (
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

        {/* Links — the catalog's own when it has any, editable while it has none. */}
        {linksLocked ? (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-700">Links</span>
            <ul className="flex flex-col gap-1" aria-label="Catalog links">
              {catalog!.links.map((link) => (
                <li key={link.url} className="text-sm text-gray-900 break-all">
                  {link.label || link.url}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setCorrection({ focusField: "links" })}
              aria-label="Suggest a correction to Links"
              className="self-start mt-1 text-[11px] font-medium text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 px-2 py-1 rounded-lg transition-colors"
            >
              Suggest a correction
            </button>
          </div>
        ) : (
          <>
            {/* YouTube Link */}
            <div className="flex flex-col gap-1">
              <label htmlFor="sf-youtube" className="text-sm font-medium text-gray-700">YouTube Link</label>
              <input
                id="sf-youtube"
                type="url"
                value={form.youtube_url}
                onChange={(e) => setField("youtube_url", e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <SongLinksEditor
              links={form.links}
              onChange={(links) => setField("links", links)}
            />
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Footer buttons */}
        <div className="flex justify-between items-center gap-3 pt-2 border-t border-gray-100">
          {isEditMode && catalog && (
            <button
              type="button"
              onClick={() => setCorrection({})}
              className="text-xs font-medium text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1"
            >
              ✏️ Correct Global Info
            </button>
          )}
          <div className="flex gap-3 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Saving..." : isEditMode ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </form>

      {correction && catalog && (
        <CorrectionModal
          song={catalog}
          prefill={correction.prefill}
          focusField={correction.focusField}
          onSubmitCorrection={actions.submitCatalogSuggestion}
          onClose={() => setCorrection(null)}
          onSuccess={() => {
            setToastMessage("Correction request submitted for admin review!");
            setTimeout(() => setToastMessage(null), 4000);
          }}
        />
      )}

      {toastMessage && (
        <div className="fixed bottom-4 right-4 z-50 rounded-xl bg-emerald-900 text-emerald-100 px-4 py-3 text-sm shadow-xl border border-emerald-700">
          {toastMessage}
        </div>
      )}
    </dialog>
  );
}
