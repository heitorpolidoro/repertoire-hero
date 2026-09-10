"use client";

import type { TagEditorController } from "@/hooks/useTagEditor";

export interface TagEditRowProps {
  /** What the editor keys these tags by: the playlist id, or a song id. */
  subject: string;
  /** The tags to draw as chips, in the order they are stored. */
  tags: string[];
  /** The one controller both editing sites of the page share. */
  editor: TagEditorController;
  /** The add button's accessible name, which differs per site. */
  addLabel: string;
  /** The wrapper's classes: the bar and a song row sit in different layouts. */
  className: string;
}

/**
 * RH-69 — the chips, their remove buttons and the inline `new tag` input,
 * written once for both tag editors of `/playlists/[id]`.
 *
 * The two markups were already identical but for the add button's label, so
 * under one controller they would have become a byte-identical clone pair in
 * `PlaylistTagBar.tsx` and `PlaylistSongRow.tsx`. Rendering them from here also
 * keeps both accessible names distinguishable by an exact match, which is what
 * `e2e/playlist-detail.spec.ts` relies on: `Add tag` is a prefix of
 * `Add tag to playlist`.
 *
 * Every command is a call into `editor`, and each `.catch(console.error)` keeps
 * a rejected write from becoming an unhandled rejection — the reason itself
 * reaches the user through the page's error banner, which the controller's
 * `onError` writes.
 */
export function TagEditRow({
  subject,
  tags,
  editor,
  addLabel,
  className,
}: TagEditRowProps) {
  const { inputRef, draft, openFor } = editor;

  return (
    <div className={className}>
      {tags.map((tag) => (
        <span
          key={tag}
          className="group flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"
        >
          {tag}
          <button
            type="button"
            onClick={() => {
              editor.removeTag(subject, tag).catch(console.error);
            }}
            aria-label={`Remove tag ${tag}`}
            className="opacity-0 group-hover:opacity-100 text-emerald-400 hover:text-emerald-700 transition-opacity leading-none"
          >
            ×
          </button>
        </span>
      ))}
      {openFor === subject ? (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(ev) => editor.changeDraft(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter")
              editor.commitDraft(subject).catch(console.error);
            if (ev.key === "Escape") editor.close();
          }}
          onBlur={() => {
            if (draft.trim())
              editor.commitDraft(subject).catch(console.error);
            else editor.close();
          }}
          placeholder="new tag"
          className="px-2 py-0.5 rounded-full text-xs border border-emerald-300 text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-24"
        />
      ) : (
        <button
          type="button"
          onClick={() => editor.open(subject)}
          aria-label={addLabel}
          className="flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs text-gray-400 border border-dashed border-gray-300 hover:border-emerald-300 hover:text-emerald-600 transition-colors"
        >
          + tag
        </button>
      )}
    </div>
  );
}
