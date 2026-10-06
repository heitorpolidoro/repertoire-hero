/**
 * The tab actions carry no SQL: every statement lives in `@/lib/tabs` and
 * `@/lib/songs`, both mocked here. What is left to test is exactly what the
 * action layer still owns — the session, the blob side effects, the upload
 * validation, the ensure-own-repertoire-row of RH-123, the row-before-object
 * delete order with its `abandoned_blobs` write, `revalidatePath`, and the
 * mapping of a `null`/`false` lib answer onto the `{ error: 'Tab not found' }`
 * envelope callers already expect.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth-session', () => ({
  getRequiredUserId: vi.fn(),
}))

// RH-124: the owner-row reads and writes moved to `@/lib/ownerSongs`.
vi.mock('@/lib/ownerSongs', () => ({
  getPersonalEntryForSong: vi.fn(),
  addSongToRepertoire: vi.fn(),
}))

vi.mock('@/lib/tabs', () => ({
  createTab: vi.fn(),
  getTabFileUrl: vi.fn(),
  deleteTab: vi.fn(),
  getTabAnnotations: vi.fn(),
  saveTabAnnotations: vi.fn(),
  listTabs: vi.fn(),
  recordAbandonedBlob: vi.fn(),
}))

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
  del: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

/**
 * RH-127: `@/lib/fileIngest` runs for real — `sharp` is installed and the
 * fixtures below are real images, so what the action hands `put` is what the
 * ingest actually produced rather than what a mock said it would. Only
 * `prepareUploadBytes` is wrapped, so the one case no real image can reach
 * (over the byte bound even at the 512px floor; see
 * `src/lib/__tests__/fileIngest.test.ts`) can be forced here with
 * `mockRejectedValueOnce` to assert the action's half of it: nothing uploaded,
 * no row inserted.
 */
vi.mock('@/lib/fileIngest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/fileIngest')>()
  return { ...actual, prepareUploadBytes: vi.fn(actual.prepareUploadBytes) }
})

import {
  uploadTabAction,
  deleteTabAction,
  getTabAnnotationsAction,
  saveTabAnnotationsAction,
  getTabsAction,
} from '../tabs'
import { getRequiredUserId } from '@/lib/auth-session'
import { addSongToRepertoire, getPersonalEntryForSong } from '@/lib/ownerSongs'
import {
  createTab,
  getTabFileUrl,
  deleteTab,
  getTabAnnotations,
  saveTabAnnotations,
  listTabs,
  recordAbandonedBlob,
} from '@/lib/tabs'
import { put, del } from '@vercel/blob'
import { revalidatePath } from 'next/cache'
import sharp from 'sharp'
import {
  IMAGE_TOO_LARGE_MESSAGE,
  UNSUPPORTED_UPLOAD_MESSAGE,
  prepareUploadBytes,
} from '@/lib/fileIngest'
import type { Repertoire, Stroke } from '@/types/database'

const USER_ID = 'user-1'
const FILE_ID = 'file-1'
const SONG_ID = 'song-1'
const BLOB_URL = 'https://blob.example/song-files/chart.pdf'
const DENIED = 'Access denied: not allowed on this repertoire entry'

const sampleStrokes: Stroke[] = [
  { id: 'stroke-1', color: '#ef4444', width: 0.01, points: [[0.1, 0.1], [0.2, 0.2]] },
]

const PDF_BYTES = Buffer.from('%PDF-1.4 minimal', 'latin1')

// One libvips thread: the fixtures here are tiny, but the default pool is the
// core count and these suites run beside the jsdom ones. See
// `src/lib/__tests__/fileIngest.test.ts`.
sharp.concurrency(1)

/** A real, tiny image of each accepted family, so the ingest runs for real. */
async function imageFixture(format: 'jpeg' | 'png' | 'webp'): Promise<Buffer> {
  const pipeline = sharp({
    create: { width: 120, height: 90, channels: 3, background: { r: 180, g: 40, b: 40 } },
  })
  if (format === 'png') return pipeline.png().toBuffer()
  if (format === 'webp') return pipeline.webp().toBuffer()
  return pipeline.jpeg().toBuffer()
}

/** The row the ensure creates when the uploader held none for this song. */
const OWN_ENTRY = { id: 'repertoire-9', user_id: USER_ID, song_id: SONG_ID, status: 'unknown' } as unknown as Repertoire

/** A stand-in `File`: the action only reads these four members off it. */
const fakeFile = (overrides: Partial<{ name: string; type: string; size: number; bytes: Buffer }> = {}) => {
  const bytes = overrides.bytes ?? PDF_BYTES
  return {
    name: overrides.name ?? 'my chart!.pdf',
    type: overrides.type ?? 'application/pdf',
    size: overrides.size ?? bytes.length,
    arrayBuffer: async () => bytes,
  }
}

/** A stand-in `FormData` carrying the three fields `uploadTabAction` reads. */
const formDataOf = (fields: Record<string, unknown>) =>
  ({ get: (key: string) => fields[key] ?? null }) as unknown as FormData

const uploadForm = (file: unknown = fakeFile()) =>
  formDataOf({ songId: SONG_ID, title: 'Verse chart', file })

const LIB_MOCKS = [
  createTab,
  getTabFileUrl,
  deleteTab,
  getTabAnnotations,
  saveTabAnnotations,
  listTabs,
  recordAbandonedBlob,
  getPersonalEntryForSong,
  addSongToRepertoire,
]

beforeEach(() => {
  vi.mocked(getRequiredUserId).mockReset()
  vi.mocked(getRequiredUserId).mockResolvedValue(USER_ID)
  vi.mocked(put).mockReset()
  vi.mocked(put).mockResolvedValue({ url: BLOB_URL } as never)
  vi.mocked(del).mockReset()
  vi.mocked(revalidatePath).mockReset()
  LIB_MOCKS.forEach((fn) => vi.mocked(fn).mockReset())
  // The common case for the upload path: the uploader already holds the song.
  vi.mocked(getPersonalEntryForSong).mockResolvedValue(OWN_ENTRY)
})

describe('uploadTabAction', () => {
  it('uploads the file and inserts the row under (user_id, song_id)', async () => {
    const row = {
      id: FILE_ID,
      user_id: USER_ID,
      song_id: SONG_ID,
      title: 'Verse chart',
      file_url: BLOB_URL,
      created_at: '2026-09-07T09:00:00Z',
    }
    vi.mocked(createTab).mockResolvedValue(row)

    await expect(uploadTabAction(uploadForm())).resolves.toEqual({ data: row, entry: undefined })

    expect(createTab).toHaveBeenCalledWith({
      userId: USER_ID,
      songId: SONG_ID,
      title: 'Verse chart',
      fileUrl: BLOB_URL,
      contentType: 'application/pdf',
    })
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })

  it('keys the blob path by the owner and the song, with the file name sanitized', async () => {
    vi.mocked(createTab).mockResolvedValue({} as never)

    await uploadTabAction(uploadForm())

    expect(vi.mocked(put).mock.calls[0][0]).toBe(`song-files/${USER_ID}/${SONG_ID}/my_chart_.pdf`)
  })

  // ER12: in band context the song is on the band's row, not the uploader's, so
  // the ensure is what keeps a file from landing on a song its owner does not
  // hold. The action never sees the band at all — it always ensures *its own*.
  it("creates the uploader's own repertoire row when they hold none, and reports it", async () => {
    vi.mocked(getPersonalEntryForSong).mockResolvedValue(null)
    vi.mocked(addSongToRepertoire).mockResolvedValue(OWN_ENTRY)
    vi.mocked(createTab).mockResolvedValue({ id: FILE_ID } as never)

    const result = await uploadTabAction(uploadForm())

    expect(addSongToRepertoire).toHaveBeenCalledWith({ userId: USER_ID }, SONG_ID)
    expect(result.entry).toEqual(OWN_ENTRY)
    expect(result.entry!.status).toBe('unknown')
  })

  it('creates no second row when the uploader already holds the song', async () => {
    vi.mocked(createTab).mockResolvedValue({ id: FILE_ID } as never)

    const result = await uploadTabAction(uploadForm())

    expect(getPersonalEntryForSong).toHaveBeenCalledWith(SONG_ID, USER_ID)
    expect(addSongToRepertoire).not.toHaveBeenCalled()
    expect(result.entry).toBeUndefined()
  })

  it('refuses the whole upload when the ensure fails, before a byte is stored', async () => {
    vi.mocked(getPersonalEntryForSong).mockRejectedValue(
      new Error('Failed to fetch personal entry for song: connection lost'),
    )

    await expect(uploadTabAction(uploadForm())).resolves.toEqual({
      error: 'Failed to fetch personal entry for song: connection lost',
    })

    expect(put).not.toHaveBeenCalled()
    expect(createTab).not.toHaveBeenCalled()
  })

  it.each([
    ['a missing songId', { title: 'x', file: fakeFile() }],
    ['a missing title', { songId: SONG_ID, file: fakeFile() }],
    ['a missing file', { songId: SONG_ID, title: 'x' }],
  ])('refuses %s before touching anything', async (_label, fields) => {
    await expect(uploadTabAction(formDataOf(fields))).resolves.toEqual({
      error: 'Missing required fields',
    })

    expect(getPersonalEntryForSong).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(createTab).not.toHaveBeenCalled()
  })

  it('refuses a file over the 10MB limit before uploading', async () => {
    await expect(
      uploadTabAction(uploadForm(fakeFile({ size: 10 * 1024 * 1024 + 1 }))),
    ).resolves.toEqual({ error: 'File size exceeds the 10MB limit' })

    expect(put).not.toHaveBeenCalled()
    expect(createTab).not.toHaveBeenCalled()
  })

  it('accepts a PDF whose declared MIME type is wrong, by sniffing the magic bytes', async () => {
    vi.mocked(createTab).mockResolvedValue({} as never)

    await uploadTabAction(uploadForm(fakeFile({ type: 'application/octet-stream' })))

    expect(createTab).toHaveBeenCalled()
  })

  // ER2: the four accepted signatures, and the two rejections — one of which is
  // an impostor whose `file.type` says `application/pdf`. The old disjunction
  // accepted that one on the client's word alone.
  it.each([
    ['a buffer matching no signature', 'application/octet-stream', 'GIF89a nope'],
    ['an impostor claiming to be a PDF', 'application/pdf', 'this is not a PDF at all'],
  ])('refuses %s with no upload and no row insert', async (_label, type, text) => {
    await expect(
      uploadTabAction(uploadForm(fakeFile({ type, bytes: Buffer.from(text, 'latin1') }))),
    ).resolves.toEqual({ error: UNSUPPORTED_UPLOAD_MESSAGE })

    expect(put).not.toHaveBeenCalled()
    expect(createTab).not.toHaveBeenCalled()
  })

  it('stores a PDF byte-identical to the input (ER9)', async () => {
    vi.mocked(createTab).mockResolvedValue({} as never)

    await uploadTabAction(uploadForm())

    const stored = vi.mocked(put).mock.calls[0][1] as Buffer
    expect(Buffer.isBuffer(stored)).toBe(true)
    expect(stored.equals(PDF_BYTES)).toBe(true)
  })

  // ER8: the content type handed to `put`, the stored path's extension and the
  // content type written on the row are all the *produced* one, read back off
  // the bytes `put` received rather than asserted from the input's family.
  it.each([
    ['image/jpeg', 'jpg', 'jpeg'],
    ['image/png', 'png', 'png'],
    ['image/webp', 'webp', 'webp'],
  ] as const)(
    'ingests a %s upload and stores it as .%s',
    async (contentType, extension, format) => {
      vi.mocked(createTab).mockResolvedValue({} as never)
      const bytes = await imageFixture(format)

      await uploadTabAction(uploadForm(fakeFile({ name: 'stand photo.heic', type: 'image/heic', bytes })))

      const [path, stored, options] = vi.mocked(put).mock.calls[0] as [string, Buffer, { contentType: string }]
      expect(options.contentType).toBe(contentType)
      expect(path).toBe(`song-files/${USER_ID}/${SONG_ID}/stand_photo.${extension}`)
      expect((await sharp(stored).metadata()).format).toBe(format)
      expect(vi.mocked(createTab).mock.calls[0][0].contentType).toBe(contentType)
    },
    30_000,
  )

  // ER7, the action's half: an image the ingest refuses stores nothing at all.
  it('refuses an image that cannot be brought under the byte bound', async () => {
    vi.mocked(prepareUploadBytes).mockRejectedValueOnce(new Error(IMAGE_TOO_LARGE_MESSAGE))

    await expect(
      uploadTabAction(uploadForm(fakeFile({ bytes: await imageFixture('jpeg') }))),
    ).resolves.toEqual({ error: IMAGE_TOO_LARGE_MESSAGE })

    expect(put).not.toHaveBeenCalled()
    expect(createTab).not.toHaveBeenCalled()
  }, 30_000)

  it('turns a rejected lib call into the upload envelope', async () => {
    vi.mocked(createTab).mockRejectedValue(new Error('Failed to create file: connection lost'))

    await expect(uploadTabAction(uploadForm())).resolves.toEqual({
      error: 'Failed to create file: connection lost',
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('deleteTabAction deletes the row before the stored object (ER11)', () => {
  /** Call order across the two mocks, so "row first" is asserted and not assumed. */
  const callOrder: string[] = []

  beforeEach(() => {
    callOrder.length = 0
    vi.mocked(getTabFileUrl).mockResolvedValue(BLOB_URL)
    vi.mocked(deleteTab).mockImplementation(async () => {
      callOrder.push('row')
    })
    vi.mocked(del).mockImplementation(async () => {
      callOrder.push('object')
    })
  })

  it('deletes the row, then the object, and revalidates', async () => {
    await expect(deleteTabAction(FILE_ID)).resolves.toEqual({ success: true })

    expect(getTabFileUrl).toHaveBeenCalledWith(FILE_ID, USER_ID)
    expect(deleteTab).toHaveBeenCalledWith(FILE_ID, USER_ID)
    expect(callOrder).toEqual(['row', 'object'])
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })

  it('writes no abandoned_blobs row when the object delete resolves', async () => {
    await deleteTabAction(FILE_ID)

    expect(recordAbandonedBlob).not.toHaveBeenCalled()
  })

  it('still reports success when the object delete rejects, with the row already gone', async () => {
    vi.mocked(del).mockRejectedValue(new Error('blob store unreachable'))

    await expect(deleteTabAction(FILE_ID)).resolves.toEqual({ success: true })

    expect(deleteTab).toHaveBeenCalledWith(FILE_ID, USER_ID)
    expect(callOrder).toEqual(['row'])
  })

  it("records the leaked file's url in abandoned_blobs when the object delete rejects", async () => {
    vi.mocked(del).mockRejectedValue(new Error('blob store unreachable'))

    await deleteTabAction(FILE_ID)

    expect(recordAbandonedBlob).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recordAbandonedBlob).mock.calls[0][0]).toBe(BLOB_URL)
    expect(vi.mocked(recordAbandonedBlob).mock.calls[0][1]).toContain('blob store unreachable')
  })

  it('reports success even when the ledger write fails too', async () => {
    vi.mocked(del).mockRejectedValue(new Error('blob store unreachable'))
    vi.mocked(recordAbandonedBlob).mockRejectedValue(new Error('ledger unreachable'))

    await expect(deleteTabAction(FILE_ID)).resolves.toEqual({ success: true })
  })

  it("maps a null url onto { error: 'Tab not found' } and deletes nothing", async () => {
    vi.mocked(getTabFileUrl).mockResolvedValue(null)

    await expect(deleteTabAction(FILE_ID)).resolves.toEqual({ error: 'Tab not found' })

    expect(del).not.toHaveBeenCalled()
    expect(deleteTab).not.toHaveBeenCalled()
  })

  it('propagates a lib failure into the envelope', async () => {
    vi.mocked(getTabFileUrl).mockRejectedValue(new Error(DENIED))

    await expect(deleteTabAction(FILE_ID)).resolves.toEqual({ error: DENIED })

    expect(del).not.toHaveBeenCalled()
  })
})

describe('getTabAnnotationsAction', () => {
  it('returns the annotations the lib function reports', async () => {
    const stored = { '1': sampleStrokes }
    vi.mocked(getTabAnnotations).mockResolvedValue(stored)

    await expect(getTabAnnotationsAction(FILE_ID)).resolves.toEqual({ data: stored })

    expect(getTabAnnotations).toHaveBeenCalledWith(FILE_ID, USER_ID)
  })

  it("maps null onto { error: 'Tab not found' } — another user's file included", async () => {
    vi.mocked(getTabAnnotations).mockResolvedValue(null)

    await expect(getTabAnnotationsAction(FILE_ID)).resolves.toEqual({
      error: 'Tab not found',
    })
  })

  it('propagates a lib failure into the envelope', async () => {
    vi.mocked(getTabAnnotations).mockRejectedValue(new Error('Failed to load annotations: x'))

    await expect(getTabAnnotationsAction(FILE_ID)).resolves.toEqual({
      error: 'Failed to load annotations: x',
    })
  })
})

describe('saveTabAnnotationsAction', () => {
  it('forwards the page and strokes and reports success', async () => {
    vi.mocked(saveTabAnnotations).mockResolvedValue(true)

    await expect(saveTabAnnotationsAction(FILE_ID, 3, sampleStrokes)).resolves.toEqual({
      success: true,
    })

    expect(saveTabAnnotations).toHaveBeenCalledWith(FILE_ID, USER_ID, 3, sampleStrokes)
  })

  it("maps false onto { error: 'Tab not found' } rather than reporting success", async () => {
    vi.mocked(saveTabAnnotations).mockResolvedValue(false)

    await expect(saveTabAnnotationsAction(FILE_ID, 1, sampleStrokes)).resolves.toEqual({
      error: 'Tab not found',
    })
  })

  it('surfaces the page-number precondition verbatim', async () => {
    vi.mocked(saveTabAnnotations).mockRejectedValue(new Error('Invalid page number'))

    await expect(saveTabAnnotationsAction(FILE_ID, 0, sampleStrokes)).resolves.toEqual({
      error: 'Invalid page number',
    })
  })

  it('falls back to its own message for a throw carrying none', async () => {
    vi.mocked(saveTabAnnotations).mockRejectedValue(new Error(''))

    await expect(saveTabAnnotationsAction(FILE_ID, 1, sampleStrokes)).resolves.toEqual({
      error: 'Failed to save annotations',
    })
  })
})

describe('getTabsAction', () => {
  it("returns the caller's own files for one song", async () => {
    const rows = [{ id: FILE_ID }] as never
    vi.mocked(listTabs).mockResolvedValue(rows)

    await expect(getTabsAction(SONG_ID)).resolves.toBe(rows)

    expect(listTabs).toHaveBeenCalledWith(USER_ID, SONG_ID)
  })

  it('throws rather than returning an envelope, as its callers expect', async () => {
    vi.mocked(listTabs).mockRejectedValue(new Error('Failed to list files: connection lost'))

    await expect(getTabsAction(SONG_ID)).rejects.toThrow('Failed to list files')
  })
})
