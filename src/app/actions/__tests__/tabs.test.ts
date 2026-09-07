/**
 * RH-45 — the tab actions no longer carry SQL: every statement lives in
 * `@/lib/tabs`, which is mocked here. What is left to test is exactly what the
 * action layer still owns — the session, the blob side effects, the upload
 * validation, `revalidatePath`, and the mapping of a `null`/`false` lib answer
 * onto the `{ error: 'Tab not found' }` envelope callers already expect.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth-session', () => ({
  getRequiredUserId: vi.fn(),
}))

vi.mock('@/lib/songs', () => ({
  assertRepertoireAccess: vi.fn(),
}))

vi.mock('@/lib/tabs', () => ({
  createTab: vi.fn(),
  getTabFileUrl: vi.fn(),
  deleteTab: vi.fn(),
  getTabAnnotations: vi.fn(),
  saveTabAnnotations: vi.fn(),
  listTabs: vi.fn(),
}))

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
  del: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import {
  uploadTabAction,
  deleteTabAction,
  getTabAnnotationsAction,
  saveTabAnnotationsAction,
  getTabsAction,
} from '../tabs'
import { getRequiredUserId } from '@/lib/auth-session'
import { assertRepertoireAccess } from '@/lib/songs'
import {
  createTab,
  getTabFileUrl,
  deleteTab,
  getTabAnnotations,
  saveTabAnnotations,
  listTabs,
} from '@/lib/tabs'
import { put, del } from '@vercel/blob'
import { revalidatePath } from 'next/cache'
import type { Stroke } from '@/types/database'

const USER_ID = 'user-1'
const TAB_ID = 'tab-1'
const REPERTOIRE_ID = 'repertoire-1'
const BLOB_URL = 'https://blob.example/repertoire-tabs/chart.pdf'
const DENIED = 'Access denied: not allowed on this repertoire entry'

const sampleStrokes: Stroke[] = [
  { id: 'stroke-1', color: '#ef4444', width: 0.01, points: [[0.1, 0.1], [0.2, 0.2]] },
]

const PDF_BYTES = Buffer.from('%PDF-1.4 minimal', 'latin1')

/** A stand-in `File`: the action only reads these five members off it. */
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
  formDataOf({ repertoireId: REPERTOIRE_ID, title: 'Verse chart', file })

const LIB_MOCKS = [createTab, getTabFileUrl, deleteTab, getTabAnnotations, saveTabAnnotations, listTabs]

beforeEach(() => {
  vi.mocked(getRequiredUserId).mockReset()
  vi.mocked(getRequiredUserId).mockResolvedValue(USER_ID)
  vi.mocked(assertRepertoireAccess).mockReset()
  vi.mocked(assertRepertoireAccess).mockResolvedValue({
    id: REPERTOIRE_ID,
    song_id: 'song-1',
    user_id: USER_ID,
    band_id: null,
  })
  vi.mocked(put).mockReset()
  vi.mocked(put).mockResolvedValue({ url: BLOB_URL } as never)
  vi.mocked(del).mockReset()
  vi.mocked(revalidatePath).mockReset()
  LIB_MOCKS.forEach((fn) => vi.mocked(fn).mockReset())
})

describe('uploadTabAction', () => {
  it('authorizes, uploads the file and delegates the row insert to @/lib/tabs', async () => {
    const row = {
      id: TAB_ID,
      repertoire_id: REPERTOIRE_ID,
      title: 'Verse chart',
      file_url: BLOB_URL,
      created_at: '2026-09-07T09:00:00Z',
    }
    vi.mocked(createTab).mockResolvedValue(row)

    await expect(uploadTabAction(uploadForm())).resolves.toEqual({ data: row })

    expect(assertRepertoireAccess).toHaveBeenCalledWith(REPERTOIRE_ID, USER_ID)
    expect(createTab).toHaveBeenCalledWith(REPERTOIRE_ID, USER_ID, 'Verse chart', BLOB_URL)
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })

  it('sanitizes the file name into the blob path', async () => {
    vi.mocked(createTab).mockResolvedValue({} as never)

    await uploadTabAction(uploadForm())

    expect(vi.mocked(put).mock.calls[0][0]).toBe(`repertoire-tabs/${REPERTOIRE_ID}/my_chart_.pdf`)
  })

  it.each([
    ['a missing repertoireId', { title: 'x', file: fakeFile() }],
    ['a missing title', { repertoireId: REPERTOIRE_ID, file: fakeFile() }],
    ['a missing file', { repertoireId: REPERTOIRE_ID, title: 'x' }],
  ])('refuses %s before authorizing anything', async (_label, fields) => {
    await expect(uploadTabAction(formDataOf(fields))).resolves.toEqual({
      error: 'Missing required fields',
    })

    expect(assertRepertoireAccess).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(createTab).not.toHaveBeenCalled()
  })

  it('refuses a file over the 10MB limit, after authorizing but before uploading', async () => {
    await expect(
      uploadTabAction(uploadForm(fakeFile({ size: 10 * 1024 * 1024 + 1 }))),
    ).resolves.toEqual({ error: 'File size exceeds the 10MB limit' })

    expect(assertRepertoireAccess).toHaveBeenCalledWith(REPERTOIRE_ID, USER_ID)
    expect(put).not.toHaveBeenCalled()
    expect(createTab).not.toHaveBeenCalled()
  })

  it('accepts a PDF whose declared MIME type is wrong, by sniffing the magic bytes', async () => {
    vi.mocked(createTab).mockResolvedValue({} as never)

    await uploadTabAction(uploadForm(fakeFile({ type: 'application/octet-stream' })))

    expect(createTab).toHaveBeenCalled()
  })

  it('refuses a file that is neither declared nor shaped like a PDF', async () => {
    await expect(
      uploadTabAction(
        uploadForm(fakeFile({ type: 'image/png', bytes: Buffer.from('\x89PNG\r\n', 'latin1') })),
      ),
    ).resolves.toEqual({ error: 'Only PDF files are allowed' })

    expect(put).not.toHaveBeenCalled()
    expect(createTab).not.toHaveBeenCalled()
  })

  it('refuses an unauthorized caller before the blob upload happens', async () => {
    vi.mocked(assertRepertoireAccess).mockRejectedValueOnce(new Error(DENIED))

    await expect(uploadTabAction(uploadForm())).resolves.toEqual({ error: DENIED })

    expect(put).not.toHaveBeenCalled()
    expect(createTab).not.toHaveBeenCalled()
  })

  it('turns a rejected lib call into the upload envelope', async () => {
    vi.mocked(createTab).mockRejectedValue(new Error('Failed to create tab: connection lost'))

    await expect(uploadTabAction(uploadForm())).resolves.toEqual({
      error: 'Failed to create tab: connection lost',
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('deleteTabAction', () => {
  it('reads the blob url, deletes the file and then the row', async () => {
    vi.mocked(getTabFileUrl).mockResolvedValue(BLOB_URL)

    await expect(deleteTabAction(TAB_ID, REPERTOIRE_ID)).resolves.toEqual({ success: true })

    expect(assertRepertoireAccess).toHaveBeenCalledWith(REPERTOIRE_ID, USER_ID)
    expect(getTabFileUrl).toHaveBeenCalledWith(TAB_ID, REPERTOIRE_ID, USER_ID)
    expect(del).toHaveBeenCalledWith(BLOB_URL)
    expect(deleteTab).toHaveBeenCalledWith(TAB_ID, REPERTOIRE_ID, USER_ID)
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })

  it("maps a null url onto { error: 'Tab not found' } and deletes nothing", async () => {
    vi.mocked(getTabFileUrl).mockResolvedValue(null)

    await expect(deleteTabAction(TAB_ID, REPERTOIRE_ID)).resolves.toEqual({ error: 'Tab not found' })

    expect(del).not.toHaveBeenCalled()
    expect(deleteTab).not.toHaveBeenCalled()
  })

  it('propagates the access denial into the envelope, before touching the blob store', async () => {
    vi.mocked(assertRepertoireAccess).mockRejectedValueOnce(new Error(DENIED))

    await expect(deleteTabAction(TAB_ID, REPERTOIRE_ID)).resolves.toEqual({ error: DENIED })

    expect(getTabFileUrl).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })
})

describe('getTabAnnotationsAction', () => {
  it('returns the annotations the lib function reports', async () => {
    const stored = { '1': sampleStrokes }
    vi.mocked(getTabAnnotations).mockResolvedValue(stored)

    await expect(getTabAnnotationsAction(TAB_ID, REPERTOIRE_ID)).resolves.toEqual({ data: stored })

    expect(getTabAnnotations).toHaveBeenCalledWith(TAB_ID, REPERTOIRE_ID, USER_ID)
  })

  it("maps null onto { error: 'Tab not found' }", async () => {
    vi.mocked(getTabAnnotations).mockResolvedValue(null)

    await expect(getTabAnnotationsAction(TAB_ID, REPERTOIRE_ID)).resolves.toEqual({
      error: 'Tab not found',
    })
  })

  it('propagates the access denial into the envelope', async () => {
    vi.mocked(getTabAnnotations).mockRejectedValue(new Error(DENIED))

    await expect(getTabAnnotationsAction(TAB_ID, REPERTOIRE_ID)).resolves.toEqual({ error: DENIED })
  })
})

describe('saveTabAnnotationsAction', () => {
  it('forwards the page and strokes and reports success', async () => {
    vi.mocked(saveTabAnnotations).mockResolvedValue(true)

    await expect(
      saveTabAnnotationsAction(TAB_ID, REPERTOIRE_ID, 3, sampleStrokes),
    ).resolves.toEqual({ success: true })

    expect(saveTabAnnotations).toHaveBeenCalledWith(TAB_ID, REPERTOIRE_ID, USER_ID, 3, sampleStrokes)
  })

  it("maps false onto { error: 'Tab not found' } rather than reporting success", async () => {
    vi.mocked(saveTabAnnotations).mockResolvedValue(false)

    await expect(
      saveTabAnnotationsAction(TAB_ID, REPERTOIRE_ID, 1, sampleStrokes),
    ).resolves.toEqual({ error: 'Tab not found' })
  })

  it('surfaces the page-number precondition verbatim', async () => {
    vi.mocked(saveTabAnnotations).mockRejectedValue(new Error('Invalid page number'))

    await expect(
      saveTabAnnotationsAction(TAB_ID, REPERTOIRE_ID, 0, sampleStrokes),
    ).resolves.toEqual({ error: 'Invalid page number' })
  })

  it('surfaces an L1-wrapped database failure instead of the bare driver text', async () => {
    vi.mocked(saveTabAnnotations).mockRejectedValue(
      new Error('Failed to save annotations: connection lost'),
    )

    await expect(
      saveTabAnnotationsAction(TAB_ID, REPERTOIRE_ID, 1, sampleStrokes),
    ).resolves.toEqual({ error: 'Failed to save annotations: connection lost' })
  })

  it('falls back to its own message for a throw carrying none', async () => {
    vi.mocked(saveTabAnnotations).mockRejectedValue(new Error(''))

    await expect(
      saveTabAnnotationsAction(TAB_ID, REPERTOIRE_ID, 1, sampleStrokes),
    ).resolves.toEqual({ error: 'Failed to save annotations' })
  })
})

describe('getTabsAction', () => {
  it('returns the list the lib function reports', async () => {
    const rows = [{ id: TAB_ID }] as never
    vi.mocked(listTabs).mockResolvedValue(rows)

    await expect(getTabsAction(REPERTOIRE_ID)).resolves.toBe(rows)

    expect(listTabs).toHaveBeenCalledWith(REPERTOIRE_ID, USER_ID)
  })

  it('throws rather than returning an envelope, as its callers expect', async () => {
    vi.mocked(listTabs).mockRejectedValue(new Error(DENIED))

    await expect(getTabsAction(REPERTOIRE_ID)).rejects.toThrow('Access denied')
  })
})
