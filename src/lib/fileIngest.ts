import sharp from 'sharp'
import { logger } from '@/lib/logger'

/**
 * RH-127 — what an uploaded file *is*, and what gets stored for it.
 *
 * The upload path used to be validate-and-forward: trust `file.type`, sniff
 * `%PDF-` as a fallback, hand the bytes to Vercel Blob untouched. This module
 * replaces that with decode-and-re-encode for images, and holds the whole
 * decision in one place so `uploadTabAction` stays inside its complexity
 * budget and so the bounds are readable without reading the action.
 *
 * Two things here are security properties, not conveniences:
 *
 *  - **The content type is sniffed, never taken from the client.** `file.type`
 *    is whatever the browser felt like saying; the leading magic bytes are
 *    what the file actually is. A PDF reported as `application/octet-stream`
 *    (Android's Storage Access Framework does this) is still accepted, because
 *    the sniff is what decides — and a `.pdf`-claiming impostor is now
 *    refused, which the old disjunction let through.
 *  - **All image metadata is stripped.** A phone photo of a chart carries EXIF
 *    GPS, and uploads are `access: 'public'`, so an unstripped photo publishes
 *    where the musician was standing at a URL that stays readable forever.
 *
 * And one that is a data-integrity property: **the EXIF rotation is baked into
 * the pixels.** `normalizePoint` stores a stroke as a plain fraction of the
 * rendered box, cancelling the native dimensions out, so a saved annotation
 * records no evidence of the orientation it was drawn over. Leaving an
 * Orientation flag on the file would require every renderer — today's
 * `react-pdf` path, a future canvas one, a server-side thumbnail, the offline
 * view — to agree about it forever; the first one that read it differently
 * would silently and unrepairably misplace every stroke already stored.
 * `.rotate()` with no argument applies the tag and drops it, so there is no
 * flag left to disagree about.
 */

/**
 * The ceiling on the longest edge — a **ceiling, not a target**: a smaller
 * output is always acceptable, which is what keeps it from deadlocking with
 * the byte bound below.
 *
 * 2048px is not inherited from `src/lib/imageCompressor.ts`'s 1024: that is
 * the band-logo/avatar path. This file is a photograph of a handwritten chart
 * read off a music stand mid-song. 2048px across an A4 long edge is ~175 dpi,
 * comfortably above the ~150 dpi where ballpoint strokes start to smear, and
 * it matches the long edge of the largest tablet a player plausibly uses
 * (12.9" iPad, 2732x2048), so the chart never renders below 1:1 pixel density
 * on the stage. 1024px would be ~87 dpi — soft handwriting exactly when the
 * player leans back.
 */
export const MAX_IMAGE_EDGE_PX = 2048

/**
 * The floor the re-resize stops at. Below this a chart stops being readable at
 * all, so refusing the upload is the better failure.
 */
export const MIN_IMAGE_EDGE_PX = 512

/**
 * The hard byte bound. Set so the chart loads over venue wifi or a phone
 * hotspot before the song starts (~3 s at 5 Mbps) while still being 5x below
 * the 10MB input ceiling, so the ingest demonstrably shrinks real phone photos
 * rather than waving them through. No code path stores an image above it.
 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024

/** Shown verbatim to the uploader through the action's envelope. */
export const UNSUPPORTED_UPLOAD_MESSAGE = 'Only PDF, JPEG, PNG and WebP files are allowed'

/** The terminal case of the ladder: not even 512px fits. */
export const IMAGE_TOO_LARGE_MESSAGE =
  'This image could not be stored under the 2MB limit, even heavily reduced'

/** A decode failure — a truncated or mislabelled image — reads the same way. */
export const IMAGE_DECODE_MESSAGE = 'This image could not be read'

/** Every content type the upload path accepts, and every one it can produce. */
export type UploadContentType = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'

type ImageContentType = Exclude<UploadContentType, 'application/pdf'>

/** What `prepareUploadBytes` decided: the bytes to store, and what they are. */
export interface PreparedUpload {
  bytes: Buffer
  contentType: UploadContentType
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * The content type of `buffer`'s leading magic bytes, or `null` when it matches
 * none of the four accepted signatures.
 *
 * Deliberately takes no MIME hint: there is nothing a caller could pass that
 * would be more trustworthy than the bytes, and accepting one would invite a
 * caller to fall back to it.
 */
export function sniffUploadContentType(buffer: Buffer): UploadContentType | null {
  const head = buffer.subarray(0, 12)

  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png'
  if (
    head.subarray(0, 4).toString('latin1') === 'RIFF' &&
    head.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp'
  }

  return null
}

const EXTENSIONS: Record<UploadContentType, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * The name the object is stored under: the picked name, sanitized as before,
 * with its extension replaced by the one matching what was actually produced.
 *
 * Replacing rather than appending matters because the extension the user picked
 * may now be a lie — a `.heic` re-encoded to JPEG, a `.png` that fell back to
 * the JPEG ladder — and the public blob URL is what a browser reads the type
 * from when it is opened directly.
 */
export function storedFileName(originalName: string, contentType: UploadContentType): string {
  const clean = originalName.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const base = clean.replace(/\.[^.]*$/, '')
  return `${base || 'upload'}.${EXTENSIONS[contentType]}`
}

type SharpPipeline = ReturnType<typeof sharp>

/** One attempt: how to encode, and what the result would then be. */
interface Rung {
  contentType: ImageContentType
  encode: (pipeline: SharpPipeline) => SharpPipeline
}

/** Descending quality for the lossy families. */
const LOSSY_QUALITIES = [82, 70, 60, 50, 40] as const

const JPEG_LADDER: readonly Rung[] = LOSSY_QUALITIES.map((quality) => ({
  contentType: 'image/jpeg',
  encode: (pipeline) => pipeline.jpeg({ quality, mozjpeg: true }),
}))

const WEBP_LADDER: readonly Rung[] = LOSSY_QUALITIES.map((quality) => ({
  contentType: 'image/webp',
  encode: (pipeline) => pipeline.webp({ quality, effort: 4 }),
}))

/**
 * PNG has exactly **one** meaningful lossless rung, not a quality ladder: the
 * only knobs are `compressionLevel` and `effort`, and on photographic content
 * neither changes the output size — measured on 1600x1200 and 2048x1536 noise,
 * efforts 1, 4 and 7 produced byte-identical output while effort 7 cost ~7x the
 * time (4.7 s against 0.7 s) and effort 10 took 15.7 s. A Server Action cannot
 * spend that, and it would buy nothing. So: maximum compression at effort 4,
 * and when that still misses the byte bound the ladder continues into JPEG,
 * which changes the stored content type with it.
 */
const PNG_LADDER: readonly Rung[] = [
  {
    contentType: 'image/png',
    encode: (pipeline) => pipeline.png({ compressionLevel: 9, effort: 4 }),
  },
  ...JPEG_LADDER,
]

const LADDERS: Record<ImageContentType, readonly Rung[]> = {
  'image/jpeg': JPEG_LADDER,
  'image/png': PNG_LADDER,
  'image/webp': WEBP_LADDER,
}

/**
 * One encode attempt. `.rotate()` precedes `.resize()` so the bound applies to
 * the upright image, and no `.withMetadata()`/`.keepMetadata()` call appears
 * anywhere in this module — sharp's default is to carry nothing over, and that
 * default is the metadata strip. `sharp()` is constructed with no options, so
 * the default `limitInputPixels` stays in force as the decompression-bomb
 * guard.
 */
async function encodeAtEdge(buffer: Buffer, edge: number, rung: Rung): Promise<Buffer> {
  const resized = sharp(buffer)
    .rotate()
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })

  return rung.encode(resized).toBuffer()
}

/** The first rung at `edge` that reaches the byte bound, or `null` if none does. */
async function walkLadder(
  buffer: Buffer,
  edge: number,
  ladder: readonly Rung[],
): Promise<PreparedUpload | null> {
  for (const rung of ladder) {
    const bytes = await encodeAtEdge(buffer, edge, rung)
    if (bytes.length <= MAX_IMAGE_BYTES) return { bytes, contentType: rung.contentType }
  }

  return null
}

async function sourceEdge(buffer: Buffer): Promise<number> {
  const { width = 0, height = 0 } = await sharp(buffer).metadata()
  if (!width || !height) throw new Error('the image reports no dimensions')
  return Math.max(width, height)
}

/**
 * Walks the family's ladder at the largest permitted edge, then halves the edge
 * and walks it again, down to `MIN_IMAGE_EDGE_PX`. `null` means every rung at
 * every edge was still over the byte bound — the caller turns that into a
 * refusal, because storing an over-bound output is never permitted.
 *
 * Legibility is why the dimension bound is tried first and lowered only as a
 * last resort: an illegible chart is a worse failure than a large file.
 */
async function reencodeImage(
  buffer: Buffer,
  contentType: ImageContentType,
): Promise<PreparedUpload | null> {
  const ladder = LADDERS[contentType]
  let edge = Math.min(await sourceEdge(buffer), MAX_IMAGE_EDGE_PX)

  for (;;) {
    const prepared = await walkLadder(buffer, edge, ladder)
    if (prepared) return prepared
    if (edge <= MIN_IMAGE_EDGE_PX) return null
    edge = Math.max(MIN_IMAGE_EDGE_PX, Math.floor(edge / 2))
  }
}

/**
 * Wraps every `sharp` failure — a truncated file, a signature that lied, a
 * decompression-bomb refusal — into the one user-facing decode message, logged
 * first so the event still reaches Sentry (AGENTS.md, L1). The too-large
 * refusal is raised by the caller, *outside* this try, so its text survives
 * verbatim to the UI (L1a).
 */
async function runReencode(
  buffer: Buffer,
  contentType: ImageContentType,
): Promise<PreparedUpload | null> {
  try {
    return await reencodeImage(buffer, contentType)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to re-encode an uploaded image', err, {
      contentType,
      bytes: buffer.length,
    })
    throw new Error(IMAGE_DECODE_MESSAGE)
  }
}

/**
 * The bytes to store for an upload already identified by
 * {@link sniffUploadContentType}, and the content type they actually are.
 *
 * PDFs pass through byte-identical — no re-encode, no metadata work, nothing
 * to rotate. Images are decoded, rotated, stripped, bounded and re-encoded;
 * both bounds hold unconditionally for everything this returns.
 *
 * The content type is taken as an argument rather than sniffed again so the
 * caller can refuse an unrecognised file *before* the authorization step,
 * where a refusal costs nothing.
 */
export async function prepareUploadBytes(
  buffer: Buffer,
  contentType: UploadContentType,
): Promise<PreparedUpload> {
  if (contentType === 'application/pdf') return { bytes: buffer, contentType }
  if (!LADDERS[contentType]) throw new Error(UNSUPPORTED_UPLOAD_MESSAGE)

  const prepared = await runReencode(buffer, contentType)
  if (!prepared) throw new Error(IMAGE_TOO_LARGE_MESSAGE)

  return prepared
}
