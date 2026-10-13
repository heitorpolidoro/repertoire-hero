// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { useAudioLibrary, type AudioLibraryActions } from '../useAudioLibrary'
import type { SongFile } from '@/types/database'

afterEach(cleanup)

const FILE = { id: 'a-1', title: 'Old', file_url: 'u', content_type: 'audio/mpeg' } as SongFile

function setup(overrides: Partial<AudioLibraryActions> = {}) {
  const actions: AudioLibraryActions = {
    getAudio: vi.fn().mockResolvedValue([FILE]),
    uploadAudio: vi.fn().mockResolvedValue({ data: { ...FILE, id: 'a-2', title: 'New' } }),
    deleteAudio: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  }
  const notify = vi.fn()
  const onPersonalEntryCreated = vi.fn()
  const hook = renderHook(() => useAudioLibrary({ songId: 's-1', actions, notify, onPersonalEntryCreated }))
  return { ...hook, actions, notify, onPersonalEntryCreated }
}

describe('useAudioLibrary', () => {
  it('loads the song audio', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.files).toHaveLength(1))
  })

  it('stays empty when the fetch fails (offline)', async () => {
    const { result, actions } = setup({ getAudio: vi.fn().mockRejectedValue(new Error('offline')) })
    await waitFor(() => expect(actions.getAudio).toHaveBeenCalled())
    expect(result.current.files).toEqual([])
  })

  it('refuses an oversized pick before any upload', () => {
    const { result, actions } = setup()
    const big = { name: 'big.mp3', size: 10 * 1024 * 1024 + 1 } as File
    act(() => result.current.pickFile(big))
    act(() => result.current.submitUpload())
    expect(result.current.uploadError).toMatch(/10MB/)
    expect(actions.uploadAudio).not.toHaveBeenCalled()
  })

  it('uploads, prepends the row and adopts a created entry', async () => {
    const { result, actions, onPersonalEntryCreated } = setup({
      uploadAudio: vi.fn().mockResolvedValue({ data: { ...FILE, id: 'a-2' }, entry: { id: 'e' } }),
    })
    await waitFor(() => expect(result.current.files).toHaveLength(1))
    act(() => result.current.pickFile(new File(['x'], 'take.mp3')))
    expect(result.current.uploadTitle).toBe('take')
    act(() => result.current.submitUpload())
    await waitFor(() => expect(result.current.files).toHaveLength(2))
    expect(result.current.files[0].id).toBe('a-2')
    expect(actions.uploadAudio).toHaveBeenCalled()
    expect(onPersonalEntryCreated).toHaveBeenCalledWith({ id: 'e' })
    expect(result.current.uploadFile).toBeNull()
  })

  it('surfaces a server error and a thrown error', async () => {
    const first = setup({ uploadAudio: vi.fn().mockResolvedValue({ error: 'Only MP3 and M4A audio files are allowed' }) })
    act(() => first.result.current.pickFile(new File(['x'], 'a.mp3')))
    act(() => first.result.current.submitUpload())
    await waitFor(() => expect(first.result.current.uploadError).toMatch(/MP3 and M4A/))
    cleanup()

    const second = setup({ uploadAudio: vi.fn().mockRejectedValue('boom') })
    act(() => second.result.current.pickFile(new File(['x'], 'a.mp3')))
    act(() => second.result.current.submitUpload())
    await waitFor(() => expect(second.result.current.uploadError).toBe('Failed to upload audio'))
  })

  it('deletes a file and notifies; reports failures', async () => {
    const { result, notify } = setup()
    await waitFor(() => expect(result.current.files).toHaveLength(1))
    await act(() => result.current.deleteFile('a-1'))
    expect(result.current.files).toHaveLength(0)
    expect(notify).toHaveBeenCalledWith('File deleted.', 'info')

    const failing = setup({ deleteAudio: vi.fn().mockResolvedValue({ error: 'nope' }) })
    await act(() => failing.result.current.deleteFile('a-1'))
    expect(failing.notify).toHaveBeenCalledWith('nope', 'error')
    const throwing = setup({ deleteAudio: vi.fn().mockRejectedValue(new Error('x')) })
    await act(() => throwing.result.current.deleteFile('a-1'))
    expect(throwing.notify).toHaveBeenCalledWith('Failed to delete file', 'error')
  })
})
