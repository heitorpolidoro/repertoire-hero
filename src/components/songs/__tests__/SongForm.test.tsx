// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const loadSongs = vi.fn().mockResolvedValue(undefined)

// The store is the form's only other outward dependency; mocking it also keeps
// the Server Action module the real store imports out of the graph.
vi.mock('@/store/repertoireStore', () => ({
  useRepertoireStore: () => ({ loadSongs }),
}))

import SongForm, { type SongFormActions } from '../SongForm'
import type { Repertoire } from '@/types/database'

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

function makeActions(): { [K in keyof SongFormActions]: ReturnType<typeof vi.fn> } {
  return {
    createAndAddSong: vi.fn().mockResolvedValue(ENTRY),
    updateSong: vi.fn().mockResolvedValue(undefined),
    updateSongStatus: vi.fn().mockResolvedValue(undefined),
    updateSongTags: vi.fn().mockResolvedValue(undefined),
    submitGlobalSongEdit: vi.fn().mockResolvedValue({}),
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

  it('passes the injected submitGlobalSongEdit down to the correction modal', async () => {
    const { actions } = setup(ENTRY)

    fireEvent.click(screen.getByRole('button', { name: /Correct Global Info/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Moderation' }))

    await waitFor(() => expect(actions.submitGlobalSongEdit).toHaveBeenCalledTimes(1))
    expect(actions.submitGlobalSongEdit).toHaveBeenCalledWith('song-1', {
      title: 'Yellow',
      artist: 'Coldplay',
      album: 'Parachutes',
      standard_key: 'B',
      reason: null,
    })
    await waitFor(() =>
      expect(
        screen.getByText('Correction request submitted for admin review!'),
      ).toBeDefined(),
    )
  })
})
