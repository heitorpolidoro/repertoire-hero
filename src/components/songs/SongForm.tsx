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
import {
  catalogDraftFromRefusals,
  parseDurationInput,
  type CatalogDraft,
} from "@/lib/catalogFields";
import { useRepertoireStore } from "@/store/repertoireStore";
import { CatalogRefusalNotice } from "./CatalogRefusalNotice";
import { CorrectionModal, type CorrectionModalProps } from "./CorrectionModal";
import { lastPracticedDraft, lastPracticedPatch } from "./LastPracticedField";
import {
  SongFormCatalogSection,
  type CatalogFormValues,
  type CatalogSuggestRequest,
} from "./SongFormCatalogSection";
import {
  SongFormRepertoireSection,
  parseTags,
  type RepertoireFormValues,
} from "./SongFormRepertoireSection";

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
  last_practiced?: string | null;
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

/** The catalog half and the repertoire half the two sections edit, side by side. */
type FormState = CatalogFormValues & RepertoireFormValues;

/** What a "Suggest a correction" control opens the modal with. */
type CorrectionRequest = CatalogSuggestRequest & {
  prefill?: Partial<CatalogDraft>;
};

const extractYoutubeAndOtherLinks = (
  links: SongLink[],
): { youtubeUrl: string; otherLinks: Array<SongLink & { id: string }> } => {
  const allLinks = links ? [...links] : [];
  const youtubeLink = allLinks.find((l) => l.label.toLowerCase() === "youtube");
  const filteredLinks = allLinks.filter((l) => l.label.toLowerCase() !== "youtube");
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

/** The catalog row behind a repertoire entry, or `null` in create mode. */
const catalogOf = (song?: Repertoire): Song | null => song?.song ?? null;

/** The links fieldset is locked as a unit once the catalog holds any `song_links` row. */
const areLinksLocked = (catalog: Song | null): boolean =>
  catalog !== null && (catalog.links?.length ?? 0) > 0;

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
  const [practiced, setPracticed] = useState(() => lastPracticedDraft(song));
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

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) =>
    e.target === dialogRef.current && onClose();

  // ---- field helpers ----

  const patchForm = (patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
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
        const result = await actions.updateSong(song, { ...editPayload(form, links), ...lastPracticedPatch(practiced, song) });
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
        <h2 className="text-lg font-semibold text-gray-900">{isEditMode ? "Edit song" : "Add song"}</h2>
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

        <SongFormCatalogSection
          catalog={catalog}
          values={form}
          linksLocked={linksLocked}
          onPatch={patchForm}
          onSuggest={setCorrection}
        />

        <SongFormRepertoireSection
          catalog={catalog}
          values={form}
          isEditMode={isEditMode}
          practiced={practiced}
          onPracticedChange={setPracticed}
          onPatch={patchForm}
          onSuggestKey={() => setCorrection({ focusField: "standard_key" })}
        />

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
          focusLinkId={correction.focusLinkId}
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
