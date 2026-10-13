'use client'

import type { RefObject } from 'react'
import { AUDIO_ACCEPT } from '@/lib/audioLibrary'

export interface AudioUploadFormProps {
  title: string
  file: File | null
  uploading: boolean
  error: string | null
  inputRef: RefObject<HTMLInputElement | null>
  onTitleChange: (value: string) => void
  onFileChange: (file: File | null) => void
  onSubmit: () => void
  /** True while the Fast View is read-only (offline): every control is disabled. */
  readOnly?: boolean
}

/** The "Upload Audio" form: a title, an MP3/M4A picker and a submit (RH-162). */
export function AudioUploadForm({
  title,
  file,
  uploading,
  error,
  inputRef,
  onTitleChange,
  onFileChange,
  onSubmit,
  readOnly = false,
}: AudioUploadFormProps) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3 shadow-sm"
    >
      <h3 className="text-xs font-semibold text-gray-700">Upload Audio (MP3 or M4A, up to 10MB)</h3>
      <input
        type="text"
        placeholder="Audio Title (e.g. Backing track)"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        disabled={uploading || readOnly}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg disabled:bg-gray-50 disabled:text-gray-400"
      />
      <input
        type="file"
        accept={AUDIO_ACCEPT}
        ref={inputRef}
        onChange={(e) => onFileChange(e.target.files?.[0] || null)}
        disabled={uploading || readOnly}
        className="block w-full text-xs text-gray-500"
      />
      {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
      <button
        type="submit"
        disabled={uploading || !file || readOnly}
        className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-100 disabled:text-gray-400 text-white font-medium text-sm rounded-lg"
      >
        {uploading ? 'Uploading...' : 'Upload Audio'}
      </button>
    </form>
  )
}
