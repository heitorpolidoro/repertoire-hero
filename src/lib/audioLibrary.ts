/**
 * Pure helpers and the controller contract for Fast View's audio section
 * (RH-162). Client-safe: imports nothing server-side.
 */

import type { RefObject } from 'react'
import type { SongFile } from '@/types/database'
import { AUDIO_TOO_LARGE_MESSAGE, MAX_AUDIO_FILE_BYTES } from '@/lib/audioIngest'

/** The picker hint; the server decides on the bytes, not on this. */
export const AUDIO_ACCEPT = 'audio/mpeg,audio/mp4,.mp3,.m4a'

/** The copy shown in place of the player while the page is offline. */
export const AUDIO_OFFLINE_MESSAGE = 'Audio is not available offline'

export type AudioFileValidation = { ok: true } | { ok: false; message: string }

/** The size check only, mirroring the server so an oversized pick fails before any upload. */
export function validateAudioFile(file: { size: number }): AudioFileValidation {
  if (file.size > MAX_AUDIO_FILE_BYTES) return { ok: false, message: AUDIO_TOO_LARGE_MESSAGE }
  return { ok: true }
}

export interface AudioLibraryController {
  files: SongFile[]
  uploadTitle: string
  uploadFile: File | null
  uploading: boolean
  uploadError: string | null
  fileInputRef: RefObject<HTMLInputElement | null>
  setUploadTitle: (title: string) => void
  pickFile: (file: File | null) => void
  submitUpload: () => void
  deleteFile: (fileId: string) => Promise<void>
}
