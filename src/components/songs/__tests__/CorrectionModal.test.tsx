// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { CorrectionModal, type SongCorrectionInput } from '../CorrectionModal'
import { parseSongEditPayload } from '@/lib/songEditPayload'
import type { Song } from '@/types/database'

afterEach(cleanup)

const LINK = { label: 'YouTube', url: 'https://youtu.be/rh97' }

const SONG = {
  id: 'song-1',
  title: 'Yellow',
  artist: 'Coldplay',
  album: 'Parachutes',
  standard_key: 'B',
  cover_url: 'https://example.com/yellow.jpg',
  duration_seconds: 269,
  links: [LINK],
} as unknown as Song

function setup(
  onSubmitCorrection = vi.fn().mockResolvedValue({}),
  props: Partial<React.ComponentProps<typeof CorrectionModal>> = {},
) {
  const onClose = vi.fn()
  const onSuccess = vi.fn()
  const utils = render(
    <CorrectionModal
      song={SONG}
      onClose={onClose}
      onSuccess={onSuccess}
      onSubmitCorrection={onSubmitCorrection}
      {...props}
    />,
  )
  return { ...utils, onClose, onSuccess, onSubmitCorrection }
}

/** The value an input currently shows. There is no jest-dom in this repo. */
function valueOf(label: string): string {
  return (screen.getByLabelText(label) as HTMLInputElement).value
}

/** The payload the modal emitted, as the Server Action would receive it. */
function emitted(mock: ReturnType<typeof vi.fn>): SongCorrectionInput {
  return mock.mock.calls[0][1]
}

describe('CorrectionModal submits through its injected callback (RH-47)', () => {
  it('seeds every shared field from the song prop (ER8)', () => {
    setup()

    expect(valueOf('Song Title')).toBe('Yellow')
    expect(valueOf('Artist')).toBe('Coldplay')
    expect(valueOf('Album')).toBe('Parachutes')
    expect(valueOf('Standard Key')).toBe('B')
    expect(valueOf('Cover Image URL')).toBe('https://example.com/yellow.jpg')
    expect(valueOf('Duration')).toBe('269')
    expect(valueOf('URL for link 1')).toBe(LINK.url)
  })

  it('sends only the field that changed, plus the reason', async () => {
    const { container, onClose, onSuccess, onSubmitCorrection } = setup()

    fireEvent.change(screen.getByLabelText('Song Title'), {
      target: { value: '  Yellow (Live)  ' },
    })
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => expect(onSubmitCorrection).toHaveBeenCalledTimes(1))
    expect(onSubmitCorrection).toHaveBeenCalledWith('song-1', {
      title: 'Yellow (Live)',
      reason: null,
    })
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('blocks a submit that changes nothing, and calls nothing', async () => {
    const { container, onSubmitCorrection } = setup()

    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() =>
      expect(
        screen.getByText('Change at least one value to suggest a correction.'),
      ).toBeDefined(),
    )
    expect(onSubmitCorrection).not.toHaveBeenCalled()
  })

  it('refuses to submit when the title is blank', async () => {
    const { container, onSubmitCorrection } = setup()

    fireEvent.change(screen.getByLabelText('Song Title'), { target: { value: '   ' } })
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() =>
      expect(screen.getByText('Title and artist are required.')).toBeDefined(),
    )
    expect(onSubmitCorrection).not.toHaveBeenCalled()
  })

  it('shows the failure message when onSubmitCorrection rejects', async () => {
    const { container, onClose } = setup(vi.fn().mockRejectedValue(new Error('Song not found')))

    fireEvent.change(screen.getByLabelText('Artist'), { target: { value: 'Cold Play' } })
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => expect(screen.getByText('Song not found')).toBeDefined())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('opens holding the prefilled values, which count as changes', async () => {
    const { container, onSubmitCorrection } = setup(vi.fn().mockResolvedValue({}), {
      prefill: { artist: 'Cold Play' },
    })

    expect(valueOf('Artist')).toBe('Cold Play')
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => expect(onSubmitCorrection).toHaveBeenCalledTimes(1))
    expect(onSubmitCorrection).toHaveBeenCalledWith('song-1', {
      artist: 'Cold Play',
      reason: null,
    })
  })

  it('focuses the field the caller named', () => {
    setup(vi.fn().mockResolvedValue({}), { focusField: 'cover_url' })

    expect(document.activeElement).toBe(screen.getByLabelText('Cover Image URL'))
  })
})

/**
 * ER8 — the three fields the modal grew (`cover_url`, `duration_seconds`,
 * `links`) have to be acceptable to the queue's validator, which this task does
 * not change. The real parser is run against the real emitted payload rather
 * than a hand-written literal, so the two cannot drift apart.
 */
describe('the emitted payload passes the unmodified parseSongEditPayload (ER8)', () => {
  it('accepts a correction to cover_url, duration_seconds and links at once', async () => {
    const { container, onSubmitCorrection } = setup()

    fireEvent.change(screen.getByLabelText('Cover Image URL'), {
      target: { value: 'https://example.com/other.jpg' },
    })
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '4:30' } })
    fireEvent.change(screen.getByLabelText('Label for link 1'), {
      target: { value: 'Official video' },
    })
    fireEvent.change(screen.getByLabelText('Reason / Notes for Admin (Optional)'), {
      target: { value: 'Better cover' },
    })
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => expect(onSubmitCorrection).toHaveBeenCalledTimes(1))
    const payload = emitted(onSubmitCorrection)

    expect(payload).toEqual({
      cover_url: 'https://example.com/other.jpg',
      duration_seconds: 270,
      links: [{ label: 'Official video', url: LINK.url }],
      reason: 'Better cover',
    })
    expect(parseSongEditPayload(payload)).toEqual({
      cover_url: 'https://example.com/other.jpg',
      duration_seconds: 270,
      links: [{ label: 'Official video', url: LINK.url }],
    })
  })

  it('accepts a correction that clears album and key, and one that adds a link', async () => {
    const { container, onSubmitCorrection } = setup()

    fireEvent.change(screen.getByLabelText('Album'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Standard Key'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add link' }))
    fireEvent.change(screen.getByLabelText('URL for link 2'), {
      target: { value: 'https://chords.test/yellow' },
    })
    fireEvent.change(screen.getByLabelText('Label for link 2'), { target: { value: 'Chords' } })
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => expect(onSubmitCorrection).toHaveBeenCalledTimes(1))
    const payload = emitted(onSubmitCorrection)

    expect(payload).toEqual({
      album: null,
      standard_key: null,
      links: [LINK, { label: 'Chords', url: 'https://chords.test/yellow' }],
      reason: null,
    })
    expect(() => parseSongEditPayload(payload)).not.toThrow()
  })
})
