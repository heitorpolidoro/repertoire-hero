"use client";

import { TOAST_TONE_CLASSES, type ToastTone } from "@/lib/uiTones";

export interface ToastProps {
  message: string;
  tone: ToastTone;
  onDismiss: () => void;
}

/**
 * The floating Toast notification (see AGENTS.md — "NO Browser Alerts").
 *
 * Purely presentational: the message, its tone and the auto-dismiss timer are
 * owned by `useToast` (`@/hooks/useToast`). The markup is the one the pages
 * used to inline, kept byte-identical.
 */
export function Toast({ message, tone, onDismiss }: ToastProps) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[90%] mx-auto pointer-events-auto">
      <div
        className={`rounded-xl px-4 py-3 shadow-xl border flex items-center justify-between gap-3 text-xs font-semibold backdrop-blur-md ${TOAST_TONE_CLASSES[tone]}`}
      >
        <span>{message}</span>
        <button
          onClick={onDismiss}
          className="text-white/70 hover:text-white text-sm font-bold shrink-0"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
