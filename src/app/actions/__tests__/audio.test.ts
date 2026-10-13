/**
 * RH-162 ER2/ER3 — the audio upload refuses before it writes anything.
 * `@/lib/tabs` and `@/lib/ownerSongs` are mocked; the real ingest runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))
vi.mock('@/lib/ownerSongs', () => ({
  getPersonalEntryForSong: vi.fn(),
  addSongToRepertoire: vi.fn(),
}))
vi.mock('@/lib/tabs', () => ({
  createTab: vi.fn(),
  listAudio: vi.fn(),
  sumAudioBytes: vi.fn(),
  recordAbandonedBlob: vi.fn(),
}))
vi.mock('@vercel/blob', () => ({ put: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { uploadAudioAction, getAudioAction } from '../audio'
import { getRequiredUserId } from '@/lib/auth-session'
import { addSongToRepertoire, getPersonalEntryForSong } from '@/lib/ownerSongs'
import { createTab, listAudio, sumAudioBytes, recordAbandonedBlob } from '@/lib/tabs'
import { put } from '@vercel/blob'
import {
  AUDIO_QUOTA_BYTES,
  AUDIO_QUOTA_MESSAGE,
  AUDIO_TOO_LARGE_MESSAGE,
  MAX_AUDIO_FILE_BYTES,
  UNSUPPORTED_AUDIO_MESSAGE,
} from '@/lib/audioIngest'

const MP3 = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.alloc(61)])
const M4A = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A ', 'latin1'), Buffer.alloc(52)])

function form(bytes: Buffer, over: { name?: string; size?: number; title?: string | null } = {}) {
  const values: Record<string, unknown> = {
    songId: 'song-1',
    title: over.title === undefined ? 'Backing' : over.title,
    file: {
      name: over.name ?? 'track.mp3',
      type: 'audio/mpeg',
      size: over.size ?? bytes.length,
      arrayBuffer: async () => bytes,
    },
  }
  return { get: (key: string) => values[key] ?? null } as unknown as FormData
}

function expectNothingWritten() {
  expect(put).not.toHaveBeenCalled()
  expect(createTab).not.toHaveBeenCalled()
  expect(addSongToRepertoire).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getRequiredUserId).mockResolvedValue('user-1')
  vi.mocked(sumAudioBytes).mockResolvedValue(0)
  vi.mocked(getPersonalEntryForSong).mockResolvedValue(undefined as never)
  vi.mocked(addSongToRepertoire).mockResolvedValue({ id: 'entry-1' } as never)
  vi.mocked(put).mockResolvedValue({ url: 'https://blob.example/a.mp3' } as never)
  vi.mocked(createTab).mockResolvedValue({ id: 'f-1' } as never)
})

describe('uploadAudioAction', () => {
  it('stores a valid MP3 with its sniffed type and size', async () => {
    const res = await uploadAudioAction(form(MP3))
    expect(res.error).toBeUndefined()
    expect(put).toHaveBeenCalledWith('song-files/user-1/song-1/track.mp3', MP3, {
      access: 'public',
      contentType: 'audio/mpeg',
    })
    expect(createTab).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        songId: 'song-1',
        contentType: 'audio/mpeg',
        sizeBytes: MP3.length,
      }),
    )
    expect(res.entry).toEqual({ id: 'entry-1' })
  })

  it('accepts an M4A and stores audio/mp4', async () => {
    await uploadAudioAction(form(M4A, { name: 'take.m4a' }))
    expect(createTab).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'audio/mp4' }))
  })

  it('rejects missing fields without writing', async () => {
    const res = await uploadAudioAction(form(MP3, { title: null }))
    expect(res.error).toBe('Missing required fields')
    expectNothingWritten()
  })

  it('rejects a file over 10MB (10MB + 1 byte) and writes no row or object', async () => {
    const res = await uploadAudioAction(form(MP3, { size: MAX_AUDIO_FILE_BYTES + 1 }))
    expect(res.error).toBe(AUDIO_TOO_LARGE_MESSAGE)
    expectNothingWritten()
  })

  it('accepts a file of exactly 10MB', async () => {
    const res = await uploadAudioAction(form(MP3, { size: MAX_AUDIO_FILE_BYTES }))
    expect(res.error).toBeUndefined()
  })

  it('rejects an upload that would push the audio total past 100MB and writes nothing', async () => {
    vi.mocked(sumAudioBytes).mockResolvedValue(AUDIO_QUOTA_BYTES - MP3.length + 1)
    const res = await uploadAudioAction(form(MP3))
    expect(res.error).toBe(AUDIO_QUOTA_MESSAGE)
    expectNothingWritten()
  })

  it('accepts an upload that lands exactly on the 100MB quota', async () => {
    vi.mocked(sumAudioBytes).mockResolvedValue(AUDIO_QUOTA_BYTES - MP3.length)
    const res = await uploadAudioAction(form(MP3))
    expect(res.error).toBeUndefined()
  })

  it.each([
    ['a WAV', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(20)]), 'a.wav'],
    ['an OGG', Buffer.concat([Buffer.from('OggS'), Buffer.alloc(30)]), 'a.ogg'],
    ['a PDF renamed .mp3', Buffer.from('%PDF-1.4 not audio at all', 'latin1'), 'fake.mp3'],
    ['a text file renamed .mp3', Buffer.from('hello world, definitely not audio'), 'fake.mp3'],
  ])('rejects %s by its bytes, not its name or type, and writes nothing', async (_label, bytes, name) => {
    const res = await uploadAudioAction(form(bytes, { name }))
    expect(res.error).toBe(UNSUPPORTED_AUDIO_MESSAGE)
    expectNothingWritten()
  })

  it('records the object as abandoned when the row insert fails after put', async () => {
    vi.mocked(createTab).mockRejectedValue(new Error('db down'))
    const res = await uploadAudioAction(form(MP3))
    expect(res.error).toBe('db down')
    expect(recordAbandonedBlob).toHaveBeenCalledWith('https://blob.example/a.mp3', expect.any(String))
  })

  it('swallows a failing ledger write and still reports the insert error', async () => {
    vi.mocked(createTab).mockRejectedValue(new Error('db down'))
    vi.mocked(recordAbandonedBlob).mockRejectedValue(new Error('ledger down'))
    const res = await uploadAudioAction(form(MP3))
    expect(res.error).toBe('db down')
  })

  it('does not recreate an existing repertoire row', async () => {
    vi.mocked(getPersonalEntryForSong).mockResolvedValue({ id: 'own' } as never)
    const res = await uploadAudioAction(form(MP3))
    expect(addSongToRepertoire).not.toHaveBeenCalled()
    expect(res.entry).toBeUndefined()
  })

  it('answers a generic error for a non-Error throw', async () => {
    vi.mocked(getRequiredUserId).mockRejectedValue('nope')
    const res = await uploadAudioAction(form(MP3))
    expect(res.error).toBe('An unexpected error occurred during upload')
  })
})

describe('getAudioAction', () => {
  it('lists the session user audio for the song', async () => {
    vi.mocked(listAudio).mockResolvedValue([{ id: 'a' }] as never)
    expect(await getAudioAction('song-1')).toEqual([{ id: 'a' }])
    expect(listAudio).toHaveBeenCalledWith('user-1', 'song-1')
  })
})
