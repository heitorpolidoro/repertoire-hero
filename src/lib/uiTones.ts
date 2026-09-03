/**
 * Shared tone palettes for the floating Toast.
 *
 * The class strings are the ones the pages used to hard-code, kept verbatim so
 * the extraction is UI-identical. Alert-banner tones deliberately do NOT live
 * here — they are module-local to `src/components/ui/AlertBanner.tsx`, the only
 * place that renders them.
 */

export type ToastTone = 'success' | 'error' | 'warning' | 'info'

export const TOAST_TONE_CLASSES: Record<ToastTone, string> = {
  success: 'bg-emerald-950/90 text-emerald-100 border-emerald-800',
  error: 'bg-red-950/90 text-red-100 border-red-800',
  warning: 'bg-amber-950/90 text-amber-100 border-amber-800',
  info: 'bg-gray-900/90 text-white border-gray-700',
}
