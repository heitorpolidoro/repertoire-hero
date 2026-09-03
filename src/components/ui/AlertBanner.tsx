"use client";

type AlertTone = "error" | "success";

const ALERT_TONES: Record<AlertTone, { role: string; panel: string; text: string; button: string }> = {
  error: {
    role: "alert",
    panel: "rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between gap-3",
    text: "text-sm text-red-700",
    button: "text-red-400 hover:text-red-600 text-xs focus:outline-none",
  },
  success: {
    role: "status",
    panel: "rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-center justify-between gap-3",
    text: "text-sm text-green-700",
    button: "text-green-500 hover:text-green-700 text-xs focus:outline-none",
  },
};

export interface AlertBannerProps {
  tone: AlertTone;
  message: string;
  onDismiss: () => void;
  /** Extra positioning / spacing supplied by the caller. */
  className?: string;
}

/**
 * Dismissible inline alert banner (see AGENTS.md — "NO Browser Alerts").
 *
 * Purely presentational. The tone palettes live here, in the single component
 * that renders them, so each class literal occurs exactly once in `src/`.
 */
export function AlertBanner({ tone, message, onDismiss, className }: AlertBannerProps) {
  const t = ALERT_TONES[tone];

  return (
    <div role={t.role} className={className ? `${t.panel} ${className}` : t.panel}>
      <p className={t.text}>{message}</p>
      <button type="button" onClick={onDismiss} className={t.button}>
        ✕
      </button>
    </div>
  );
}
