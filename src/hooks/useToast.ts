import { useCallback, useEffect, useState } from 'react'
import type { ToastTone } from '@/lib/uiTones'

/** Auto-dismiss delay, unchanged from the per-page copies this hook replaced. */
const TOAST_DISMISS_MS = 4000

/**
 * Owns the floating Toast state shared by the pages that show one: the current
 * message + tone, a `showToast` that defaults to the neutral `info` tone, and
 * the auto-dismiss timer (cleared when the toast changes or the page unmounts).
 *
 * Render the state with `<Toast>` from `@/components/ui/Toast`.
 */
export function useToast() {
  const [toast, setToastState] = useState<{ message: string; tone: ToastTone } | null>(null)

  const dismissToast = useCallback(() => setToastState(null), [])

  const showToast = useCallback(
    (message: string, tone: ToastTone = 'info') => setToastState({ message, tone }),
    [],
  )

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(dismissToast, TOAST_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [toast, dismissToast])

  return { toast, showToast, dismissToast }
}
