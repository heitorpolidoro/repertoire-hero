// @vitest-environment jsdom
/**
 * RH-159 — the header's "Review practice" entry point and its panel state.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PlaylistDetailHeader } from '@/components/playlists/PlaylistDetailHeader'
import { NO_PANEL, playlistPanelReducer } from '@/lib/playlistPanels'
import type { Playlist } from '@/types/database'

afterEach(cleanup)

const PLAYLIST = {
  id: 'pl',
  user_id: 'u',
  band_id: null,
  name: 'Set one',
  cover_url: null,
  spotify_playlist_id: null,
  sync_with_spotify: false,
  last_synced_at: null,
} as unknown as Playlist

function renderHeader(onReviewPractice?: () => void) {
  render(
    <PlaylistDetailHeader
      playlist={PLAYLIST}
      panel={NO_PANEL}
      dispatch={vi.fn()}
      syncing={false}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onSync={vi.fn()}
      canReorder={false}
      reordering={false}
      onToggleReorder={vi.fn()}
      onReviewPractice={onReviewPractice}
    />,
  )
}

describe('Review practice entry point', () => {
  it('shows a button that calls the callback', () => {
    const open = vi.fn()
    renderHeader(open)
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Review practice' }))
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('is hidden when no callback is given (empty playlist)', () => {
    renderHeader()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.queryByRole('menuitem', { name: 'Review practice' })).toBeNull()
  })

  it('the panel reducer opens the review and close leaves it', () => {
    const open = playlistPanelReducer(NO_PANEL, { type: 'open-practice-review' })
    expect(open).toEqual({ kind: 'practice-review' })
    expect(playlistPanelReducer(open, { type: 'close' })).toEqual(NO_PANEL)
  })
})
