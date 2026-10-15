"use client";

import { useEffect, useRef, useState, type Ref } from "react";

export interface PlaylistHeaderMenuProps {
  /** RH-103: whether "Reorder" is offered at all (and not while reordering). */
  canReorder: boolean;
  /** True while the list is in reorder mode; "Reorder" is then not listed. */
  reordering: boolean;
  onReorder: () => void;
  /** RH-159: omit to leave "Review practice" out. */
  onReviewPractice?: () => void;
  onAddSongs: () => void;
  onRename: () => void;
  onDelete: () => void;
  /** Lets the header return focus to the dots button when the delete modal closes. */
  buttonRef?: Ref<HTMLButtonElement>;
}

/**
 * RH-172 - the three-dots "More actions" menu of the playlist header: every
 * secondary action lives here, at every width. Closes on item click, on Escape
 * and on an outside click.
 */
export function PlaylistHeaderMenu({
  canReorder,
  reordering,
  onReorder,
  onReviewPractice,
  onAddSongs,
  onRename,
  onDelete,
  buttonRef,
}: PlaylistHeaderMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (ev: MouseEvent) => {
      if (!root.current?.contains(ev.target as Node)) setOpen(false);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const items: { label: string; run: () => void; danger?: boolean }[] = [];
  if (canReorder && !reordering) items.push({ label: "Reorder", run: onReorder });
  if (onReviewPractice) items.push({ label: "Review practice", run: onReviewPractice });
  items.push({ label: "Add songs", run: onAddSongs });
  items.push({ label: "Rename playlist", run: onRename });
  items.push({ label: "Delete playlist", run: onDelete, danger: true });

  return (
    <div ref={root} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="p-1.5 rounded text-gray-500 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>
      {open && (
        <ul
          role="menu"
          aria-label="Playlist actions"
          className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg"
        >
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.run();
                }}
                className={`w-full px-3 py-2 text-left hover:bg-gray-100 ${
                  item.danger ? "text-red-600" : "text-gray-900"
                }`}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
