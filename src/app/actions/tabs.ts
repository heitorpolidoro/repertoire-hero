'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import {
  prepareUploadBytes,
  sniffUploadContentType,
  storedFileName,
  UNSUPPORTED_UPLOAD_MESSAGE,
} from '@/lib/fileIngest'
import { logger } from '@/lib/logger'
import { addSongToRepertoire, getPersonalEntryForSong } from '@/lib/ownerSongs'
import {
  createTab,
  getTabFileUrl,
  deleteTab,
  getTabAnnotations,
  saveTabAnnotations,
  listTabs,
  recordAbandonedBlob,
} from '@/lib/tabs'
import { put, del } from '@vercel/blob'
import { revalidatePath } from 'next/cache'
import type { Repertoire, SongFile, Stroke, TabAnnotations } from '@/types/database'

export type { Stroke, TabAnnotations }

/** Max 10MB, mirrored client-side by `MAX_TAB_FILE_BYTES` in `@/lib/tabLibrary`. */
const MAX_FILE_BYTES = 10 * 1024 * 1024

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
 * The uploader's own `repertoire` row for the song, created `unknown` when they
 * had none (`docs/use-cases.md`, *Attach a file to a song*, step 3).
 *
 * This is the equivalent of the `user_songs` row RH-124 will create, and it is
 * deliberately not deferred to it: without it a band-context upload would land
 * a file on a song the musician holds no row for at all. Composed from the two
 * existing `@/lib/songs` reads/writes rather than written as SQL here — the
 * action layer holds no data access (`actionDataAccessGuard.test.ts`).
 *
 * Returns the row only when it was created, which is what the caller reports.
 */
async function ensureOwnEntry(userId: string, songId: string): Promise<Repertoire | undefined> {
  const existing = await getPersonalEntryForSong(songId, userId)
  if (existing) return undefined
  return addSongToRepertoire({ userId }, songId)
}

export async function uploadTabAction(formData: FormData): Promise<UploadTabResult> {
  try {
    const userId = await getRequiredUserId()
    const songId = formData.get('songId') as string
    const title = formData.get('title') as string
    const file = formData.get('file') as File | null

    if (!songId || !title || !file) {
      return { error: 'Missing required fields' }
    }

    if (file.size > MAX_FILE_BYTES) {
      return { error: 'File size exceeds the 10MB limit' }
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // What the file *is*, decided by its leading magic bytes and never by
    // `file.type` (RH-127). The old `file.type === 'application/pdf' || <sniff>`
    // disjunction trusted the client as an alternative to the bytes; sniffing
    // alone still accepts the Android Storage Access Framework case the old
    // comment protected (a genuine PDF reported as `application/octet-stream`),
    // because the sniff is what decides — and it now refuses a
    // `application/pdf`-claiming impostor, which is a deliberate tightening.
    //
    // This runs before the authorization step because it is pure validation on
    // bytes already in memory: a refusal here costs nothing and writes nothing.
    const sniffed = sniffUploadContentType(buffer)
    if (!sniffed) {
      return { error: UNSUPPORTED_UPLOAD_MESSAGE }
    }

    // Before any byte work or blob call: a failure here refuses the upload with
    // nothing written, where a failure after it would leave an object behind.
    const entry = await ensureOwnEntry(userId, songId)

    // Decode, bake the rotation, strip the metadata, bound the size, re-encode.
    // PDFs come back byte-identical. Both image bounds hold unconditionally for
    // whatever this returns, and an image that cannot be brought under them
    // throws rather than being stored.
    const prepared = await prepareUploadBytes(buffer, sniffed)

    // Upload to Vercel Blob Storage, under a path keyed by the owner and the
    // song rather than by a repertoire row. Existing objects are *not* moved:
    // the row carries an absolute `file_url`, so old and new paths coexist with
    // no migration of bytes.
    // We use the original file name (sanitized) so that the download/view link
    // retains a legible name, with its extension replaced by the one matching
    // what was actually produced. Vercel Blob automatically appends a random
    // unique suffix to prevent collisions.
    const filePath = `song-files/${userId}/${songId}/${storedFileName(file.name, prepared.contentType)}`

    // `contentType` is derived, never assumed: it is whatever the ingest's
    // chosen encoder produced, which is also what goes on the row.
    const blob = await put(filePath, prepared.bytes, {
      access: 'public',
      contentType: prepared.contentType,
    })

    const tab = await createTab({
      userId,
      songId,
      title,
      fileUrl: blob.url,
      contentType: prepared.contentType,
    })

    revalidatePath('/')
    return { data: tab, entry }
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

export async function getTabsAction(songId: string) {
  const userId = await getRequiredUserId()
  return listTabs(userId, songId)
}
