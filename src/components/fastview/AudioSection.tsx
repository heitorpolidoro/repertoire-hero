'use client'

import { AUDIO_OFFLINE_MESSAGE, type AudioLibraryController } from '@/lib/audioLibrary'
import { AudioUploadForm } from './AudioUploadForm'

export interface AudioSectionProps {
  library: AudioLibraryController
  /** The page's offline signal: audio is never in the offline snapshot (RH-162). */
  offline?: boolean
  /** True while the Fast View is read-only; disables upload and delete. */
  readOnly?: boolean
}

/**
 * The song's audio: one native `<audio controls preload="none">` per file. No
 * `autoplay` and no scripted `play()` anywhere — playback starts on the user's
 * tap. Offline, each file renders the not-available message instead of a player
 * that could not load.
 */
export function AudioSection({ library, offline = false, readOnly = false }: AudioSectionProps) {
  return (
    <section aria-label="Audio" className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Audio</h2>

      {library.files.length > 0 && (
        <ul className="flex flex-col gap-3">
          {library.files.map((file) => (
            <li
              key={file.id}
              className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-gray-800 truncate">{file.title}</span>
                <button
                  type="button"
                  onClick={() => void library.deleteFile(file.id)}
                  disabled={readOnly}
                  aria-label={`Delete ${file.title}`}
                  className="text-xs text-red-600 hover:text-red-800 disabled:text-gray-300"
                >
                  Delete
                </button>
              </div>
              {offline ? (
                <p
                  data-testid="audio-offline-state"
                  className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
                >
                  {AUDIO_OFFLINE_MESSAGE}
                </p>
              ) : (
                <audio controls preload="none" src={file.file_url} className="w-full" />
              )}
            </li>
          ))}
        </ul>
      )}

      <AudioUploadForm
        title={library.uploadTitle}
        file={library.uploadFile}
        uploading={library.uploading}
        error={library.uploadError}
        inputRef={library.fileInputRef}
        onTitleChange={library.setUploadTitle}
        onFileChange={library.pickFile}
        onSubmit={library.submitUpload}
        readOnly={readOnly}
      />
    </section>
  )
}
