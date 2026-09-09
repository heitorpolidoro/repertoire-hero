// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

// The island takes its router from `next/navigation`; the create path calls
// both `refresh()` (invalidate the Server Component read) and `push()`.
const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}))

// Canvas/FileReader compression is browser-only and out of scope here: the test
// only needs the picked file to reach the upload action.
vi.mock('@/lib/imageCompressor', () => ({
  compressImageFile: vi.fn(async (file: File) => file),
}))

import { BandsView, type BandsViewActions } from '../BandsView'
import { DEFAULT_BAND_COLOR } from '@/lib/bandColors'
import type { Band } from '@/types/database'

afterEach(cleanup)

beforeAll(() => {
  // jsdom implements neither of these; the cover preview needs both.
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:cover-preview'),
  })
})

beforeEach(() => {
  push.mockClear()
  refresh.mockClear()
})

const BANDS = [
  { id: 'band-1', name: 'The Rolling Stones', description: 'London', cover_url: null },
  { id: 'band-2', name: 'Pink Floyd', description: null, cover_url: null },
] as unknown as Band[]

function makeActions(overrides: Partial<BandsViewActions> = {}) {
  return {
    createBand: vi.fn().mockResolvedValue('band-9'),
    uploadBandCover: vi.fn().mockResolvedValue({ coverUrl: 'https://blob/cover.jpg' }),
    ...overrides,
  } as unknown as BandsViewActions & {
    createBand: ReturnType<typeof vi.fn>
    uploadBandCover: ReturnType<typeof vi.fn>
  }
}

function setup(props: Partial<React.ComponentProps<typeof BandsView>> = {}) {
  const actions = (props.actions ?? makeActions()) as ReturnType<typeof makeActions>
  render(
    <BandsView
      bands={props.bands ?? BANDS}
      initialError={props.initialError ?? null}
      actions={actions}
    />,
  )
  return { actions }
}

/** Opens the create form and fills the required band name. */
function openCreateForm(name = 'New Band') {
  fireEvent.click(screen.getByRole('button', { name: '+ New Band' }))
  fireEvent.change(screen.getByPlaceholderText('The Rolling Stones'), {
    target: { value: name },
  })
}

describe('BandsView', () => {
  it('renders one row per band from its props', () => {
    setup()

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('The Rolling Stones')).toBeDefined()
    expect(screen.getByText('Pink Floyd')).toBeDefined()
    expect(screen.getByText('London')).toBeDefined()
  })

  it('renders the empty state when the band list prop is empty', () => {
    setup({ bands: [] })

    expect(screen.getByText('No bands yet')).toBeDefined()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('never renders a loading placeholder', () => {
    setup({ bands: [] })

    expect(screen.queryByText(/Loading bands/i)).toBeNull()
  })

  it('creates a band through the injected action and navigates to it', async () => {
    const { actions } = setup()

    openCreateForm('Wish You Were Here')
    fireEvent.click(screen.getByRole('button', { name: 'Create Band' }))

    await waitFor(() => expect(actions.createBand).toHaveBeenCalledTimes(1))
    expect(actions.createBand).toHaveBeenCalledWith(
      'Wish You Were Here',
      null,
      null,
      DEFAULT_BAND_COLOR,
    )
    expect(actions.uploadBandCover).not.toHaveBeenCalled()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/bands/band-9'))
  })

  it('refreshes the router before navigating after a successful create', async () => {
    setup()

    openCreateForm()
    fireEvent.click(screen.getByRole('button', { name: 'Create Band' }))

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(push.mock.invocationCallOrder[0])
  })

  it('disables the submit button while the create action is pending', async () => {
    let release: ((id: string) => void) | undefined
    const actions = makeActions({
      createBand: vi.fn(() => new Promise<string>((resolve) => { release = resolve })),
    })
    setup({ actions })

    openCreateForm()
    fireEvent.click(screen.getByRole('button', { name: 'Create Band' }))

    const pending = await screen.findByRole('button', { name: 'Creating...' })
    expect((pending as HTMLButtonElement).disabled).toBe(true)

    release!('band-9')
    await waitFor(() => expect(push).toHaveBeenCalled())
  })

  it('surfaces the upload envelope error without calling createBand', async () => {
    const actions = makeActions({
      uploadBandCover: vi.fn().mockResolvedValue({ error: 'Image size exceeds 5MB limit' }),
    })
    setup({ actions })

    openCreateForm()
    const file = new File(['x'], 'cover.png', { type: 'image/png' })
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByAltText('Cover preview')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Create Band' }))

    await waitFor(() => expect(screen.getByText('Image size exceeds 5MB limit')).toBeDefined())
    expect(actions.uploadBandCover).toHaveBeenCalledTimes(1)
    expect(actions.createBand).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('renders the initialError prop in the create form', () => {
    setup({ initialError: 'Failed to fetch bands: connection refused' })

    fireEvent.click(screen.getByRole('button', { name: '+ New Band' }))

    expect(screen.getByText('Failed to fetch bands: connection refused')).toBeDefined()
  })
})
