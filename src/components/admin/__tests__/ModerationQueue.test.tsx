// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'

// The island takes its router from `next/navigation`; every successful review
// calls `refresh()` so the server-rendered queue behind the props is re-read.
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

import { ModerationQueue, type ModerationQueueActions } from '../ModerationQueue'
import type { CatalogSuggestion, PendingCatalogSuggestionGroup } from '@/types/database'
import type { PendingFieldGroup } from '@/types/pendingFieldGroup'

afterEach(cleanup)

beforeEach(() => {
  router.push.mockClear()
  router.refresh.mockClear()
})

const BM_IDS = ['s1', 's2', 's3', 's4', 's5']

/** Layout A fixture: Hotel California has two contested fields, Wonderwall one. */
const FIELDS: PendingFieldGroup[] = [
  {
    song_id: 'song-1',
    song_title: 'Hotel California',
    song_artist: 'Eagles',
    target_column: 'standard_key',
    current_value: 'G',
    total: 6,
    options: [
      {
        value: 'Bm',
        count: 5,
        requesters: ['Maria S.', 'Joao P.', 'Ana L.', 'Rui T.', 'Bia C.'].map((name, i) => ({ id: `u${i}`, name })),
        suggestion_ids: BM_IDS,
        reasons: ['it is Bm'],
      },
      {
        value: 'Am',
        count: 1,
        requesters: [{ id: 'u9', name: 'Carlos D.' }],
        suggestion_ids: ['s6'],
        reasons: [],
      },
    ],
  },
  {
    song_id: 'song-1',
    song_title: 'Hotel California',
    song_artist: 'Eagles',
    target_column: 'album',
    current_value: null,
    total: 1,
    options: [
      { value: null, count: 1, requesters: [{ id: 'u1', name: 'Joao P.' }], suggestion_ids: ['s7'], reasons: [] },
    ],
  },
  {
    song_id: 'song-2',
    song_title: 'Wonderwall',
    song_artist: 'Oasis',
    target_column: 'duration_seconds',
    current_value: 192,
    total: 1,
    options: [
      { value: 258, count: 1, requesters: [{ id: 'u4', name: 'Bia C.' }], suggestion_ids: ['s8'], reasons: [] },
    ],
  },
]

const LINK_GROUP = {
  group_id: 'cccccccc-1111-2222-3333-444444444444',
  song_id: 'song-3',
  requested_by: 'user-3',
  proposed_data: {},
  suggestion_ids: {},
  link_changes: [
    {
      suggestion_id: 's-remove',
      link_id: 'l1',
      column: 'removed',
      value: true,
      current: { url: 'https://tabs.example/bad-1', label: 'Chords' },
    },
    {
      suggestion_id: 's-url',
      link_id: 'l2',
      column: 'url',
      value: 'https://youtu.be/new',
      current: { url: 'https://youtu.be/old', label: 'YouTube' },
    },
    {
      suggestion_id: 's-label',
      link_id: 'l3',
      column: 'label',
      value: 'Spotify (album version)',
      current: { url: 'https://open.spotify.com/track/3', label: 'Spotify' },
    },
  ],
  created_at: '2026-01-04T00:00:00.000Z',
  song: { title: 'Bad', artist: 'Michael Jackson', album: 'Bad', standard_key: 'Am' },
  requester: { full_name: 'Ana', email: 'ana@example.com' },
} as unknown as PendingCatalogSuggestionGroup

type Actions = ModerationQueueActions & {
  approveCatalogFieldOption: ReturnType<typeof vi.fn>
  rejectCatalogField: ReturnType<typeof vi.fn>
  reviewLinkChanges: ReturnType<typeof vi.fn>
}

function makeActions(overrides: Partial<ModerationQueueActions> = {}): Actions {
  return {
    approveCatalogFieldOption: vi.fn().mockResolvedValue({ approved: 5, superseded: 1 }),
    rejectCatalogField: vi.fn().mockResolvedValue(1),
    reviewLinkChanges: vi.fn().mockResolvedValue([] as CatalogSuggestion[]),
    ...overrides,
  } as Actions
}

function setup(props: Partial<React.ComponentProps<typeof ModerationQueue>> = {}) {
  const actions = (props.actions ?? makeActions()) as Actions
  render(
    <ModerationQueue
      initialFields={props.initialFields ?? FIELDS}
      initialLinkGroups={props.initialLinkGroups ?? []}
      initialError={props.initialError ?? null}
      actions={actions}
    />,
  )
  return { actions }
}

const sectionOf = (name: string) => screen.getByRole('region', { name })

describe('ModerationQueue (grouped, one card per song)', () => {
  it('renders one card per song with a section per contested field', () => {
    setup()

    expect(screen.getByText('3 Pending Fields')).toBeDefined()
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Hotel California - Eagles',
      'Wonderwall - Oasis',
    ])
    expect(screen.getByText('2 contested fields')).toBeDefined()
    expect(screen.getByText('1 contested field')).toBeDefined()
    expect(screen.getAllByRole('region')).toHaveLength(3)
    const key = within(sectionOf('Key of Hotel California'))
    expect(key.getByText('current:')).toBeDefined()
    expect(key.getByText('G')).toBeDefined()
    expect(key.getByText('6 requests, 2 options')).toBeDefined()
  })

  it('renders an option row with its value, count badge, requesters and reason', () => {
    setup()

    const key = within(sectionOf('Key of Hotel California'))
    expect(key.getByText('Bm')).toBeDefined()
    expect(key.getByLabelText('5 requests').textContent).toBe('x5')
    expect(key.getByLabelText('5 requests').className).toContain('bg-indigo-600')
    expect(key.getByText('Maria S., Joao P., Ana L., Rui T., Bia C.')).toBeDefined()
    expect(key.getByText(/it is Bm/)).toBeDefined()
    expect(key.getByLabelText('1 requests').className).not.toContain('bg-indigo-600')
    expect(key.getByText('Carlos D.')).toBeDefined()
    // A proposal to clear a field reads "(empty)".
    expect(within(sectionOf('Album of Hotel California')).getAllByText('(empty)')).toHaveLength(2)
  })

  it('approves an option with that option\'s suggestion ids and shows the superseded notice', async () => {
    const { actions } = setup()

    fireEvent.click(within(sectionOf('Key of Hotel California')).getAllByRole('button', { name: 'Approve this' })[0])

    await waitFor(() => expect(actions.approveCatalogFieldOption).toHaveBeenCalledWith(BM_IDS))
    await waitFor(() =>
      expect(screen.getByText(/1 other option closed \(superseded\)/)).toBeDefined(),
    )
    // The decided field leaves; the song's other field and the other song stay.
    expect(screen.queryByRole('region', { name: 'Key of Hotel California' })).toBeNull()
    expect(screen.getByText('2 Pending Fields')).toBeDefined()
    expect(screen.getAllByText('1 contested field')).toHaveLength(2)
    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  it('names several closed options in the plural, and none when nothing was closed', async () => {
    const approve = vi
      .fn()
      .mockResolvedValueOnce({ approved: 1, superseded: 3 })
      .mockResolvedValueOnce({ approved: 1, superseded: 0 })
    setup({ actions: makeActions({ approveCatalogFieldOption: approve }) })

    fireEvent.click(within(sectionOf('Key of Hotel California')).getAllByRole('button', { name: 'Approve this' })[1])
    await waitFor(() => expect(screen.getByText(/3 other options closed \(superseded\)/)).toBeDefined())

    fireEvent.click(within(sectionOf('Duration (s) of Wonderwall')).getByRole('button', { name: 'Approve this' }))
    await waitFor(() => expect(screen.queryByText(/other option/)).toBeNull())
    expect(screen.getByText('Approved and applied to the catalog.')).toBeDefined()
  })

  it('removes the last card and shows the empty state once every field is decided', async () => {
    setup({ initialFields: [FIELDS[2]] })

    fireEvent.click(screen.getByRole('button', { name: 'Approve this' }))

    await waitFor(() => expect(screen.getByText('Queue is empty')).toBeDefined())
    expect(screen.getByText('0 Pending Fields')).toBeDefined()
  })

  it('rejects a whole field with the typed reason', async () => {
    const { actions } = setup()

    fireEvent.click(
      within(sectionOf('Key of Hotel California')).getByRole('button', { name: 'Reject all for this field' }),
    )
    fireEvent.change(screen.getByPlaceholderText('e.g. Inaccurate information or duplicate submission'), {
      target: { value: '  Not the studio key  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Rejection' }))

    await waitFor(() =>
      expect(actions.rejectCatalogField).toHaveBeenCalledWith('song-1', 'standard_key', 'Not the studio key'),
    )
    await waitFor(() => expect(screen.getByText('All proposals for this field rejected.')).toBeDefined())
    expect(screen.queryByRole('region', { name: 'Key of Hotel California' })).toBeNull()
  })

  it('rejects without a reason when the input is blank, and cancel closes the form', async () => {
    const { actions } = setup()
    const reject = () =>
      within(sectionOf('Duration (s) of Wonderwall')).getByRole('button', { name: 'Reject all for this field' })

    fireEvent.click(reject())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Confirm Rejection' })).toBeNull()

    fireEvent.click(reject())
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Rejection' }))

    await waitFor(() =>
      expect(actions.rejectCatalogField).toHaveBeenCalledWith('song-2', 'duration_seconds', undefined),
    )
  })

  it('disables the field\'s buttons while its decision is in flight, not the others\'', async () => {
    let release: (() => void) | undefined
    const actions = makeActions({
      approveCatalogFieldOption: vi.fn(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ approved: 1, superseded: 0 })
          }),
      ),
    })
    setup({ actions })

    fireEvent.click(within(sectionOf('Key of Hotel California')).getAllByRole('button', { name: 'Approve this' })[0])

    await waitFor(() =>
      expect(
        (within(sectionOf('Key of Hotel California')).getAllByRole('button', { name: 'Approve this' })[0] as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    )
    expect(
      (within(sectionOf('Duration (s) of Wonderwall')).getByRole('button', { name: 'Approve this' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)

    release!()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Key of Hotel California' })).toBeNull())
  })

  it('shows an error banner and keeps the field when the action rejects', async () => {
    const actions = makeActions({
      approveCatalogFieldOption: vi
        .fn()
        .mockRejectedValue(new Error('Failed to approve a catalog field option: boom')),
    })
    setup({ actions })

    fireEvent.click(within(sectionOf('Key of Hotel California')).getAllByRole('button', { name: 'Approve this' })[0])

    await waitFor(() =>
      expect(screen.getByText('Failed to approve a catalog field option: boom')).toBeDefined(),
    )
    expect(screen.getByRole('region', { name: 'Key of Hotel California' })).toBeDefined()
    expect(router.refresh).not.toHaveBeenCalled()
  })

  it('says "already reviewed" and drops the stale field', async () => {
    const actions = makeActions({
      approveCatalogFieldOption: vi.fn().mockRejectedValue(new Error('Catalog suggestion is already reviewed')),
    })
    setup({ actions })

    fireEvent.click(within(sectionOf('Key of Hotel California')).getAllByRole('button', { name: 'Approve this' })[0])

    await waitFor(() => expect(screen.getByText('Catalog suggestion is already reviewed')).toBeDefined())
    expect(screen.queryByRole('region', { name: 'Key of Hotel California' })).toBeNull()
  })

  it('drops a stale field when the reject finds it already decided', async () => {
    const actions = makeActions({
      rejectCatalogField: vi.fn().mockRejectedValue(new Error('Catalog suggestion is already reviewed')),
    })
    setup({ actions })

    fireEvent.click(
      within(sectionOf('Key of Hotel California')).getByRole('button', { name: 'Reject all for this field' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Rejection' }))

    await waitFor(() => expect(screen.getByText('Catalog suggestion is already reviewed')).toBeDefined())
    expect(screen.queryByRole('region', { name: 'Key of Hotel California' })).toBeNull()
  })

  it('renders the empty-queue sentence when nothing is pending', () => {
    setup({ initialFields: [] })

    expect(screen.getByText('Queue is empty')).toBeDefined()
    expect(screen.getByText('There are no pending catalog corrections to review right now.')).toBeDefined()
    expect(screen.getByText('0 Pending Fields')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Approve this' })).toBeNull()
  })

  it('renders the initialError prop in an error banner', () => {
    setup({ initialFields: [], initialError: 'Failed to fetch pending field groups: boom' })

    expect(screen.getByRole('alert').textContent).toContain('Failed to fetch pending field groups: boom')
  })

  it('uses the singular for a single pending field', () => {
    setup({ initialFields: [FIELDS[2]] })

    expect(screen.getByText('1 Pending Field')).toBeDefined()
  })
})

/** RH-138 - link rows are decided one by one, per submission. */
describe('ModerationQueue link-row verdicts', () => {
  const linkSetup = () => setup({ initialFields: [], initialLinkGroups: [LINK_GROUP] })

  it('renders a verdict control pair per link row, as rows and not as JSON', () => {
    linkSetup()

    expect(screen.queryByText('Queue is empty')).toBeNull()
    expect(screen.getByText('1 link correction')).toBeDefined()
    expect(screen.getByText('Bad')).toBeDefined()
    expect(screen.getAllByRole('button', { name: /^Accept link change / })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: /^Reject link change / })).toHaveLength(3)
    expect(screen.getByText('Edit URL')).toBeDefined()
    expect(screen.getByText('Spotify (album version)')).toBeDefined()
    expect(screen.queryByText(/\[\{/)).toBeNull()
  })

  it('approves the card with every link accepted by default, and drops it', async () => {
    const { actions } = linkSetup()

    fireEvent.click(screen.getByRole('button', { name: 'Approve & Apply' }))

    await waitFor(() => expect(actions.reviewLinkChanges).toHaveBeenCalledWith(LINK_GROUP.group_id, 'approve'))
    await waitFor(() => expect(screen.getByText('Link changes applied to the catalog.')).toBeDefined())
    expect(screen.getByText('Queue is empty')).toBeDefined()
  })

  it('passes the rejected link rows through while approving the rest, and lets a verdict be undone', async () => {
    const { actions } = linkSetup()

    fireEvent.click(screen.getByRole('button', { name: 'Reject link change 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject link change 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Accept link change 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply verdicts' }))

    await waitFor(() =>
      expect(actions.reviewLinkChanges).toHaveBeenCalledWith(LINK_GROUP.group_id, 'approve', undefined, ['s-remove']),
    )
  })

  it('rejects the submission\'s link rows with the typed reason', async () => {
    const { actions } = linkSetup()

    fireEvent.click(screen.getByRole('button', { name: 'Reject Request' }))
    fireEvent.change(screen.getByPlaceholderText('e.g. Inaccurate information or duplicate submission'), {
      target: { value: 'Duplicate' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Rejection' }))

    await waitFor(() =>
      expect(actions.reviewLinkChanges).toHaveBeenCalledWith(LINK_GROUP.group_id, 'reject', 'Duplicate'),
    )
    await waitFor(() => expect(screen.getByText('Link changes rejected.')).toBeDefined())
  })

  it('shows the busy label while the review is in flight', async () => {
    let release: (() => void) | undefined
    const actions = makeActions({
      reviewLinkChanges: vi.fn(
        () =>
          new Promise<CatalogSuggestion[]>((resolve) => {
            release = () => resolve([])
          }),
      ),
    })
    setup({ actions, initialFields: [], initialLinkGroups: [LINK_GROUP] })

    fireEvent.click(screen.getByRole('button', { name: 'Approve & Apply' }))

    expect(((await screen.findByRole('button', { name: 'Approving...' })) as HTMLButtonElement).disabled).toBe(true)
    release!()
    await waitFor(() => expect(screen.getByText('Queue is empty')).toBeDefined())
  })
})
