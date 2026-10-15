"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Spinner } from "@/components/ui/Spinner";

export interface PlaylistDeleteModalProps {
  /** Deletes the playlist; the page binds the write and the redirect. */
  onDelete: () => Promise<void>;
  /** "No", Escape and a backdrop click. */
  onCancel: () => void;
  /** Focus goes back here when the modal closes. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * RH-172 - the delete confirmation of `/playlists/[id]`, a modal over the page.
 * Focus starts on "No" (the safe choice). While the delete (and the redirect
 * that follows it) runs, both answers give way to a spinner, so the click
 * visibly landed and cannot be repeated.
 */
export function PlaylistDeleteModal({ onDelete, onCancel, returnFocusRef }: PlaylistDeleteModalProps) {
  const [deleting, setDeleting] = useState(false);
  const noRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    noRef.current?.focus();
    const returnTo = returnFocusRef?.current;
    return () => returnTo?.focus();
  }, [returnFocusRef]);

  useEffect(() => {
    if (deleting) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [deleting, onCancel]);

  const confirm = () => {
    setDeleting(true);
    onDelete()
      .catch(console.error)
      .finally(() => setDeleting(false));
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget && !deleting) onCancel();
      }}
      data-testid="delete-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="playlist-delete-title"
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
      >
        <h2 id="playlist-delete-title" className="text-base font-semibold text-gray-900">
          Delete playlist
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          This deletes the playlist. Its songs stay in your repertoire.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          {deleting ? (
            <span className="flex items-center gap-1 text-sm text-gray-600" role="status">
              <Spinner />
              Deleting…
            </span>
          ) : (
            <>
              <button
                ref={noRef}
                type="button"
                onClick={onCancel}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                No
              </button>
              <button
                type="button"
                onClick={confirm}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
              >
                Yes, delete
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
