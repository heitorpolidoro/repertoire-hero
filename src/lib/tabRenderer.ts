/**
 * How a stored file is rendered — one pure decision, in one module (RH-128).
 *
 * RH-127 taught the upload to ingest a photograph of a chart and recorded what
 * it produced on `song_files.content_type`. Everything downstream — the viewer
 * card, the drawing stage's page surface — branches on that one column, and it
 * branches here so the question is asked identically in every place.
 *
 * **An absent or unrecognised content type reads as PDF.** That is a fact
 * rather than a guess: every row written before RH-127 and every offline
 * snapshot written before RH-128 predates image upload, and the upload action
 * accepted nothing but a PDF then. It is also the reading RH-127's column
 * default (`NOT NULL DEFAULT 'application/pdf'`) already takes.
 *
 * This module is imported by `'use client'` components, so it deliberately
 * imports nothing — in particular not `@/lib/fileIngest`, whose
 * `UploadContentType` names the same three types but which pulls `sharp` into
 * whatever graph touches it.
 */

/** What an absent or unrecognised `content_type` is read as — see the module docblock. */
export const DEFAULT_TAB_CONTENT_TYPE = 'application/pdf'

/** The image content types RH-127's ingest can produce, and the only ones rendered as an image. */
export const IMAGE_TAB_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/**
 * Whether a stored file is rendered as an image rather than as a PDF.
 *
 * `null`/`undefined`/unknown answer `false` — see the module docblock.
 */
export function isImageTab(contentType: string | null | undefined): boolean {
  return IMAGE_TAB_CONTENT_TYPES.some((type) => type === contentType)
}
