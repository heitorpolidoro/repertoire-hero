// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const loadSongs = vi.fn().mockResolvedValue(undefined)

// The store is the form's only other outward dependency; mocking it also keeps
// the Server Action module the real store imports out of the graph.
vi.mock('@/store/repertoireStore', () => ({
  useRepertoireStore: () => ({ loadSongs }),
}))

import { ALL_STATUSES, STATUS_CONFIG } from '@/lib/statusConfig'
import SongForm, { type SongFormActions } from '../SongForm'
import type { Repertoire, RefusedCatalogField } from '@/types/database'

afterEach(cleanup)

// jsdom does not implement HTMLDialogElement.showModal, which the form calls in
// a mount effect.
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true
    },
  })
})

const ENTRY = {
  id: 'rep-1',
  status: 'learning',
  tags: ['rock'],
  personal_key: 'G',
  song: {
    id: 'song-1',
    title: 'Yellow',
    artist: 'Coldplay',
    album: 'Parachutes',
    standard_key: 'B',
    duration_seconds: 269,
    links: [],
  },
} as unknown as Repertoire

/**
 * One song the catalog has filled in only halfway: `title`, `artist` and
 * `duration_seconds` are populated, `album` and `cover_url` are not, and the
 * link list is empty. ER6 reads both cases off this single entry.
 */
const HALF_FILLED = {
  ...ENTRY,
  song: {
    ...ENTRY.song!,
    album: null,
    cover_url: null,
    standard_key: null,
  },
} as unknown as Repertoire

function makeActions(): { [K in keyof SongFormActions]: ReturnType<typeof vi.fn> } {
  return {
    createAndAddSong: vi.fn().mockResolvedValue(ENTRY),
    updateSong: vi.fn().mockResolvedValue({ refused: [] }),
    updateSongStatus: vi.fn().mockResolvedValue(undefined),
    updateSongTags: vi.fn().mockResolvedValue(undefined),
    submitSongEdit: vi.fn().mockResolvedValue({}),
  }
}

function setup(song?: Repertoire, actions = makeActions()) {
  const onClose = vi.fn()
  const onSuccess = vi.fn()
  const utils = render(
    <SongForm
      song={song}
      onClose={onClose}
      onSuccess={onSuccess}
      actions={actions as unknown as SongFormActions}
    />,
  )
  return { ...utils, actions, onClose, onSuccess }
}

beforeEach(() => {
  loadSongs.mockClear()
})

describe('SongForm calls its injected actions (RH-47)', () => {
  it('creates a song through the injected createAndAddSong action', async () => {
    const { actions, onSuccess } = setup()

    expect(screen.getByRole('dialog', { name: 'Add song' })).toBeDefined()
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Yellow' } })
    fireEvent.change(screen.getByLabelText('Artist'), { target: { value: 'Coldplay' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(actions.createAndAddSong).toHaveBeenCalledTimes(1))
    expect(actions.createAndAddSong).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Yellow', artist: 'Coldplay' }),
    )
    expect(actions.updateSongStatus).not.toHaveBeenCalled()
    expect(actions.updateSongTags).not.toHaveBeenCalled()
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
  })

  it('applies the status and tags through their injected actions after creating', async () => {
    const { actions } = setup()

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Yellow' } })
    fireEvent.change(screen.getByLabelText('Artist'), { target: { value: 'Coldplay' } })
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'rock, live' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Learning' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(actions.updateSongStatus).toHaveBeenCalledTimes(1))
    expect(actions.updateSongStatus).toHaveBeenCalledWith('rep-1', 'learning')
    expect(actions.updateSongTags).toHaveBeenCalledWith('rep-1', ['rock', 'live'])
  })

  it('saves an edit through the injected updateSong action', async () => {
    const { actions } = setup(ENTRY)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(actions.updateSong).toHaveBeenCalledTimes(1))
    expect(actions.updateSong).toHaveBeenCalledWith(ENTRY, {
      title: 'Yellow',
      artist: 'Coldplay',
      album: 'Parachutes',
      key: 'G',
      cover_url: null,
      duration_seconds: 269,
      status: 'learning',
      tags: ['rock'],
      links: [],
    })
  })

  it('shows the error message when an injected action rejects', async () => {
    const actions = makeActions()
    actions.createAndAddSong.mockRejectedValue(new Error('Song already in repertoire'))
    const { onSuccess } = setup(undefined, actions)

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Yellow' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(screen.getByText('Song already in repertoire')).toBeDefined(),
    )
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('passes the injected submitSongEdit down to the correction modal', async () => {
    const { actions } = setup(ENTRY)

    fireEvent.click(screen.getByRole('button', { name: /Correct Global Info/ }))
    fireEvent.change(screen.getByLabelText('Artist'), { target: { value: 'Cold Play' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Moderation' }))

    await waitFor(() => expect(actions.submitSongEdit).toHaveBeenCalledTimes(1))
    expect(actions.submitSongEdit).toHaveBeenCalledWith('song-1', {
      artist: 'Cold Play',
      reason: null,
    })
    await waitFor(() =>
      expect(
        screen.getByText('Correction request submitted for admin review!'),
      ).toBeDefined(),
    )
  })
})

/**
 * RH-97 ER6 — the form is a truthful rendering of what the database will take.
 * A populated shared column cannot be overwritten through `updateSong`, so it
 * gets no input at all; an empty one can be filled by anyone, so it keeps one.
 */
describe('edit mode renders a populated shared field read-only (ER6)', () => {
  it('offers no input for the fields the catalog has, and one for the fields it lacks', () => {
    setup(HALF_FILLED)

    for (const label of ['Title', 'Artist', 'Duration']) {
      expect(screen.queryByLabelText(label)).toBeNull()
      expect(
        screen.getByRole('button', { name: `Suggest a correction to ${label}` }),
      ).toBeDefined()
    }

    expect(screen.getByText('Yellow')).toBeDefined()
    expect(screen.getByText('Coldplay')).toBeDefined()

    for (const label of ['Album', 'Cover Image URL']) {
      const input = screen.getByLabelText(label) as HTMLInputElement
      expect(input.tagName).toBe('INPUT')
      expect(input.disabled).toBe(false)
      expect(input.readOnly).toBe(false)
    }
  })

  it('keeps the links fieldset editable while the catalog has no links, and locks it once it has', () => {
    const { unmount } = setup(HALF_FILLED)
    expect(screen.getByRole('button', { name: '+ Add link' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Suggest a correction to Links' })).toBeNull()
    unmount()

    const withLinks = {
      ...HALF_FILLED,
      song: { ...HALF_FILLED.song!, links: [{ label: 'YouTube', url: 'https://youtu.be/rh97' }] },
    } as unknown as Repertoire
    setup(withLinks)

    expect(screen.queryByRole('button', { name: '+ Add link' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Suggest a correction to Links' })).toBeDefined()
  })

  it('keeps the key input editable — it is the owner\'s own key — beside the catalog\'s', () => {
    setup(ENTRY)

    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('G')
    expect(screen.getByText('B')).toBeDefined()
    expect(
      screen.getByRole('button', { name: 'Suggest a correction to the catalog key' }),
    ).toBeDefined()
  })

  it('leaves create mode untouched: every shared field is editable', () => {
    setup()

    for (const label of ['Title', 'Artist', 'Album', 'Duration', 'Cover Image URL']) {
      expect(screen.getByLabelText(label)).toBeDefined()
    }
    expect(screen.queryByRole('button', { name: /Suggest a correction/ })).toBeNull()
  })
})

/** RH-97 ER7 — "Suggest a correction" is the route a read-only field offers. */
describe('"Suggest a correction" opens the correction modal (ER7)', () => {
  it('pre-fills it with the catalog values and sends only the field that changed', async () => {
    const { actions } = setup(ENTRY)

    fireEvent.click(screen.getByRole('button', { name: 'Suggest a correction to Title' }))

    expect((screen.getByLabelText('Song Title') as HTMLInputElement).value).toBe('Yellow')
    expect((screen.getByLabelText('Album') as HTMLInputElement).value).toBe('Parachutes')
    expect((screen.getByLabelText('Standard Key') as HTMLInputElement).value).toBe('B')
    expect((screen.getByLabelText('Duration') as HTMLInputElement).value).toBe('269')

    fireEvent.change(screen.getByLabelText('Song Title'), {
      target: { value: 'Yellow (Live)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Moderation' }))

    await waitFor(() => expect(actions.submitSongEdit).toHaveBeenCalledTimes(1))
    expect(actions.submitSongEdit).toHaveBeenCalledWith('song-1', {
      title: 'Yellow (Live)',
      reason: null,
    })
  })

  it('blocks a submit that changes nothing, visibly, without calling the action', async () => {
    const { actions } = setup(ENTRY)

    fireEvent.click(screen.getByRole('button', { name: 'Suggest a correction to Artist' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Moderation' }))

    await waitFor(() =>
      expect(
        screen.getByText('Change at least one value to suggest a correction.'),
      ).toBeDefined(),
    )
    expect(actions.submitSongEdit).not.toHaveBeenCalled()
  })
})

/**
 * RH-97 ER9 — the backstop. The read-only shape removes the refusal in the
 * normal case, but the form is drawn from a snapshot: a value can become
 * populated between open and save, and that save must not report plain success.
 */
describe('a refused save is reported, not swallowed (ER9)', () => {
  const REFUSED: RefusedCatalogField[] = [
    { column: 'artist', current: 'Michael Jackson', proposed: 'Micheal Jackson' },
    {
      column: 'links',
      current: [{ label: 'YouTube', url: 'https://youtu.be/rh97' }],
      proposed: [
        { label: 'YouTube', url: 'https://youtu.be/rh97' },
        { label: 'Chords', url: 'https://chords.test/rh97' },
      ],
    },
  ]

  const saveWithRefusal = async () => {
    const actions = makeActions()
    actions.updateSong.mockResolvedValue({ refused: REFUSED })
    const rendered = setup(ENTRY, actions)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined())
    return rendered
  }

  it('names each refused column with its current and proposed value, and does not close', async () => {
    const { onSuccess } = await saveWithRefusal()

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Your own changes were saved')
    expect(alert.textContent).toContain('Artist')
    expect(alert.textContent).toContain('catalog has Michael Jackson, you entered Micheal Jackson')
    expect(alert.textContent).toContain('Links')
    expect(alert.textContent).toContain('catalog has 1 link, you entered 2 links')
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('offers a control that opens the correction modal holding the refused values', async () => {
    const { actions } = await saveWithRefusal()

    fireEvent.click(screen.getByRole('button', { name: 'Suggest these as corrections' }))

    expect((screen.getByLabelText('Artist') as HTMLInputElement).value).toBe('Micheal Jackson')
    expect((screen.getByLabelText('URL for link 2') as HTMLInputElement).value).toBe(
      'https://chords.test/rh97',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Submit for Moderation' }))

    await waitFor(() => expect(actions.submitSongEdit).toHaveBeenCalledTimes(1))
    expect(actions.submitSongEdit).toHaveBeenCalledWith('song-1', {
      artist: 'Micheal Jackson',
      links: REFUSED[1].proposed,
      reason: null,
    })
  })
})

/**
 * RH-102 ER11 — the form's status picker keeps all five values.
 *
 * `unknown` left `STATUS_ORDER` because it is zero notes filled rather than a
 * stage, but a row can hold it, so the picker that authors the value has to
 * offer it. It enumerates `ALL_STATUSES` and keeps `STATUS_CONFIG`'s per-status
 * colours; the three greys are the note control's rule, not this one's.
 */
describe('SongForm status picker (RH-102 ER11)', () => {
  it('offers all five statuses, Unknown included, each in its own colour', () => {
    setup()

    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((radio) => radio.value)).toEqual(ALL_STATUSES)

    for (const status of ALL_STATUSES) {
      const cfg = STATUS_CONFIG[status]
      const chip = screen.getByText(cfg.label)
      expect(chip.className).toContain(cfg.bgColor)
      expect(chip.className).toContain(cfg.textColor)
    }
  })

  it('writes the status the musician picked, Unknown included', () => {
    setup()

    const unknown = screen
      .getAllByRole('radio')
      .find((radio) => (radio as HTMLInputElement).value === 'unknown') as HTMLInputElement
    fireEvent.click(unknown)

    expect(unknown.checked).toBe(true)
  })
})
