"use client";

import type { Song } from "@/types/database";
import {
  catalogDraftFromSong,
  isCatalogFieldEmpty,
  type CatalogColumn,
} from "@/lib/catalogFields";
import { LockedLinksList } from "./LockedLinksList";
import { SharedCatalogField } from "./SharedCatalogField";
import { SongLinksEditor, type EditableLink } from "./SongLinksEditor";

/** The form values the shared catalog section edits. */
export interface CatalogFormValues {
  title: string;
  artist: string;
  album: string;
  cover_url: string;
  youtube_url: string;
  duration: string;
  links: EditableLink[];
}

/** What a "Suggest a correction" control inside the section asks the form to open. */
export type CatalogSuggestRequest = {
  focusField?: CatalogColumn;
  focusLinkId?: string;
};

/** The shared text columns the section renders through `SharedCatalogField`. */
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

interface SongFormCatalogSectionProps {
  /** The catalog row behind the entry, or `null` in create mode. */
  catalog: Song | null;
  values: CatalogFormValues;
  /** The links fieldset is locked as a unit once the catalog holds any `song_links` row. */
  linksLocked: boolean;
  onPatch: (patch: Partial<CatalogFormValues>) => void;
  onSuggest: (request: CatalogSuggestRequest) => void;
}

/**
 * The "Shared catalog" group: the fields every musician sees, which a form can
 * only fill while empty (RH-97). The sentence below states that rule once, for
 * the whole group; each field still carries its own message.
 */
export function SongFormCatalogSection({
  catalog,
  values,
  linksLocked,
  onPatch,
  onSuggest,
}:SongFormCatalogSectionProps) {
  return (
    <section aria-labelledby="sf-catalog-heading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h3 id="sf-catalog-heading" className="text-sm font-semibold text-gray-900">
          Shared catalog
        </h3>
        <p className="text-xs text-gray-500">
          Shared with everyone. An empty field can be filled in; a field that already has a
          value is never overwritten — use Suggest a correction.
        </p>
      </div>

      <SharedCatalogField
        id="sf-title"
        label="Title"
        catalogValue={sharedText(catalog, "title")}
        value={values.title}
        onChange={(v) => onPatch({ title: v })}
        onSuggest={() => onSuggest({ focusField: "title" })}
        placeholder="Song name"
      />

      <SharedCatalogField
        id="sf-artist"
        label="Artist"
        catalogValue={sharedText(catalog, "artist")}
        value={values.artist}
        onChange={(v) => onPatch({ artist: v })}
        onSuggest={() => onSuggest({ focusField: "artist" })}
        placeholder="Artist name"
      />

      <SharedCatalogField
        id="sf-album"
        label="Album"
        catalogValue={sharedText(catalog, "album")}
        value={values.album}
        onChange={(v) => onPatch({ album: v })}
        onSuggest={() => onSuggest({ focusField: "album" })}
        placeholder="Album name"
      />

      <SharedCatalogField
        id="sf-duration"
        label="Duration"
        catalogValue={sharedText(catalog, "duration_seconds")}
        value={values.duration}
        onChange={(v) => onPatch({ duration: v })}
        onSuggest={() => onSuggest({ focusField: "duration_seconds" })}
        placeholder="ex: 3:45 ou 225"
        inputClassName="w-32"
      />

      <SharedCatalogField
        id="sf-cover-url"
        label="Cover Image URL"
        catalogValue={sharedText(catalog, "cover_url")}
        value={values.cover_url}
        onChange={(v) => onPatch({ cover_url: v })}
        onSuggest={() => onSuggest({ focusField: "cover_url" })}
        type="url"
        placeholder="https://..."
      >
        {values.cover_url.trim() && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={values.cover_url.trim()}
            alt="Cover preview"
            className="mt-1 h-16 w-16 rounded object-cover"
          />
        )}
      </SharedCatalogField>

      {/* Links — the catalog's own when it has any, editable while it has none. */}
      {linksLocked ? (
        <LockedLinksList
          links={catalog!.links}
          onSuggest={(linkId) => onSuggest({ focusLinkId: linkId })}
        />
      ) : (
        <>
          {/* YouTube Link */}
          <div className="flex flex-col gap-1">
            <label htmlFor="sf-youtube" className="text-sm font-medium text-gray-700">YouTube Link</label>
            <input
              id="sf-youtube"
              type="url"
              value={values.youtube_url}
              onChange={(e) => onPatch({ youtube_url: e.target.value })}
              placeholder="https://youtube.com/watch?v=..."
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <SongLinksEditor
            links={values.links}
            onChange={(links) => onPatch({ links })}
          />
        </>
      )}
    </section>
  );
}
