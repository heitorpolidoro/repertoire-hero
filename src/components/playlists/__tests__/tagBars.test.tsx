// @vitest-environment jsdom
/**
 * RH-69 — the two tag bars of `/playlists/[id]`: the playlist's own editable
 * bar (`PlaylistTagBar`, which renders the shared `TagEditRow`) and the tag
 * filter above the song list (`TagFilterBar`).
 *
 * Both are small sibling surfaces of the same page, so they share one test
 * file, the way `src/components/ui/__tests__/feedbackSurfaces.test.tsx` covers
 * `Toast` and `AlertBanner` together.
 *
 * Neither component decides anything about persistence: the bar is handed a
 * stub `TagEditorController` of `vi.fn()`s and the filter a plain `onChange`,
 * so nothing here imports a Server Action. Between them these tests pin the
 * locators `e2e/playlist-detail.spec.ts` uses on this slice — a button named
 * exactly `Add tag to playlist` as a direct child of the bar wrapper (the spec
 * reaches the bar by `xpath=..` off it), the `new tag` placeholder,
 * `Remove tag <tag>` per chip, a filter button named exactly the tag, and the
 * `clear` control.
 */

import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PlaylistTagBar } from '@/components/playlists/PlaylistTagBar'
import { TagFilterBar } from '@/components/playlists/TagFilterBar'
import type { TagEditorController } from '@/hooks/useTagEditor'
import type { Playlist } from '@/types/database'

afterEach(cleanup)

type EditorSpies = {
  open: Mock
  close: Mock
  changeDraft: Mock
  commitDraft: Mock
  removeTag: Mock
}

function editor(overrides: Partial<TagEditorController> = {}): TagEditorController & EditorSpies {
  return {
    openFor: null,
    draft: '',
    inputRef: { current: null },
    open: vi.fn(),
    close: vi.fn(),
    changeDraft: vi.fn(),
    commitDraft: vi.fn().mockResolvedValue(undefined),
    removeTag: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as TagEditorController & EditorSpies
}

function playlist(overrides: Partial<Playlist> = {}): Playlist {
  return {
    id: 'playlist-1',
    user_id: 'user-1',
    band_id: null,
    name: 'Set one',
    description: null,
    cover_url: null,
    spotify_playlist_id: null,
    sync_with_spotify: false,
    last_synced_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    tags: ['encore', 'fast'],
    ...overrides,
  }
}

/** The bar wrapper, reached exactly as the e2e spec reaches it: `xpath=..`. */
function tagBar(): HTMLElement {
  return screen.getByRole('button', { name: 'Add tag to playlist', exact: true })
    .parentElement as HTMLElement
}

describe('PlaylistTagBar', () => {
  it('renders one chip per playlist tag, each with its Remove tag button', () => {
    render(
      <PlaylistTagBar playlist={playlist()} currentUserId="user-1" editor={editor()} />,
    )

    const bar = tagBar()
    expect(within(bar).getAllByRole('button', { name: /^Remove tag / })).toHaveLength(2)
    expect(within(bar).getByRole('button', { name: 'Remove tag encore' })).toBeDefined()
    expect(within(bar).getByRole('button', { name: 'Remove tag fast' })).toBeDefined()
    expect(bar.textContent).toContain('encore')
  })

  it('calls the editor to remove a playlist tag when the chip button is clicked', () => {
    const control = editor()
    render(
      <PlaylistTagBar playlist={playlist()} currentUserId="user-1" editor={control} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove tag encore' }))

    expect(control.removeTag).toHaveBeenCalledWith('playlist-1', 'encore')
  })

  it('opens the editor for the playlist when Add tag to playlist is clicked', () => {
    const control = editor()
    render(
      <PlaylistTagBar playlist={playlist()} currentUserId="user-1" editor={control} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add tag to playlist', exact: true }))

    expect(control.open).toHaveBeenCalledWith('playlist-1')
  })

  it('renders the new tag input only while the editor is open for the playlist', () => {
    const closed = render(
      <PlaylistTagBar
        playlist={playlist()}
        currentUserId="user-1"
        editor={editor({ openFor: 'some-song' })}
      />,
    )
    expect(screen.queryByPlaceholderText('new tag')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add tag to playlist' })).toBeDefined()
    closed.unmount()

    render(
      <PlaylistTagBar
        playlist={playlist()}
        currentUserId="user-1"
        editor={editor({ openFor: 'playlist-1', draft: 'slow' })}
      />,
    )
    expect(screen.getAllByPlaceholderText('new tag')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Add tag to playlist' })).toBeNull()
  })

  it('commits the draft on Enter and on blur, and closes it on Escape', () => {
    const control = editor({ openFor: 'playlist-1', draft: 'slow' })
    render(
      <PlaylistTagBar playlist={playlist()} currentUserId="user-1" editor={control} />,
    )

    const input = screen.getByPlaceholderText('new tag')
    fireEvent.change(input, { target: { value: 'slower' } })
    expect(control.changeDraft).toHaveBeenCalledWith('slower')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(control.commitDraft).toHaveBeenCalledWith('playlist-1')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(control.close).toHaveBeenCalledTimes(1)

    fireEvent.blur(input)
    expect(control.commitDraft).toHaveBeenCalledTimes(2)
  })

  it('renders nothing for a personal playlist owned by another user', () => {
    const { container } = render(
      <PlaylistTagBar
        playlist={playlist({ band_id: null, user_id: 'someone-else' })}
        currentUserId="user-1"
        editor={editor()}
      />,
    )

    expect(container.innerHTML).toBe('')
  })

  it('renders the bar for a band playlist', () => {
    render(
      <PlaylistTagBar
        playlist={playlist({ band_id: 'band-9', user_id: null })}
        currentUserId="user-1"
        editor={editor()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Add tag to playlist' })).toBeDefined()
  })

  it('renders the bar for a personal playlist the signed-in user owns', () => {
    render(
      <PlaylistTagBar
        playlist={playlist({ band_id: null, user_id: 'user-1' })}
        currentUserId="user-1"
        editor={editor()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Add tag to playlist' })).toBeDefined()
  })
})

describe('TagFilterBar', () => {
  it('renders nothing when the playlist carries no tag', () => {
    const { container } = render(
      <TagFilterBar tags={[]} activeTag={null} onChange={vi.fn()} />,
    )

    expect(container.innerHTML).toBe('')
  })

  it('renders one filter button per tag, named exactly the tag', () => {
    render(
      <TagFilterBar tags={['encore', 'fast']} activeTag={null} onChange={vi.fn()} />,
    )

    expect(screen.getByRole('button', { name: 'encore', exact: true })).toBeDefined()
    expect(screen.getByRole('button', { name: 'fast', exact: true })).toBeDefined()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('selects a tag when its filter button is clicked', () => {
    const onChange = vi.fn()
    render(<TagFilterBar tags={['encore', 'fast']} activeTag={null} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'fast', exact: true }))

    expect(onChange).toHaveBeenCalledWith('fast')
  })

  it('clears the filter when the active tag button is clicked again', () => {
    const onChange = vi.fn()
    render(<TagFilterBar tags={['encore', 'fast']} activeTag="fast" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'fast', exact: true }))

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('renders the clear control only while a tag is active and clears the filter when it is clicked', () => {
    const onChange = vi.fn()
    const inactive = render(
      <TagFilterBar tags={['encore']} activeTag={null} onChange={onChange} />,
    )
    expect(screen.queryByRole('button', { name: /clear/ })).toBeNull()
    inactive.unmount()

    render(<TagFilterBar tags={['encore']} activeTag="encore" onChange={onChange} />)
    const clear = screen.getByRole('button', { name: /clear/ })

    fireEvent.click(clear)

    expect(onChange).toHaveBeenCalledWith(null)
  })
})
