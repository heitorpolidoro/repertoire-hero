'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import { logger } from '@/lib/logger'
import { uploadTabForUser } from '@/lib/tabUpload'
import {
  getTabFileUrl,
  deleteTab,
  getTabAnnotations,
  saveTabAnnotations,
  setTabPrimary,
  listTabs,
  recordAbandonedBlob,
} from '@/lib/tabs'
import { del } from '@vercel/blob'
import { revalidatePath } from 'next/cache'
import type { Repertoire, SongFile, Stroke, TabAnnotations } from '@/types/database'

export type { Stroke, TabAnnotations }


/**
 * The upload envelope. `entry` is the uploader's own repertoire row for the
 * song, present only when this upload had to create it: the destination modal
 * that used to make that the user's explicit choice is gone (RH-123), so the
 * ensure happens server-side and the row is handed back for the page to adopt
 * rather than re-read.
 */
export interface UploadTabResult {
  data?: SongFile
  entry?: Repertoire
  error?: string
}

/**
 * Uploads a tab file via Server Action, wrapping uploadTabForUser and revalidating the root path.
 */
export async function uploadTabAction(formData: FormData): Promise<UploadTabResult> {
  try {
    const userId = await getRequiredUserId()
    const songId = formData.get('songId') as string
    const title = formData.get('title') as string
    const file = formData.get('file') as File | null

    const result = await uploadTabForUser({ userId, songId, title, file: file as File })
    if (result.data) {
      revalidatePath('/')
    }
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : undefined
    return { error: message || 'An unexpected error occurred during upload' }
  }
}

/**
 * Deletes the stored object after its row, and never the other way round
 * (`docs/use-cases.md`, *Delete a file*): orphaned storage can be swept, a row
 * pointing at nothing cannot be repaired. A failure of the object delete is
 * logged and swallowed — the row the musician was looking at is gone, so the
 * action still answers `{ success: true }` — and the URL is handed to the
 * recovery ledger so the leak is recorded rather than silent.
 *
 * The ledger write happens in that failure branch and nowhere else. When `del`
 * resolves the object is gone, and handing the future sweeper a URL that no
 * longer resolves would make the ledger a list of false leaks.
 */
async function deleteStoredFile(fileUrl: string): Promise<void> {
  try {
    await del(fileUrl)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to delete the stored file', err, { fileUrl })
    try {
      await recordAbandonedBlob(fileUrl, `blob delete failed after the song_files row was deleted: ${err.message}`)
    } catch {
      // S1: the ledger is a best-effort record. A failure to write it must not
      // turn a successful row delete into an error the musician sees.
    }
  }
}

export async function deleteTabAction(fileId: string): Promise<{ success?: boolean; error?: string }> {
  try {
    const userId = await getRequiredUserId()

    const fileUrl = await getTabFileUrl(fileId, userId)
    if (fileUrl === null) {
      return { error: 'Tab not found' }
    }

    // The row first — see `deleteStoredFile`.
    await deleteTab(fileId, userId)
    await deleteStoredFile(fileUrl)

    revalidatePath('/')
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : undefined
    return { error: message || 'Failed to delete the file' }
  }
}

export async function getTabAnnotationsAction(
  fileId: string,
): Promise<{ data?: TabAnnotations; error?: string }> {
  try {
    const userId = await getRequiredUserId()
    const annotations = await getTabAnnotations(fileId, userId)
    if (annotations === null) return { error: 'Tab not found' }
    return { data: annotations }
  } catch (err) {
    const message = err instanceof Error ? err.message : undefined
    return { error: message || 'Failed to load annotations' }
  }
}

export async function saveTabAnnotationsAction(
  fileId: string,
  pageNumber: number,
  strokes: Stroke[],
): Promise<{ success?: boolean; error?: string }> {
  try {
    const userId = await getRequiredUserId()
    const saved = await saveTabAnnotations(fileId, userId, pageNumber, strokes)
    if (!saved) return { error: 'Tab not found' }
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : undefined
    return { error: message || 'Failed to save annotations' }
  }
}

export async function setTabPrimaryAction(
  fileId: string,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const userId = await getRequiredUserId()
    const updated = await setTabPrimary(fileId, userId)
    if (!updated) return { error: 'Tab not found' }
    revalidatePath('/')
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : undefined
    return { error: message || 'Failed to set the primary file' }
  }
}

export async function getTabsAction(songId: string) {
  const userId = await getRequiredUserId()
  return listTabs(userId, songId)
}
