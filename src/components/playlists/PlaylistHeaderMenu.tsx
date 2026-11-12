"use client";

import { useEffect, useId, useRef, useState, type Ref } from "react";

/**
 * RH-201 - an extra menu entry: an action (optionally disabled, optionally
 * with a sub-line) or a non-interactive summary line.
 */
export type HeaderMenuEntry =
  | {
      kind: "item";
      label: string;
      run: () => void;
      disabled?: boolean;
      description?: string;
      danger?: boolean;
    }
  | { kind: "summary"; text: string };

type MenuRow = HeaderMenuEntry | { kind: "separator" };

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
  /**
   * RH-201 - the offline group, inserted after "Add songs" and set apart by
   * separators. Empty or omitted: no group and no separators.
   */
  offlineEntries?: HeaderMenuEntry[];
  /** Lets the header return focus to the dots button when the delete modal closes. */
  buttonRef?: Ref<HTMLButtonElement>;
}

/** The menu's rows, in order: Delete stays last whatever the offline group holds. */
function menuRows({
  canReorder,
  reordering,
  onReorder,
  onReviewPractice,
  onAddSongs,
  onRename,
  onDelete,
  offlineEntries = [],
}: PlaylistHeaderMenuProps): MenuRow[] {
  const rows: MenuRow[] = [];
  if (canReorder && !reordering) rows.push({ kind: "item", label: "Reorder", run: onReorder });
  if (onReviewPractice) rows.push({ kind: "item", label: "Review practice", run: onReviewPractice });
  rows.push({ kind: "item", label: "Add songs", run: onAddSongs });
  if (offlineEntries.length > 0) {
    rows.push({ kind: "separator" }, ...offlineEntries, { kind: "separator" });
  }
  rows.push({ kind: "item", label: "Rename playlist", run: onRename });
  rows.push({ kind: "item", label: "Delete playlist", run: onDelete, danger: true });
  return rows;
}

function itemClass(item: Extract<HeaderMenuEntry, { kind: "item" }>): string {
  if (item.disabled) return "text-gray-400 cursor-not-allowed";
  return item.danger ? "text-red-600 hover:bg-gray-100" : "text-gray-900 hover:bg-gray-100";
}

/**
 * One action. A disabled item is `aria-disabled` rather than `disabled`, so it
 * stays in the menu's reading order; activating it does nothing and leaves the
 * menu open. The sub-line describes the item instead of joining its name.
 */
function MenuItem({
  item,
  onChoose,
}: {
  item: Extract<HeaderMenuEntry, { kind: "item" }>;
  onChoose: (run: () => void) => void;
}) {
  const descriptionId = useId();
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        aria-disabled={item.disabled ? true : undefined}
        aria-label={item.description ? item.label : undefined}
        aria-describedby={item.description ? descriptionId : undefined}
        onClick={() => {
          if (!item.disabled) onChoose(item.run);
        }}
        className={`w-full px-3 py-2 text-left ${itemClass(item)}`}
      >
        {item.label}
        {item.description && (
          <span
            id={descriptionId}
            className={`block text-xs ${item.disabled ? "text-gray-400" : "text-gray-500"}`}
          >
            {item.description}
          </span>
        )}
      </button>
    </li>
  );
}

function rowKey(row: MenuRow, index: number): string {
  if (row.kind === "item") return row.label;
  if (row.kind === "summary") return "summary";
  return `separator-${index}`;
}

function MenuRowView({ row, onChoose }: { row: MenuRow; onChoose: (run: () => void) => void }) {
  if (row.kind === "separator") {
    return <li role="separator" className="my-1 border-t border-gray-100" />;
  }
  if (row.kind === "summary") {
    return (
      <li role="none" className="px-3 pt-2 pb-1 text-xs text-gray-500">
        {row.text}
      </li>
    );
  }
  return <MenuItem item={row} onChoose={onChoose} />;
}

/**
 * RH-172 - the three-dots "More actions" menu of the playlist header: every
 * secondary action lives here, at every width. Closes on item click, on Escape
 * and on an outside click. RH-201 adds the offline group after "Add songs".
 */
export function PlaylistHeaderMenu(props: PlaylistHeaderMenuProps) {
  const { buttonRef } = props;
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

  const choose = (run: () => void) => {
    setOpen(false);
    run();
  };

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
          className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg"
        >
          {menuRows(props).map((row, index) => (
            <MenuRowView key={rowKey(row, index)} row={row} onChoose={choose} />
          ))}
        </ul>
      )}
    </div>
  );
}
