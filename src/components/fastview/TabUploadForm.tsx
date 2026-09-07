'use client'

import type { RefObject } from 'react'

export interface TabUploadFormProps {
  title: string
  file: File | null
  uploading: boolean
  error: string | null
  inputRef: RefObject<HTMLInputElement | null>
  onTitleChange: (value: string) => void
  onFileChange: (file: File | null) => void
  onSubmit: () => void
}

/**
 * The "Upload New Tab" form. `accept="application/pdf"` is the file picker's
 * hint, not a gate — the user can still choose `All Files`, and the file type is
 * decided by the upload action on the bytes it receives.
 */
export function TabUploadForm({
  title,
  file,
  uploading,
  error,
  inputRef,
  onTitleChange,
  onFileChange,
  onSubmit,
}: TabUploadFormProps) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3 shadow-sm"
    >
      <h3 className="text-xs font-semibold text-gray-700">Upload New Tab</h3>

      <div className="flex flex-col gap-2">
        <input
          type="text"
          placeholder="Tab Title (e.g. Guitar Solo, Bass)"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
          disabled={uploading}
        />
        <input
          type="file"
          accept="application/pdf"
          ref={inputRef}
          onChange={(e) => onFileChange(e.target.files?.[0] || null)}
          className="block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer"
          disabled={uploading}
        />
      </div>
      {error && (
        <p className="text-xs text-red-600 font-medium">{error}</p>
      )}
      <button
        type="submit"
        disabled={uploading || !file}
        className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-100 disabled:text-gray-400 text-white font-medium text-sm rounded-lg transition-colors shadow-sm flex items-center justify-center gap-1.5"
      >
        {uploading ? (
          <>
            <svg className="animate-spin h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Uploading...
          </>
        ) : (
          'Upload PDF'
        )}
      </button>
    </form>
  )
}
