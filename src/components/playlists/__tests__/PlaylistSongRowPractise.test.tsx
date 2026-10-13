// @vitest-environment jsdom
/**
 * RH-158 — the per-song "Practised" button on a playlist row.
 *
 * The row only calls injected handlers: a tap writes the date, a successful
 * write reveals the level control, a level choice is a status-only call.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PlaylistSongRow, type PlaylistSongRowProps } from '@/components/playlists/PlaylistSongRow'
import type { TagEditorController } from '@/hooks/useTagEditor'
import type { PlaylistSong } from '@/types/database'

afterEach(cleanup)

const PLAYLIST_SONG: PlaylistSong = {
  id: 'ps-v1',
  playlist_id: 'pl-1',
  version_id: 'v1',
  position: 1,
  label: null,
  song: {
    id: 'song-1',
    title: 'Kashmir',
    artist: 'Led Zeppelin',
    album: null,
    standard_key: null,
    cover_url: null,
    duration_seconds: null,
    links: [],
    created_at: '2026-01-01T00:00:00.000Z',
  },
}

const TAG_EDITOR = {
  openFor: null,
  draft: '',
  inputRef: { current: null },
  open: vi.fn(),
  close: vi.fn(),
  changeDraft: vi.fn(),
  commitDraft: vi.fn(async () => {}),
  removeTag: vi.fn(async () => {}),
} satisfies TagEditorController

function setup(overrides: Partial<PlaylistSongRowProps> = {}) {
  const props: PlaylistSongRowProps = {
    playlistSong: PLAYLIST_SONG,
    bandId: null,
    tagEditor: TAG_EDITOR,
    onStatusChange: vi.fn().mockResolvedValue(undefined),
    onRemoveSong: vi.fn().mockResolvedValue(undefined),
    onPractise: vi.fn().mockResolvedValue(true),
    onPractiseStatus: vi.fn().mockResolvedValue(undefined),
    onOpenFastView: vi.fn(),
    ...overrides,
  }
  render(
    <ul>
      <PlaylistSongRow {...props} />
    </ul>,
  )
  return props
}

const practised = () => screen.getByRole('button', { name: 'Mark Kashmir as practised' })

describe('PlaylistSongRow practised button', () => {
  it('calls the handler with the version id, then reveals the level control', async () => {
    const props = setup()
    expect(screen.getAllByRole('group', { name: 'Mastery status' })).toHaveLength(1)

    fireEvent.click(practised())

    await waitFor(() => expect(screen.getAllByRole('group', { name: 'Mastery status' })).toHaveLength(2))
    expect(props.onPractise).toHaveBeenCalledWith('v1')
    expect(screen.queryByRole('button', { name: 'Mark Kashmir as practised' })).toBeNull()
  })

  it('choosing a level calls the status-only handler and closes the control', async () => {
    const props = setup()
    fireEvent.click(practised())
    await waitFor(() => expect(screen.getAllByRole('group', { name: 'Mastery status' })).toHaveLength(2))

    const revealed = screen.getAllByRole('group', { name: 'Mastery status' })[1]
    fireEvent.click(within(revealed).getAllByRole('button')[1])

    expect(props.onPractiseStatus).toHaveBeenCalledWith('v1', 'practicing')
    expect(props.onStatusChange).not.toHaveBeenCalled()
    expect(screen.getAllByRole('group', { name: 'Mastery status' })).toHaveLength(1)
    expect(practised()).toBeDefined()
  })

  it('dismissing leaves the status alone', async () => {
    const props = setup()
    fireEvent.click(practised())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dismiss level for Kashmir' })).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss level for Kashmir' }))

    expect(props.onPractiseStatus).not.toHaveBeenCalled()
    expect(screen.getAllByRole('group', { name: 'Mastery status' })).toHaveLength(1)
  })

  it('a failed date write does not reveal the level control', async () => {
    const props = setup({ onPractise: vi.fn().mockResolvedValue(false) })

    fireEvent.click(practised())

    await waitFor(() => expect(props.onPractise).toHaveBeenCalledWith('v1'))
    await waitFor(() => expect((practised() as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getAllByRole('group', { name: 'Mastery status' })).toHaveLength(1)
  })

  it('on a band playlist the revealed level control is read-only', async () => {
    const props = setup({ bandId: 'band-1' })
    fireEvent.click(practised())
    await waitFor(() => expect(screen.getAllByRole('group', { name: 'Mastery status' })).toHaveLength(2))

    const revealed = screen.getAllByRole('group', { name: 'Mastery status' })[1]
    for (const note of within(revealed).getAllByRole('button')) {
      expect((note as HTMLButtonElement).disabled).toBe(true)
    }
    expect(props.onPractise).toHaveBeenCalledWith('v1')
  })
})
