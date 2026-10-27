/**
 * RH-187: Shared tab upload logic for both Server Actions and the /api/v1 REST API.
 */
import { put } from '@vercel/blob'
import {
  prepareUploadBytes,
  sniffUploadContentType,
  storedFileName,
  UNSUPPORTED_UPLOAD_MESSAGE,
} from '@/lib/fileIngest'
import { addSongToRepertoire, getPersonalEntryForSong } from '@/lib/ownerSongs'
import { createTab } from '@/lib/tabs'
import type { Repertoire, SongFile } from '@/types/database'

/** Max 10MB, shared between server action and REST API. */
export const MAX_TAB_FILE_BYTES = 10 * 1024 * 1024

export interface UploadTabForUserInput {
  userId: string
  songId: string
  title: string
  file: File
}

export interface UploadTabForUserResult {
  data?: SongFile
  entry?: Repertoire
  error?: string
}

/**
 * The uploader's own `repertoire` row for the song, created `unknown` when they
 * had none (`docs/use-cases.md`, *Attach a file to a song*, step 3).
 *
 * This is the equivalent of the `user_songs` row RH-124 created: without it a
 * band-context upload would land a file on a song the musician holds no row for at all.
 *
 * Returns the row only when it was created, which is what the caller reports.
 */
async function ensureOwnEntry(userId: string, songId: string): Promise<Repertoire | undefined> {
  const existing = await getPersonalEntryForSong(songId, userId)
  if (existing) return undefined
  return addSongToRepertoire({ userId }, songId)
}

/**
 * Handles tab upload for a user: byte sniffing, size limit checks,
 * ensuring personal repertoire row, byte preparation, Blob put, and DB insert.
 */
export async function uploadTabForUser(
  params: UploadTabForUserInput,
): Promise<UploadTabForUserResult> {
  try {
    const { userId, songId, title, file } = params

    if (!userId || !songId || !title || !file) {
      return { error: 'Missing required fields' }
    }

    if (file.size > MAX_TAB_FILE_BYTES) {
      return { error: 'File size exceeds the 10MB limit' }
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const sniffed = sniffUploadContentType(buffer)
    if (!sniffed) {
      return { error: UNSUPPORTED_UPLOAD_MESSAGE }
    }

    const entry = await ensureOwnEntry(userId, songId)
    const prepared = await prepareUploadBytes(buffer, sniffed)

    const filePath = `song-files/${userId}/${songId}/${storedFileName(file.name, prepared.contentType)}`

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

    return { data: tab, entry }
  } catch (err) {
    const message = err instanceof Error ? err.message : undefined
    return { error: message || 'An unexpected error occurred during upload' }
  }
}
