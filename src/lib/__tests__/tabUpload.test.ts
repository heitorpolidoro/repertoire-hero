import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ownerSongs', () => ({
  getPersonalEntryForSong: vi.fn(),
  addSongToRepertoire: vi.fn(),
}))

vi.mock('@/lib/tabs', () => ({
  createTab: vi.fn(),
}))

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
}))

import { getPersonalEntryForSong, addSongToRepertoire } from '@/lib/ownerSongs'
import { createTab } from '@/lib/tabs'
import { put } from '@vercel/blob'
import { UNSUPPORTED_UPLOAD_MESSAGE } from '@/lib/fileIngest'
import { uploadTabForUser, MAX_TAB_FILE_BYTES } from '../tabUpload'
import type { SongFile, Repertoire } from '@/types/database'

describe('tabUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Minimal valid PDF: %PDF-1.4 ... %%EOF
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF')

  it('creates a song_files row and repertoire row when missing for a PDF', async () => {
    vi.mocked(getPersonalEntryForSong).mockResolvedValue(null)
    vi.mocked(addSongToRepertoire).mockResolvedValue({
      id: 'rep-1',
      user_id: 'user-1',
      song_id: 'song-1',
      status: 'unknown',
    } as Repertoire)
    vi.mocked(put).mockResolvedValue({ url: 'https://blob.vercel.com/chart.pdf' } as any)
    vi.mocked(createTab).mockResolvedValue({
      id: 'file-1',
      song_id: 'song-1',
      user_id: 'user-1',
      title: 'Solo Tab',
      file_url: 'https://blob.vercel.com/chart.pdf',
      contentType: 'application/pdf',
    } as unknown as SongFile)

    const file = new File([pdfBytes], 'chart.pdf', { type: 'application/pdf' })
    const result = await uploadTabForUser({
      userId: 'user-1',
      songId: 'song-1',
      title: 'Solo Tab',
      file,
    })

    expect(result.error).toBeUndefined()
    expect(result.entry).toBeDefined()
    expect(result.entry?.id).toBe('rep-1')
    expect(result.data?.id).toBe('file-1')
    expect(put).toHaveBeenCalledWith(
      'song-files/user-1/song-1/chart.pdf',
      expect.any(Buffer),
      { access: 'public', contentType: 'application/pdf' },
    )
    expect(createTab).toHaveBeenCalledWith({
      userId: 'user-1',
      songId: 'song-1',
      title: 'Solo Tab',
      fileUrl: 'https://blob.vercel.com/chart.pdf',
      contentType: 'application/pdf',
    })
  })

  it('does not create a repertoire row if user already holds one', async () => {
    vi.mocked(getPersonalEntryForSong).mockResolvedValue({
      id: 'existing-rep',
      user_id: 'user-1',
      song_id: 'song-1',
      status: 'learning',
    } as Repertoire)
    vi.mocked(put).mockResolvedValue({ url: 'https://blob.vercel.com/chart.pdf' } as any)
    vi.mocked(createTab).mockResolvedValue({
      id: 'file-2',
      song_id: 'song-1',
      user_id: 'user-1',
      title: 'Solo Tab',
      file_url: 'https://blob.vercel.com/chart.pdf',
      contentType: 'application/pdf',
    } as unknown as SongFile)

    const file = new File([pdfBytes], 'chart.pdf', { type: 'application/pdf' })
    const result = await uploadTabForUser({
      userId: 'user-1',
      songId: 'song-1',
      title: 'Solo Tab',
      file,
    })

    expect(result.error).toBeUndefined()
    expect(result.entry).toBeUndefined()
    expect(addSongToRepertoire).not.toHaveBeenCalled()
  })

  it('refuses file over 10 MB and writes nothing', async () => {
    const bigFile = new File(['x'], 'big.pdf', { type: 'application/pdf' })
    Object.defineProperty(bigFile, 'size', { value: MAX_TAB_FILE_BYTES + 1 })

    const result = await uploadTabForUser({
      userId: 'user-1',
      songId: 'song-1',
      title: 'Too Big',
      file: bigFile,
    })

    expect(result.error).toBe('File size exceeds the 10MB limit')
    expect(put).not.toHaveBeenCalled()
    expect(createTab).not.toHaveBeenCalled()
    expect(addSongToRepertoire).not.toHaveBeenCalled()
  })

  it('refuses unsupported file type and writes nothing', async () => {
    const invalidFile = new File([Buffer.from('not a supported file type')], 'plain.txt', {
      type: 'text/plain',
    })

    const result = await uploadTabForUser({
      userId: 'user-1',
      songId: 'song-1',
      title: 'Not a tab',
      file: invalidFile,
    })

    expect(result.error).toBe(UNSUPPORTED_UPLOAD_MESSAGE)
    expect(put).not.toHaveBeenCalled()
    expect(createTab).not.toHaveBeenCalled()
    expect(addSongToRepertoire).not.toHaveBeenCalled()
  })

  it('refuses when required fields are missing', async () => {
    const file = new File([pdfBytes], 'chart.pdf')
    expect(
      await uploadTabForUser({
        userId: 'user-1',
        songId: '',
        title: 'Title',
        file,
      }),
    ).toEqual({ error: 'Missing required fields' })

    expect(
      await uploadTabForUser({
        userId: 'user-1',
        songId: 'song-1',
        title: '',
        file,
      }),
    ).toEqual({ error: 'Missing required fields' })
  })
})
