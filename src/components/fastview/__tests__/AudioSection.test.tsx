// @vitest-environment jsdom
/**
 * RH-162 ER4/ER5 — the audio player is a native element that never starts on
 * its own, and offline it is replaced by an explicit state.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { SongFile } from '@/types/database'
import type { AudioLibraryController } from '@/lib/audioLibrary'
import { AudioSection } from '../AudioSection'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const FILE: SongFile = {
  id: 'a-1',
  user_id: 'u',
  song_id: 's',
  title: 'Backing track',
  file_url: 'https://blob.example/backing.mp3',
  content_type: 'audio/mpeg',
  created_at: '2026-03-01T10:00:00.000Z',
}

function controller(overrides: Partial<AudioLibraryController> = {}): AudioLibraryController {
  return {
    files: [FILE],
    uploadTitle: '',
    uploadFile: null,
    uploading: false,
    uploadError: null,
    fileInputRef: { current: null },
    setUploadTitle: vi.fn(),
    pickFile: vi.fn(),
    submitUpload: vi.fn(),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('AudioSection online', () => {
  it('renders <audio controls preload="none"> with no autoplay, and never calls play()', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const { container } = render(<AudioSection library={controller()} />)
    const audio = container.querySelector('audio')
    expect(audio).not.toBeNull()
    expect(audio?.hasAttribute('controls')).toBe(true)
    expect(audio?.getAttribute('preload')).toBe('none')
    expect(audio?.hasAttribute('autoplay')).toBe(false)
    expect(audio?.getAttribute('src')).toBe(FILE.file_url)
    expect(screen.queryByTestId('audio-offline-state')).toBeNull()
    expect(play).not.toHaveBeenCalled()
  })

  it('renders no player and no list when the song has no audio', () => {
    const { container } = render(<AudioSection library={controller({ files: [] })} />)
    expect(container.querySelector('audio')).toBeNull()
  })

  it('deletes through the controller', () => {
    const library = controller()
    render(<AudioSection library={library} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Backing track' }))
    expect(library.deleteFile).toHaveBeenCalledWith('a-1')
  })

  it('submits the upload form', () => {
    const library = controller({ uploadFile: new File(['x'], 'a.mp3') })
    render(<AudioSection library={library} />)
    fireEvent.click(screen.getByRole('button', { name: 'Upload Audio' }))
    expect(library.submitUpload).toHaveBeenCalled()
  })

  it('shows the upload error', () => {
    render(<AudioSection library={controller({ uploadError: 'Only MP3 and M4A audio files are allowed' })} />)
    expect(screen.getByText('Only MP3 and M4A audio files are allowed')).toBeTruthy()
  })
})

describe('AudioSection offline', () => {
  it('shows "Audio is not available offline" and no audio element', () => {
    const { container } = render(<AudioSection library={controller()} offline readOnly />)
    expect(screen.getByText('Audio is not available offline')).toBeTruthy()
    expect(container.querySelector('audio')).toBeNull()
    expect(screen.getByText('Backing track')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Upload Audio' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
