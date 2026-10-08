// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

// The island takes its router from `next/navigation`; every successful review
// calls `refresh()` so the server-rendered queue behind the props is re-read.
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

import { ModerationQueue, type ModerationQueueActions } from '../ModerationQueue'
import type { CatalogSuggestion, PendingCatalogSuggestionGroup } from '@/types/database'

afterEach(cleanup)

beforeEach(() => {
  router.push.mockClear()
  router.refresh.mockClear()
})

const GROUPS = [
  {
    group_id: 'aaaaaaaa-1111-2222-3333-444444444444',
    song_id: 'song-1',
    requested_by: 'user-1',
    proposed_data: { title: 'Wish You Were Here', standard_key: 'G' },
    created_at: '2026-01-02T00:00:00.000Z',
    song: { title: 'Wish you were here', artist: 'Pink Floyd', album: 'WYWH', standard_key: 'C' },
    requester: { full_name: 'Ada Lovelace', email: 'ada@example.com' },
  },
  {
    group_id: 'bbbbbbbb-1111-2222-3333-444444444444',
    song_id: 'song-2',
    requested_by: 'user-2',
    proposed_data: { artist: 'The Beatles' },
    created_at: '2026-01-03T00:00:00.000Z',
    song: { title: 'Yesterday', artist: 'Beatles', album: 'Help!', standard_key: 'F' },
    requester: { full_name: null, email: 'grace@example.com' },
  },
] as unknown as PendingCatalogSuggestionGroup[]

function makeActions(overrides: Partial<ModerationQueueActions> = {}) {
  return {
    reviewCatalogSuggestionGroup: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as ModerationQueueActions & {
    reviewCatalogSuggestionGroup: ReturnType<typeof vi.fn>
  }
}

function setup(props: Partial<React.ComponentProps<typeof ModerationQueue>> = {}) {
  const actions = (props.actions ?? makeActions()) as ReturnType<typeof makeActions>
  render(
    <ModerationQueue
      initialGroups={props.initialGroups ?? GROUPS}
      initialError={props.initialError ?? null}
      actions={actions}
    />,
  )
  return { actions }
}

describe('ModerationQueue', () => {
  it('renders one card per pending correction from its props', () => {
    setup()

    expect(screen.getByText('2 Pending Requests')).toBeDefined()
    expect(screen.getAllByRole('button', { name: 'Approve & Apply' })).toHaveLength(2)
    expect(screen.getByText('Wish you were here')).toBeDefined()
    expect(screen.getByText('Ada Lovelace')).toBeDefined()
    expect(screen.getByText('grace@example.com')).toBeDefined()
  })

  it('renders the empty-queue panel when there is nothing pending', () => {
    setup({ initialGroups: [] })

    expect(screen.getByText('Queue is empty')).toBeDefined()
    expect(screen.getByText('0 Pending Requests')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Approve & Apply' })).toBeNull()
  })

  it('approves a group through the injected action and removes its card', async () => {
    const { actions } = setup()

    fireEvent.click(screen.getAllByRole('button', { name: 'Approve & Apply' })[0])

    await waitFor(() => expect(actions.reviewCatalogSuggestionGroup).toHaveBeenCalledWith(GROUPS[0].group_id, 'approve'))
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Approve & Apply' })).toHaveLength(1))
    expect(screen.getByText('1 Pending Request')).toBeDefined()
    expect(screen.getByText('Song edit approved and applied to global catalog.')).toBeDefined()
  })

  it('rejects a group with the typed reason through the injected action', async () => {
    const { actions } = setup()

    fireEvent.click(screen.getAllByRole('button', { name: 'Reject Request' })[0])
    fireEvent.change(
      screen.getByPlaceholderText('e.g. Inaccurate information or duplicate submission'),
      { target: { value: '  Duplicate submission  ' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Rejection' }))

    await waitFor(() =>
      expect(actions.reviewCatalogSuggestionGroup).toHaveBeenCalledWith(
        GROUPS[0].group_id,
        'reject',
        'Duplicate submission',
      ),
    )
    await waitFor(() => expect(screen.getByText('Song edit proposal rejected.')).toBeDefined())
    expect(screen.getAllByRole('button', { name: 'Approve & Apply' })).toHaveLength(1)
  })

  it('disables the approve and reject buttons while a review is in flight', async () => {
    let release: (() => void) | undefined
    const actions = makeActions({
      reviewCatalogSuggestionGroup: vi.fn(
        () =>
          new Promise<CatalogSuggestion[]>((resolve) => {
            release = () => resolve([])
          }),
      ),
    })
    setup({ actions })

    fireEvent.click(screen.getAllByRole('button', { name: 'Approve & Apply' })[0])

    const pending = await screen.findByRole('button', { name: 'Approving...' })
    expect((pending as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getAllByRole('button', { name: 'Reject Request' })[0] as HTMLButtonElement).disabled).toBe(true)
    // The second card is untouched.
    expect((screen.getAllByRole('button', { name: 'Approve & Apply' })[0] as HTMLButtonElement).disabled).toBe(false)

    release!()
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Approve & Apply' })).toHaveLength(1))
  })

  it('shows an error banner when the injected review action rejects', async () => {
    const actions = makeActions({
      reviewCatalogSuggestionGroup: vi
        .fn()
        .mockRejectedValue(new Error('Failed to review a catalog suggestion group: boom')),
    })
    setup({ actions })

    fireEvent.click(screen.getAllByRole('button', { name: 'Approve & Apply' })[0])

    await waitFor(() =>
      expect(screen.getByText('Failed to review a catalog suggestion group: boom')).toBeDefined(),
    )
    // Nothing was removed optimistically.
    expect(screen.getAllByRole('button', { name: 'Approve & Apply' })).toHaveLength(2)
    expect(router.refresh).not.toHaveBeenCalled()
  })

  it('renders the initialError prop in an error banner', () => {
    setup({
      initialGroups: [],
      initialError: 'Failed to fetch pending catalog suggestions: boom',
    })

    const banner = screen.getByRole('alert')
    expect(banner.textContent).toContain('Failed to fetch pending catalog suggestions: boom')
  })

  it('refreshes the router after a successful review', async () => {
    const { actions } = setup()

    fireEvent.click(screen.getAllByRole('button', { name: 'Approve & Apply' })[0])

    await waitFor(() => expect(actions.reviewCatalogSuggestionGroup).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1))
    expect(router.push).not.toHaveBeenCalled()
  })

  it('renders a two-column correction as one card and approves it by group id', async () => {
    // RH-107: the table is per-column, the queue is per-group. The grouped
    // projection hands this component one `proposed_data` object per
    // submission, so a correction naming two columns is still one card with two
    // diff lines — and the action it calls takes the card's `group_id`, not a
    // per-field suggestion id.
    const { actions } = setup({ initialGroups: [GROUPS[0]] })

    expect(screen.getAllByRole('button', { name: 'Approve & Apply' })).toHaveLength(1)
    expect(screen.getByText('Wish You Were Here')).toBeDefined()
    expect(screen.getByText('G')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Approve & Apply' }))

    await waitFor(() =>
      expect(actions.reviewCatalogSuggestionGroup).toHaveBeenCalledTimes(1),
    )
    expect(actions.reviewCatalogSuggestionGroup).toHaveBeenCalledWith(
      'aaaaaaaa-1111-2222-3333-444444444444',
      'approve',
    )
  })
})
