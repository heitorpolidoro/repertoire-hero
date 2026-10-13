"use client";

import type { ReactNode } from "react";
import { useManualEntry, type ManualEntryActions } from "@/hooks/useManualEntry";
import { ALL_STATUSES, STATUS_CONFIG } from "@/lib/statusConfig";
import type { SongStatus } from "@/types/database";
import { SongLinksEditor } from "./SongLinksEditor";

interface ManualEntryPanelProps {
  actions: ManualEntryActions;
  /** The search box value; Title is pre-filled from it. */
  query: string;
  onAdded: () => Promise<void>;
}

const INPUT_CLASS =
  "w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500";

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-gray-600">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * RH-152 - the reduced manual-entry form under the search results: Title,
 * Artist, Album and Status always, Key, Duration, Cover and Links behind a
 * "More details" disclosure (closed fields are not rendered; their values live
 * in the controller). An existing title and artist turns the submit into an
 * add-as-new-version offer.
 */
export function ManualEntryPanel({ actions, query, onAdded }: ManualEntryPanelProps) {
  const entry = useManualEntry({ actions, query, onAdded });
  const { draft, setField } = entry;

  const text = (id: string, key: "artist" | "album" | "key" | "duration" | "cover", extra = {}) => (
    <input
      id={id}
      type="text"
      value={draft[key]}
      onChange={(e) => setField(key, e.target.value)}
      className={INPUT_CLASS}
      {...extra}
    />
  );

  return (
    <form
      aria-label="Add manually"
      className="mt-4 flex flex-col gap-2 rounded-lg border-2 border-dashed border-blue-300 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void entry.submit();
      }}
    >
      <h3 className="text-sm font-semibold text-gray-900">Add manually</h3>

      <Field id="me-title" label="Title">
        <input
          id="me-title"
          type="text"
          value={entry.title}
          onChange={(e) => setField("title", e.target.value)}
          className={INPUT_CLASS}
        />
      </Field>
      <Field id="me-artist" label="Artist">
        {text("me-artist", "artist")}
      </Field>
      <Field id="me-album" label="Album">
        {text("me-album", "album")}
      </Field>
      <Field id="me-status" label="Status">
        <select
          id="me-status"
          value={draft.status}
          onChange={(e) => setField("status", e.target.value as SongStatus)}
          className={INPUT_CLASS}
        >
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_CONFIG[s].label}
            </option>
          ))}
        </select>
      </Field>

      <button
        type="button"
        onClick={entry.toggleDetails}
        aria-expanded={entry.detailsOpen}
        className="self-start text-xs font-medium text-emerald-700 underline"
      >
        More details
      </button>
      {entry.detailsOpen && (
        <div className="flex flex-col gap-2">
          <Field id="me-key" label="Key">
            {text("me-key", "key")}
          </Field>
          <Field id="me-duration" label="Duration (m:ss)">
            {text("me-duration", "duration", { placeholder: "3:45" })}
          </Field>
          <Field id="me-cover" label="Cover URL">
            {text("me-cover", "cover", { placeholder: "https://" })}
          </Field>
          <SongLinksEditor links={draft.links} onChange={(links) => setField("links", links)} />
        </div>
      )}

      {entry.offer && (
        <div role="alert" className="rounded bg-amber-100 p-2 text-xs text-amber-900">
          &ldquo;{entry.offer.title}&rdquo; by {entry.offer.artist} is already in the catalog. Add it as a new version?
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void entry.acceptOffer()}
              disabled={entry.busy}
              className="rounded bg-amber-600 px-2 py-1 text-white"
            >
              Add as new version
            </button>
            <button
              type="button"
              onClick={entry.declineOffer}
              className="rounded border border-gray-300 bg-white px-2 py-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {entry.error && (
        <p role="alert" className="text-xs text-red-600">
          {entry.error}
        </p>
      )}

      <button
        type="submit"
        disabled={entry.busy}
        className="rounded-lg bg-emerald-600 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        Add song
      </button>
    </form>
  );
}
