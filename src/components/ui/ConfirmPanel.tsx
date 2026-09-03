"use client";

import { useEffect, useRef } from "react";

export interface ConfirmPanelProps {
  message: string;
  /** Label of the destructive/affirmative button, e.g. "Delete", "Leave", "Remove". */
  confirmLabel: string;
  /** Label while the action is running; defaults to `${confirmLabel}...`. */
  busyLabel?: string;
  busy?: boolean;
  tone?: "danger" | "warning";
  onConfirm: () => void;
  onCancel: () => void;
  /** Positioning / spacing supplied by the caller. */
  className?: string;
}

const TONE_STYLES = {
  danger: {
    panel: "border-red-200 bg-red-50",
    message: "text-red-800",
    button: "bg-red-600 hover:bg-red-700",
  },
  warning: {
    panel: "border-amber-200 bg-amber-50",
    message: "text-amber-800",
    button: "bg-amber-600 hover:bg-amber-700",
  },
} as const;

/**
 * In-page confirmation panel used instead of native browser dialogs
 * (see AGENTS.md — "NO Browser Alerts").
 *
 * Purely presentational: it owns no business logic and no positioning. The
 * caller decides where it renders (via `className`) and what happens on
 * confirm/cancel. Focus lands on `Cancel` when it mounts so the safe choice is
 * the default, and `Escape` cancels while the action is not running.
 */
export function ConfirmPanel({
  message,
  confirmLabel,
  busyLabel,
  busy = false,
  tone = "danger",
  onConfirm,
  onCancel,
  className,
}: ConfirmPanelProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    if (busy) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel]);

  const styles = TONE_STYLES[tone];

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      className={`rounded-lg border px-3 py-3 space-y-2 ${styles.panel} ${className ?? ""}`}
    >
      <p className={`text-xs ${styles.message}`}>{message}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60 transition-colors ${styles.button}`}
        >
          {busy ? (busyLabel ?? `${confirmLabel}...`) : confirmLabel}
        </button>
        <button
          type="button"
          ref={cancelRef}
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-60 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
