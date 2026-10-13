/**
 * RH-162 — audio ingest. Audio is stored byte-for-byte (no transcoding), so
 * unlike `fileIngest.ts` there is nothing to re-encode: only a type to decide
 * and two bounds to enforce. Kept apart from `fileIngest.ts` because that module
 * pulls `sharp` in, and the bounds here are also read by a client component.
 */

/** The only audio types accepted, and what `song_files.content_type` stores for them. */
export type AudioContentType = 'audio/mpeg' | 'audio/mp4'

/** Per-file cap, the same as tabs and inside `serverActions.bodySizeLimit`. */
export const MAX_AUDIO_FILE_BYTES = 10 * 1024 * 1024

/** Per-user total of stored audio. */
export const AUDIO_QUOTA_BYTES = 100 * 1024 * 1024

export const AUDIO_TOO_LARGE_MESSAGE = 'Audio file size exceeds the 10MB limit'
export const AUDIO_QUOTA_MESSAGE = 'This upload would exceed your 100MB audio storage limit'
export const UNSUPPORTED_AUDIO_MESSAGE = 'Only MP3 and M4A audio files are allowed'

/**
 * The audio type of `buffer`'s leading bytes, or `null`. MP3 is an ID3v2 tag or
 * an MPEG audio frame sync (11 set bits, layer bits not `00`); M4A is an `ftyp`
 * box at offset 4. Never takes a MIME hint, for the RH-127 reason.
 */
export function sniffAudioContentType(buffer: Buffer): AudioContentType | null {
  if (buffer.length < 4) return null
  if (buffer.subarray(0, 3).toString('latin1') === 'ID3') return 'audio/mpeg'
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 && (buffer[1] & 0x06) !== 0) {
    return 'audio/mpeg'
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('latin1') === 'ftyp') return 'audio/mp4'
  return null
}

const AUDIO_EXTENSIONS: Record<AudioContentType, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
}

/** The stored object name: sanitised, with the extension of what the bytes are. */
export function storedAudioFileName(originalName: string, contentType: AudioContentType): string {
  const base = originalName.replace(/[^a-zA-Z0-9.\-_]/g, '_').replace(/\.[^.]*$/, '')
  return `${base || 'upload'}.${AUDIO_EXTENSIONS[contentType]}`
}
