// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { CorrectionModal } from '../CorrectionModal'
import type { GlobalSong } from '@/types/database'

afterEach(cleanup)

const SONG = {
  id: 'song-1',
  title: 'Yellow',
  artist: 'Coldplay',
  album: 'Parachutes',
  standard_key: 'B',
  duration_seconds: 269,
  links: [],
} as unknown as GlobalSong

function setup(onSubmitCorrection = vi.fn().mockResolvedValue({})) {
  const onClose = vi.fn()
  const onSuccess = vi.fn()
  const utils = render(
    <CorrectionModal
      song={SONG}
      onClose={onClose}
      onSuccess={onSuccess}
      onSubmitCorrection={onSubmitCorrection}
    />,
  )
  return { ...utils, onClose, onSuccess, onSubmitCorrection }
}

describe('CorrectionModal submits through its injected callback (RH-47)', () => {
  it('seeds its fields from the song prop', () => {
    setup()

    // The labels carry no `htmlFor`, so the fields are found by their value.
    expect(screen.getByDisplayValue('Yellow')).toBeDefined()
    expect(screen.getByDisplayValue('Coldplay')).toBeDefined()
    expect(screen.getByDisplayValue('Parachutes')).toBeDefined()
    expect(screen.getByDisplayValue('B')).toBeDefined()
  })

  it('submits the trimmed fields through onSubmitCorrection, then succeeds and closes', async () => {
    const { container, onClose, onSuccess, onSubmitCorrection } = setup()

    fireEvent.change(screen.getByDisplayValue('Yellow'), {
      target: { value: '  Yellow (Live)  ' },
    })
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => expect(onSubmitCorrection).toHaveBeenCalledTimes(1))
    expect(onSubmitCorrection).toHaveBeenCalledWith('song-1', {
      title: 'Yellow (Live)',
      artist: 'Coldplay',
      album: 'Parachutes',
      standard_key: 'B',
      reason: null,
    })
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('refuses to submit when the title is blank', async () => {
    const { container, onSubmitCorrection } = setup()

    fireEvent.change(screen.getByDisplayValue('Yellow'), { target: { value: '   ' } })
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() =>
      expect(screen.getByText('Title and artist are required.')).toBeDefined(),
    )
    expect(onSubmitCorrection).not.toHaveBeenCalled()
  })

  it('shows the failure message when onSubmitCorrection rejects', async () => {
    const { container, onClose } = setup(
      vi.fn().mockRejectedValue(new Error('Song not found')),
    )

    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => expect(screen.getByText('Song not found')).toBeDefined())
    expect(onClose).not.toHaveBeenCalled()
  })
})
