'use client'

import { ConfirmPanel } from '@/components/ui/ConfirmPanel'

export interface TabDeleteConfirmProps {
  pending: boolean
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The in-page confirmation for a tab delete, anchored above the Toast so the two
 * never overlap. Rendered at the page's root fragment for the same
 * containing-block reason as `TabDestinationModal`.
 */
export function TabDeleteConfirm({ pending, busy, onConfirm, onCancel }: TabDeleteConfirmProps) {
  if (!pending) return null

  return (
    <ConfirmPanel
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] w-[90%] max-w-sm shadow-xl"
      message="Delete this tab? This can't be undone."
      confirmLabel="Delete"
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
