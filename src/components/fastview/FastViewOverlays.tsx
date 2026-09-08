'use client'

import type { RefObject } from 'react'
import { Toast } from '@/components/ui/Toast'
import type { LyricsEditorController } from '@/lib/lyricsEditor'
import type { SongIdentity } from '@/lib/songEntry'
import type { SongLinksController } from '@/lib/songLinks'
import type { TabLibraryController } from '@/lib/tabLibrary'
import type { ToastTone } from '@/lib/uiTones'
import type { Stroke, TabAnnotations } from '@/types/database'
import { LinkDeleteConfirm } from './LinkDeleteConfirm'
import { LyricsStageOverlay } from './LyricsStageOverlay'
import { PdfStageOverlay } from './PdfStageOverlay'
import { TabDeleteConfirm } from './TabDeleteConfirm'
import { TabDestinationModal } from './TabDestinationModal'

/**
 * The slice of `usePdfStage`'s controller this stack renders. Declared
 * structurally rather than imported, because PDF Stage Mode has no controller
 * type in `src/lib` and a component may not import `src/hooks` (F21).
 */
export interface FastViewPdfStage {
  isOpen: boolean
  overlayRef: RefObject<HTMLDivElement | null>
  height: number | null
  annotations: TabAnnotations | null
  annotationsError: string | null
  saveAnnotations: (pageNumber: number, strokes: Stroke[]) => Promise<{ success?: boolean; error?: string }>
  close: () => void
}

export interface FastViewOverlaysProps {
  identity: SongIdentity
  lyrics: LyricsEditorController
  pdfStage: FastViewPdfStage
  tabLibrary: TabLibraryController
  links: SongLinksController
  toast: { message: string; tone: ToastTone } | null
  onDismissToast: () => void
}

/**
 * Everything Fast View renders outside its reading column: the two Stage Mode
 * surfaces, the upload destination choice, the two delete confirmations and the
 * page's single floating Toast.
 *
 * They live at the page's root fragment rather than inside its `<main>`:
 * `<main>` always carries a `translate-*` class, which makes it the containing
 * block of any fixed-position descendant, so `fixed inset-0` would resolve
 * against the narrow reading column instead of the viewport. Grouping them here
 * is what keeps the page a composition root (RH-52).
 */
export function FastViewOverlays({
  identity,
  lyrics,
  pdfStage,
  tabLibrary,
  links,
  toast,
  onDismissToast,
}: FastViewOverlaysProps) {
  return (
    <>
      {/* Stage Mode (Full Screen Lyrics) */}
      <LyricsStageOverlay controller={lyrics} songTitle={identity.title} songKey={identity.key} />

      {/* PDF Stage Mode Overlay */}
      <PdfStageOverlay
        open={pdfStage.isOpen}
        overlayRef={pdfStage.overlayRef}
        height={pdfStage.height}
        tabId={tabLibrary.activeTabId}
        fileUrl={tabLibrary.activeTabUrl}
        tabTitle={tabLibrary.activeTabTitle}
        songTitle={identity.title}
        songKey={identity.key}
        annotations={pdfStage.annotations}
        annotationsError={pdfStage.annotationsError}
        onSaveAnnotations={pdfStage.saveAnnotations}
        onClose={pdfStage.close}
      />

      {/* Upload Destination Choice Modal (Only in band mode) */}
      <TabDestinationModal
        open={tabLibrary.isDestinationModalOpen}
        uploading={tabLibrary.uploading}
        onChoose={tabLibrary.chooseDestination}
        onCancel={tabLibrary.cancelDestination}
      />

      {/* Tab delete confirmation — same anchor as the link one below */}
      <TabDeleteConfirm
        pending={tabLibrary.pendingDelete !== null}
        busy={tabLibrary.deleteBusy}
        onConfirm={tabLibrary.confirmDelete}
        onCancel={tabLibrary.cancelDelete}
      />

      {/* In-page delete confirmation — anchored above the Toast so they never overlap */}
      <LinkDeleteConfirm controller={links} />

      {/* Floating Toast Notification */}
      {toast && (
        <Toast message={toast.message} tone={toast.tone} onDismiss={onDismissToast} />
      )}
    </>
  )
}
