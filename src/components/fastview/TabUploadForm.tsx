'use client'

import type { RefObject } from 'react'
import { IMAGE_TAB_CONTENT_TYPES } from '@/lib/tabRenderer'

export interface TabUploadFormProps {
  title: string
  file: File | null
  uploading: boolean
  error: string | null
  inputRef: RefObject<HTMLInputElement | null>
  onTitleChange: (value: string) => void
  onFileChange: (file: File | null) => void
  onSubmit: () => void
  /**
   * True while the Fast View is read-only, i.e. offline (RH-99). An upload
   * crosses the network and therefore cannot complete offline, so all three
   * controls are disabled rather than left to fail.
   */
  readOnly?: boolean
}

/**
 * What the picker offers: a PDF, or a photograph of a chart in any of the three
 * types RH-127's ingest can produce (RH-128).
 *
 * It is the picker's *hint*, not a gate — the user can still choose `All
 * Files`, and what is actually accepted is decided on the server, on the
 * bytes: `sniffUploadContentType` reads the magic numbers, so a chart picked
 * through the Android Storage Access Framework with a generic reported type
 * and no extension still uploads. No client-side MIME check is added here for
 * the same reason.
 */
const ACCEPTED_UPLOAD_TYPES = ['application/pdf', ...IMAGE_TAB_CONTENT_TYPES].join(',')

/**
 * The "Upload New Tab" form.
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
  readOnly = false,
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
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-50 disabled:text-gray-400"
          disabled={uploading || readOnly}
        />
        <input
          type="file"
          accept={ACCEPTED_UPLOAD_TYPES}
          ref={inputRef}
          onChange={(e) => onFileChange(e.target.files?.[0] || null)}
          className="block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer disabled:cursor-not-allowed disabled:file:bg-gray-100 disabled:file:text-gray-400"
          disabled={uploading || readOnly}
        />
      </div>
      {error && (
        <p className="text-xs text-red-600 font-medium">{error}</p>
      )}
      <button
        type="submit"
        disabled={uploading || !file || readOnly}
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
          'Upload File'
        )}
      </button>
    </form>
  )
}
