'use client'

import { ConfirmPanel } from '@/components/ui/ConfirmPanel'
import type { SongLinksController } from '@/lib/songLinks'

export interface LinkDeleteConfirmProps {
  controller: SongLinksController
}

/**
 * The in-page confirmation for a link delete, anchored above the Toast so the
 * two never overlap — the twin of `TabDeleteConfirm`, and the reason Fast View
 * needs no browser `confirm()` (see AGENTS.md — "NO Browser Alerts").
 */
export function LinkDeleteConfirm({ controller }: LinkDeleteConfirmProps) {
  if (controller.pendingDeleteUrl === null) return null

  return (
    <ConfirmPanel
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] w-[90%] max-w-sm shadow-xl"
      message="Delete this link? This can't be undone."
      confirmLabel="Delete"
      busy={controller.deleteBusy}
      onConfirm={controller.confirmDelete}
      onCancel={controller.cancelDelete}
    />
  )
}
