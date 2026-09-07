/**
 * Pure, DOM-free decision helpers for Fast View's tab library (RH-49).
 *
 * Extracted for the same reason as `playlistNav.ts`: the decisions that are easy
 * to get wrong — which repertoire an upload or a delete is issued against, how a
 * band entry's tabs and the member's own tabs are merged and ordered, and what
 * title an untitled upload gets — become directly unit-testable in the existing
 * `node` vitest environment, with no DOM, no React and no Server Action.
 *
 * This module must not import the App Router tree and must not import
 * `@/lib/tabs.ts`, which is server-side data access and pulls in the `pg` pool.
 * The only React reference here is an erased `import type`.
 *
 * It also declares the `TabLibraryController` contract, so the presentational
 * components under `src/components/fastview` can type the controller they
 * receive without importing the hook that builds it.
 *
 * See docs/tasks/RH-49-spec.md §1 for the full reasoning.
 */

import type { RefObject } from 'react'
import type { RepertoireTab } from '@/types/database'

/** Which repertoire a tab belongs to, as the UI labels it. */
export type TabOrigin = 'band' | 'personal'

/** A tab plus the origin badge the list renders. */
export interface MergedTab extends RepertoireTab {
  origin: TabOrigin
}

/** Maximum upload size accepted by the upload action, mirrored client-side. */
export const MAX_TAB_FILE_BYTES = 10 * 1024 * 1024

/** 'band' for a band entry, 'personal' otherwise. */
export function entryTabOrigin(entryBandId: string | null | undefined): TabOrigin {
  return entryBandId ? 'band' : 'personal'
}

/**
 * Entry tabs tagged `entryOrigin` plus personal tabs tagged 'personal', newest
 * `created_at` first. Pure: neither input array is mutated.
 */
export function mergeTabs(
  entryTabs: RepertoireTab[],
  personalTabs: RepertoireTab[],
  entryOrigin: TabOrigin,
): MergedTab[] {
  return [
    ...entryTabs.map((tab) => ({ ...tab, origin: entryOrigin })),
    ...personalTabs.map((tab) => ({ ...tab, origin: 'personal' as const })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

/** True when the upload has to ask band vs personal first. */
export function needsDestinationChoice(entryBandId: string | null): boolean {
  return Boolean(entryBandId)
}

/**
 * Where an upload lands. `repertoireId === null` means "create the personal
 * repertoire entry first, then upload into it".
 */
export interface UploadTarget {
  repertoireId: string | null
  isPersonal: boolean
}

export function resolveUploadTarget(args: {
  entryId: string
  entryBandId: string | null
  personalRepertoireId: string | null
  destination: TabOrigin
}): UploadTarget {
  // Outside a band there is nothing to choose: the entry *is* the personal one.
  if (!args.entryBandId) return { repertoireId: args.entryId, isPersonal: true }
  if (args.destination === 'band') return { repertoireId: args.entryId, isPersonal: false }
  return { repertoireId: args.personalRepertoireId, isPersonal: true }
}

/** Which repertoire a delete is issued against; null when it cannot be resolved. */
export function resolveDeleteTarget(args: {
  origin: TabOrigin
  entryId: string | null
  personalRepertoireId: string | null
}): string | null {
  if (args.origin === 'personal' && args.personalRepertoireId) return args.personalRepertoireId
  return args.entryId
}

/** `name.pdf` -> `name`; only the last extension is stripped. */
export function defaultTitleFromFileName(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '')
}

/** The trimmed typed title, or the file name without its extension. */
export function tabUploadTitle(typedTitle: string, fileName: string): string {
  return typedTitle.trim() || defaultTitleFromFileName(fileName)
}

/**
 * A file picked for upload, reduced to what the validator needs. A `File`
 * satisfies it structurally; a test passing a wider literal must assign it to a
 * variable first, or TypeScript's excess-property check fires.
 */
export interface TabFileDescriptor {
  size: number
}

export type TabFileValidation = { ok: true } | { ok: false; message: string }

/**
 * The size check and nothing else, exactly what the page validated before the
 * extraction. The file-type decision is deliberately left to the upload action,
 * which accepts a chart on its magic bytes even when the browser reports a
 * generic type and the name carries no extension (the Android Storage Access
 * Framework case). A client-side type or extension test would reject those
 * uploads before the bytes are ever read.
 */
export function validateTabFile(file: TabFileDescriptor): TabFileValidation {
  if (file.size > MAX_TAB_FILE_BYTES) {
    return { ok: false, message: 'File size exceeds the 10MB limit' }
  }
  return { ok: true }
}

/** A tab delete awaiting confirmation. */
export interface PendingTabDelete {
  tabId: string
  origin: TabOrigin
  targetId: string
}

/**
 * Everything `useTabLibrary` exposes. Declared here, not in the hook, so the
 * presentational components can type it without importing `src/hooks`.
 */
export interface TabLibraryController {
  tabs: MergedTab[]
  activeTabId: string | null
  activeTabRepertoireId: string | null
  activeTabUrl: string | null
  activeTabTitle: string
  selectTab: (tab: MergedTab) => void
  closeActiveTab: () => void
  uploadTitle: string
  uploadFile: File | null
  uploading: boolean
  uploadError: string | null
  fileInputRef: RefObject<HTMLInputElement | null>
  setUploadTitle: (title: string) => void
  pickFile: (file: File | null) => void
  submitUpload: () => void
  isDestinationModalOpen: boolean
  chooseDestination: (destination: TabOrigin) => Promise<void>
  cancelDestination: () => void
  pendingDelete: PendingTabDelete | null
  deleteBusy: boolean
  requestDelete: (tabId: string, origin: TabOrigin) => void
  confirmDelete: () => Promise<void>
  cancelDelete: () => void
}
