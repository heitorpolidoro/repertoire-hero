// @vitest-environment jsdom
/**
 * RH-111 — the dashboard mounts the page-built outcome banner under its header.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import RepertoireDashboard, { type RepertoireDashboardActions } from '../RepertoireDashboard'

vi.mock('@/app/actions/repertoire', () => ({
  getRepertoireAction: vi.fn().mockResolvedValue([]),
  removeSongAction: vi.fn(),
  updateSongStatusAction: vi.fn(),
}))

afterEach(cleanup)

const ACTIONS = {
  createAndAddSong: vi.fn(),
  addSong: vi.fn(),
  searchSongs: vi.fn().mockResolvedValue([]),
  updateSong: vi.fn(),
  updateSongStatus: vi.fn(),
  updateSongTags: vi.fn(),
  submitCatalogSuggestion: vi.fn(),
  getBandRole: vi.fn(),
} as unknown as RepertoireDashboardActions

describe('RepertoireDashboard outcome banner slot (RH-111)', () => {
  it('renders the supplied banner', () => {
    render(<RepertoireDashboard actions={ACTIONS} outcomeBanner={<p>outcome banner here</p>} />)

    expect(screen.getByText('outcome banner here')).toBeTruthy()
  })

  it('renders without one', () => {
    render(<RepertoireDashboard actions={ACTIONS} />)

    expect(screen.queryByText('outcome banner here')).toBeNull()
    expect(screen.getByText('My Repertoire')).toBeTruthy()
  })
})
