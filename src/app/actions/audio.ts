'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import {
  AUDIO_QUOTA_BYTES,
  AUDIO_QUOTA_MESSAGE,
  AUDIO_TOO_LARGE_MESSAGE,
  MAX_AUDIO_FILE_BYTES,
  sniffAudioContentType,
  storedAudioFileName,
  UNSUPPORTED_AUDIO_MESSAGE,
} from '@/lib/audioIngest'
import { addSongToRepertoire, getPersonalEntryForSong } from '@/lib/ownerSongs'
import { createTab, listAudio, recordAbandonedBlob, sumAudioBytes } from '@/lib/tabs'
import { put } from '@vercel/blob'
import { revalidatePath } from 'next/cache'
import type { Repertoire, SongFile } from '@/types/database'

export interface UploadAudioResult {
  data?: SongFile
  entry?: Repertoire
  error?: string
}

/**
 * Validates in a fixed order, writing nothing until the last step (RH-162):
 * required fields, the 10MB cap, the sniffed type, the 100MB quota. Only then
 * ensure-own-entry, `put`, and the row. An audio file belongs to the uploader
 * alone (no `band_id`), exactly like a chart.
 */
export async function uploadAudioAction(formData: FormData): Promise<UploadAudioResult> {
  try {
    const userId = await getRequiredUserId()
    const songId = formData.get('songId') as string
    const title = formData.get('title') as string
    const file = formData.get('file') as File | null

    if (!songId || !title || !file) return { error: 'Missing required fields' }
    if (file.size > MAX_AUDIO_FILE_BYTES) return { error: AUDIO_TOO_LARGE_MESSAGE }

    const buffer = Buffer.from(await file.arrayBuffer())
    const contentType = sniffAudioContentType(buffer)
    if (!contentType) return { error: UNSUPPORTED_AUDIO_MESSAGE }

    const stored = await sumAudioBytes(userId)
    if (stored + buffer.length > AUDIO_QUOTA_BYTES) return { error: AUDIO_QUOTA_MESSAGE }

    const existing = await getPersonalEntryForSong(songId, userId)
    const entry = existing ? undefined : await addSongToRepertoire({ userId }, songId)

    const blob = await put(
      `song-files/${userId}/${songId}/${storedAudioFileName(file.name, contentType)}`,
      buffer,
      { access: 'public', contentType },
    )

    let data: SongFile
    try {
      data = await createTab({
        userId,
        songId,
        title,
        fileUrl: blob.url,
        contentType,
        sizeBytes: buffer.length,
      })
    } catch (insertError) {
      try {
        await recordAbandonedBlob(blob.url, 'audio row insert failed after the object was uploaded')
      } catch {
        // S1: the ledger is best-effort; the insert error is what the user needs.
      }
      throw insertError
    }

    revalidatePath('/')
    return { data, entry }
  } catch (err) {
    const message = err instanceof Error ? err.message : undefined
    return { error: message || 'An unexpected error occurred during upload' }
  }
}

export async function getAudioAction(songId: string): Promise<SongFile[]> {
  const userId = await getRequiredUserId()
  return listAudio(userId, songId)
}
