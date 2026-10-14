/**
 * Pure, DOM-free decision helpers for Fast View's file library (RH-49).
 *
 * Extracted for the same reason as `playlistNav.ts`: the decisions that are easy
 * to get wrong — what title an untitled upload gets, and whether a picked file
 * is acceptable at all — become directly unit-testable in the existing `node`
 * vitest environment, with no DOM, no React and no Server Action.
 *
 * RH-123 removed most of what used to live here. `TabOrigin`, `MergedTab`,
 * `entryTabOrigin`, `mergeTabs`, `needsDestinationChoice`, `UploadTarget`,
 * `resolveUploadTarget` and `resolveDeleteTarget` each existed to answer "band
 * or personal?" — a question the model no longer asks, now that a file is keyed
 * by `(user_id, song_id)` and a band holds none. There is one list, no origin
 * badge and no destination choice.
 *
 * This module must not import the App Router tree and must not import
 * `@/lib/tabs.ts`, which is server-side data access and pulls in the `pg` pool.
 * The only React reference here is an erased `import type`.
 *
 * It also declares the `TabLibraryController` contract, so the presentational
 * components under `src/components/fastview` can type the controller they
 * receive without importing the hook that builds it.
 *
 * See docs/tasks/RH-48-spec.md §1 and docs/tasks/RH-123-spec.md §4.
 */

import type { RefObject } from 'react'
import type { SongFile } from '@/types/database'

/** Maximum upload size accepted by the upload action, mirrored client-side. */
export const MAX_TAB_FILE_BYTES = 10 * 1024 * 1024

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

/** Oldest first by `created_at` (compared as instants), the id breaking a tie: a total, order-independent ranking. */
function olderFirst(a: SongFile, b: SongFile): number {
  const at = Date.parse(a.created_at)
  const bt = Date.parse(b.created_at)
  if (!Number.isNaN(at) && !Number.isNaN(bt) && at !== bt) return at < bt ? -1 : 1
  if (a.created_at !== b.created_at && (Number.isNaN(at) || Number.isNaN(bt))) {
    return a.created_at < b.created_at ? -1 : 1
  }
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

/**
 * Which file is the musician's primary for this song (RH-147): the designated
 * one, or - where the data is silent (an offline snapshot written before this
 * task, a missed row) - the oldest file, the rule the migration's backfill, the
 * upload and the delete promotion all follow. `null` only for an empty list;
 * the answer does not depend on the order the list arrives in. Every reader
 * that needs "the" file goes through here, never through `tabs[0]`.
 */
export function resolvePrimaryTab(tabs: SongFile[]): SongFile | null {
  if (tabs.length === 0) return null
  const designated = tabs.filter((tab) => tab.is_primary === true)
  const pool = designated.length > 0 ? designated : tabs
  return [...pool].sort(olderFirst)[0]
}

/** The list with exactly one file designated primary, order untouched (RH-147). */
export function markPrimaryTab(tabs: SongFile[], tabId: string): SongFile[] {
  return tabs.map((tab) => ({ ...tab, is_primary: tab.id === tabId }))
}

/**
 * The list after a delete, mirroring the server: deleting the designated primary
 * promotes the oldest remaining file, so a non-empty list keeps one primary.
 */
export function withoutTab(tabs: SongFile[], tabId: string): SongFile[] {
  const removed = tabs.find((tab) => tab.id === tabId)
  const rest = tabs.filter((tab) => tab.id !== tabId)
  if (!removed?.is_primary) return rest
  const promoted = resolvePrimaryTab(rest)
  return promoted ? markPrimaryTab(rest, promoted.id) : rest
}

/**
 * A file delete awaiting confirmation.
 *
 * The file id is the whole of it since RH-123: the delete is authorized by the
 * row's own `user_id`, which is the session's, so there is no second id to
 * resolve and nothing to choose between.
 */
export interface PendingTabDelete {
  tabId: string
}

/**
 * Everything `useTabLibrary` exposes. Declared here, not in the hook, so the
 * presentational components can type it without importing `src/hooks`.
 */
export interface TabLibraryController {
  tabs: SongFile[]
  activeTabId: string | null
  activeTabUrl: string | null
  activeTabTitle: string
  /**
   * The active file's `content_type`, with an absent one already resolved to
   * `application/pdf` (RH-128). The viewer and the stage branch on this.
   */
  activeTabContentType: string
  selectTab: (tab: SongFile) => void
  closeActiveTab: () => void
  uploadTitle: string
  uploadFile: File | null
  uploading: boolean
  uploadError: string | null
  fileInputRef: RefObject<HTMLInputElement | null>
  setUploadTitle: (title: string) => void
  pickFile: (file: File | null) => void
  submitUpload: () => void
  pendingDelete: PendingTabDelete | null
  deleteBusy: boolean
  requestDelete: (tabId: string) => void
  confirmDelete: () => Promise<void>
  cancelDelete: () => void
  /** Designates one file as the primary (RH-147); the list updates without a reload. */
  setPrimaryTab: (tabId: string) => Promise<void>
}
