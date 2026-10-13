// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { CorrectionModal, type SongCorrectionInput } from '../CorrectionModal'
import { parseCatalogSuggestionPayload } from '@/lib/catalogSuggestionPayload'
import type { Song } from '@/types/database'

afterEach(cleanup)

const LINK_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_ID = '22222222-2222-4222-8222-222222222222'
const LINK = { id: LINK_ID, label: 'YouTube', url: 'https://youtu.be/rh97' }
const SECOND = { id: SECOND_ID, label: 'Chords', url: 'https://chords.test/yellow' }

const SONG = {
  id: 'song-1',
  title: 'Yellow',
  artist: 'Coldplay',
  album: 'Parachutes',
  standard_key: 'B',
  cover_url: 'https://example.com/yellow.jpg',
  duration_seconds: 269,
  links: [LINK, SECOND],
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
describe('the emitted payload passes the unmodified parseCatalogSuggestionPayload (ER8)', () => {
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

    // The link is addressed by its row id and names only what changed on it.
    expect(payload).toEqual({
      cover_url: 'https://example.com/other.jpg',
      duration_seconds: 270,
      linkChanges: [{ linkId: LINK_ID, label: 'Official video' }],
      reason: 'Better cover',
    })
    expect(parseCatalogSuggestionPayload(payload)).toEqual({
      cover_url: 'https://example.com/other.jpg',
      duration_seconds: 270,
    })
  })

  it('accepts a correction that clears album and key', async () => {
    const { container, onSubmitCorrection } = setup()

    fireEvent.change(screen.getByLabelText('Album'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Standard Key'), { target: { value: '' } })
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => expect(onSubmitCorrection).toHaveBeenCalledTimes(1))
    const payload = emitted(onSubmitCorrection)

    expect(payload).toEqual({ album: null, standard_key: null, reason: null })
    expect(() => parseCatalogSuggestionPayload(payload)).not.toThrow()
  })
})

/** RH-138 — the links block acts per catalog row, keyed by id. */
describe('the links block corrects one catalog row at a time (RH-138)', () => {
  it('renders exactly one control set per catalog row id, and no add-a-link control', () => {
    const { container } = setup()

    const items = container.querySelectorAll('li[data-link-id]')
    expect([...items].map((li) => li.getAttribute('data-link-id'))).toEqual([LINK_ID, SECOND_ID])
    expect(screen.getAllByRole('button', { name: 'Remove this link' })).toHaveLength(2)
    expect(screen.getAllByLabelText(/^URL for link /)).toHaveLength(2)
    expect(screen.getAllByLabelText(/^Label for link /)).toHaveLength(2)
    expect(screen.queryByRole('button', { name: '+ Add link' })).toBeNull()
  })

  it('sends one removal for a removed row and nothing for the untouched one', async () => {
    const { container, onSubmitCorrection } = setup()

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove this link' })[0])
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => expect(onSubmitCorrection).toHaveBeenCalledTimes(1))
    expect(emitted(onSubmitCorrection)).toEqual({
      linkChanges: [{ linkId: LINK_ID, removed: true }],
      reason: null,
    })
  })

  it('lets a removal be undone, after which the form submits nothing', async () => {
    const { container, onSubmitCorrection } = setup()

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove this link' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Undo remove' }))
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() =>
      expect(screen.getByText('Change at least one value to suggest a correction.')).toBeDefined(),
    )
    expect(onSubmitCorrection).not.toHaveBeenCalled()
  })

  it('sends an edited url for its row only', async () => {
    const { container, onSubmitCorrection } = setup()

    fireEvent.change(screen.getByLabelText('URL for link 2'), {
      target: { value: 'https://chords.test/yellow-2' },
    })
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => expect(onSubmitCorrection).toHaveBeenCalledTimes(1))
    expect(emitted(onSubmitCorrection).linkChanges).toEqual([
      { linkId: SECOND_ID, url: 'https://chords.test/yellow-2' },
    ])
  })

  it('focuses the url of the row the caller named', () => {
    setup(vi.fn().mockResolvedValue({}), { focusLinkId: SECOND_ID })

    expect(document.activeElement).toBe(screen.getByLabelText('URL for link 2'))
  })
})
