// @vitest-environment jsdom
/**
 * RH-156 - the /admin/catalog island, driven with injected fake actions. The
 * router is mocked (push / refresh are the only seams), nothing else is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { CatalogSearchResult } from '@/types/database'
import type { CatalogAdminActions } from '@/lib/catalogAdminPlan'

const { pushSpy, refreshSpy } = vi.hoisted(() => ({ pushSpy: vi.fn(), refreshSpy: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushSpy, refresh: refreshSpy }),
}))

import { CatalogAdmin } from '../CatalogAdmin'

afterEach(cleanup)

function version(id: string, label: string | null) {
  return {
    versionId: id,
    label,
    durationSeconds: null,
    createdAt: null,
    albumName: null,
    albumType: null,
    albumCoverUrl: null,
    releaseDate: null,
  }
}

const SONG_A = {
  id: 'song-a',
  title: 'Bad',
  artist: 'Michael Jackson',
  version_id: 'v1',
  versions: [version('v1', 'Studio'), version('v2', 'Live'), version('v3', 'Remaster')],
} as unknown as CatalogSearchResult

const SONG_B = {
  id: 'song-b',
  title: 'Bad (dup)',
  artist: 'Michael Jackson',
  version_id: 'v4',
  versions: [version('v4', 'Original')],
} as unknown as CatalogSearchResult

const RADII: Record<string, { repertoires: number; playlists: number }> = {
  v1: { repertoires: 2, playlists: 1 },
  v2: { repertoires: 0, playlists: 0 },
  v3: { repertoires: 1, playlists: 0 },
  v4: { repertoires: 0, playlists: 0 },
}

function makeActions(overrides: Partial<CatalogAdminActions> = {}): CatalogAdminActions {
  return {
    getBlastRadius: vi.fn(async (target) =>
      'versionId' in target ? RADII[target.versionId] : { repertoires: 3, playlists: 2 },
    ),
    mergeSongVersions: vi.fn(async () => {}),
    deleteSongVersion: vi.fn(async () => {}),
    splitSongVersions: vi.fn(async () => {}),
    mergeSongs: vi.fn(async () => {}),
    ...overrides,
  }
}

function mutating(a: CatalogAdminActions) {
  return [a.mergeSongVersions, a.deleteSongVersion, a.splitSongVersions, a.mergeSongs]
}

async function openSongA(actions: CatalogAdminActions) {
  render(<CatalogAdmin query="bad" songs={[SONG_A, SONG_B]} actions={actions} />)
  const card = screen.getByRole('region', { name: 'Bad' })
  fireEvent.click(within(card).getByRole('button', { name: 'Open' }))
  await waitFor(() => expect(screen.queryByText('Loading counts...')).toBeNull())
  return card
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('search', () => {
  it('shows a hint without a query and navigates with ?q on submit', () => {
    render(<CatalogAdmin query="" songs={[]} actions={makeActions()} />)
    expect(screen.getByText(/Search for a song/)).toBeDefined()

    fireEvent.change(screen.getByLabelText('Search songs'), { target: { value: ' bad boy ' } })
    fireEvent.submit(screen.getByRole('search'))
    expect(pushSpy).toHaveBeenCalledWith('/admin/catalog?q=bad%20boy')

    fireEvent.change(screen.getByLabelText('Search songs'), { target: { value: '  ' } })
    fireEvent.submit(screen.getByRole('search'))
    expect(pushSpy).toHaveBeenLastCalledWith('/admin/catalog')
  })

  it('says so when nothing matches', () => {
    render(<CatalogAdmin query="zzz" songs={[]} actions={makeActions()} />)
    expect(screen.getByText(/No songs match/)).toBeDefined()
  })
})

describe('blast radius', () => {
  it('lists the versions of an opened song with the counts the action returned', async () => {
    const actions = makeActions()
    await openSongA(actions)

    expect(screen.getAllByTestId('catalog-version-row')).toHaveLength(3)
    expect(screen.getByText('0 repertoires · 0 playlists')).toBeDefined()
    expect(actions.getBlastRadius).toHaveBeenCalledWith({ versionId: 'v1' })
    expect(actions.getBlastRadius).toHaveBeenCalledWith({ versionId: 'v2' })
    expect(actions.getBlastRadius).toHaveBeenCalledWith({ versionId: 'v3' })
  })

  it('closes a card again', async () => {
    const card = await openSongA(makeActions())
    fireEvent.click(within(card).getByRole('button', { name: 'Close' }))
    expect(screen.queryAllByTestId('catalog-version-row')).toHaveLength(0)
  })
})

describe('delete', () => {
  it('is enabled only for a loaded 0/0 version', async () => {
    await openSongA(makeActions())
    expect((screen.getByRole('button', { name: 'Delete Live' }) as HTMLButtonElement).disabled).toBe(false)
    const studio = screen.getByRole('button', { name: 'Delete Studio' }) as HTMLButtonElement
    expect(studio.disabled).toBe(true)
    expect(studio.title).toMatch(/referenced/)
    expect((screen.getByRole('button', { name: 'Delete Remaster' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('is disabled while loading and when the counts failed', async () => {
    const never = new Promise<never>(() => {})
    const actions = makeActions({
      getBlastRadius: vi.fn((target) =>
        'versionId' in target && target.versionId === 'v2'
          ? never
          : Promise.reject(new Error('boom')),
      ),
    })
    render(<CatalogAdmin query="bad" songs={[SONG_A]} actions={actions} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))

    await screen.findAllByText(/Counts unavailable: boom/)
    const live = screen.getByRole('button', { name: 'Delete Live' }) as HTMLButtonElement
    expect(live.disabled).toBe(true)
    expect(live.title).toMatch(/loading/)
    const studio = screen.getByRole('button', { name: 'Delete Studio' }) as HTMLButtonElement
    expect(studio.disabled).toBe(true)
    expect(studio.title).toMatch(/could not/)
  })

  it('confirms with the zero counts, then deletes and refreshes', async () => {
    const actions = makeActions()
    await openSongA(actions)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Live' }))
    expect(screen.getByRole('alertdialog').textContent).toContain(
      '0 repertoires and 0 playlists reference this version',
    )
    expect(actions.deleteSongVersion).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete version' }))
    await waitFor(() => expect(refreshSpy).toHaveBeenCalledTimes(1))
    expect(actions.deleteSongVersion).toHaveBeenCalledWith('v2')
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('shows the server refusal and does not refresh', async () => {
    const actions = makeActions({
      deleteSongVersion: vi.fn(async () => {
        throw new Error('A pending suggestion targets this version')
      }),
    })
    await openSongA(actions)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Live' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete version' }))

    expect((await screen.findByRole('alert')).textContent).toContain('A pending suggestion')
    expect(refreshSpy).not.toHaveBeenCalled()
  })
})

describe('merge versions', () => {
  async function reviewMerge(actions: CatalogAdminActions) {
    await openSongA(actions)
    fireEvent.click(screen.getAllByRole('button', { name: 'Merge into...' })[0])
    fireEvent.change(screen.getByLabelText('Merge target'), { target: { value: 'v2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review merge' }))
  }

  it('names the counts before anything is called and cancel calls nothing', async () => {
    const actions = makeActions()
    await reviewMerge(actions)

    const panel = screen.getByRole('alertdialog')
    expect(panel.textContent).toContain('2 repertoires and 1 playlist')
    expect(panel.textContent).toContain('Studio')
    expect(panel.textContent).toContain('Live')
    mutating(actions).forEach((fn) => expect(fn).not.toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    mutating(actions).forEach((fn) => expect(fn).not.toHaveBeenCalled())
    expect(refreshSpy).not.toHaveBeenCalled()
  })

  it('confirming merges source into target and refreshes', async () => {
    const actions = makeActions()
    await reviewMerge(actions)
    fireEvent.click(screen.getByRole('button', { name: 'Merge versions' }))

    await waitFor(() => expect(refreshSpy).toHaveBeenCalledTimes(1))
    expect(actions.mergeSongVersions).toHaveBeenCalledWith('v1', 'v2')
    expect(await screen.findByText('Versions merged')).toBeDefined()
  })

  it('keeps Review disabled until a target is chosen', async () => {
    await openSongA(makeActions())
    fireEvent.click(screen.getAllByRole('button', { name: 'Merge into...' })[0])
    expect((screen.getByRole('button', { name: 'Review merge' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows a rejection and does not refresh', async () => {
    const actions = makeActions({
      mergeSongVersions: vi.fn(async () => {
        throw new Error('Versions belong to different songs')
      }),
    })
    await reviewMerge(actions)
    fireEvent.click(screen.getByRole('button', { name: 'Merge versions' }))

    expect((await screen.findByRole('alert')).textContent).toContain('different songs')
    expect(refreshSpy).not.toHaveBeenCalled()
  })

  it('falls back to a generic message for a non-Error rejection', async () => {
    const actions = makeActions({ mergeSongVersions: vi.fn(() => Promise.reject('nope')) })
    await reviewMerge(actions)
    fireEvent.click(screen.getByRole('button', { name: 'Merge versions' }))
    expect((await screen.findByRole('alert')).textContent).toContain('The operation failed')
  })
})

describe('split', () => {
  async function startSplit(actions: CatalogAdminActions) {
    await openSongA(actions)
    fireEvent.click(screen.getByRole('button', { name: 'Split...' }))
  }

  it('is disabled when every version is ticked and says why', async () => {
    await startSplit(makeActions())
    for (const name of ['Studio', 'Live', 'Remaster']) {
      fireEvent.click(screen.getByLabelText(`Select ${name}`))
    }
    expect((screen.getByRole('button', { name: 'Review split' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/use Merge song into/)).toBeDefined()
  })

  it('names the summed counts with "up to" and splits onto a new song', async () => {
    const actions = makeActions()
    await startSplit(actions)
    fireEvent.click(screen.getByLabelText('Select Studio'))
    fireEvent.click(screen.getByLabelText('Select Remaster'))
    fireEvent.change(screen.getByLabelText('New song title'), { target: { value: ' Bad Live ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review split' }))

    const panel = screen.getByRole('alertdialog')
    expect(panel.textContent).toContain('2 versions')
    expect(panel.textContent).toContain('up to 3 repertoires and 1 playlist')
    mutating(actions).forEach((fn) => expect(fn).not.toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Split versions' }))
    await waitFor(() => expect(refreshSpy).toHaveBeenCalledTimes(1))
    expect(actions.splitSongVersions).toHaveBeenCalledWith('song-a', ['v1', 'v3'], {
      new: { artist: 'Michael Jackson', title: 'Bad Live' },
    })
  })

  it('splits onto an existing song from the results', async () => {
    const actions = makeActions()
    await startSplit(actions)
    fireEvent.click(screen.getByLabelText('Select Live'))
    fireEvent.click(screen.getByLabelText('Existing song', { selector: 'input' }))
    const review = screen.getByRole('button', { name: 'Review split' }) as HTMLButtonElement
    expect(review.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Existing song', { selector: 'select' }), {
      target: { value: 'song-b' },
    })
    fireEvent.click(review)
    expect(screen.getByRole('alertdialog').textContent).toContain('Bad (dup)')

    fireEvent.click(screen.getByRole('button', { name: 'Split versions' }))
    await waitFor(() => expect(actions.splitSongVersions).toHaveBeenCalledWith('song-a', ['v2'], { songId: 'song-b' }))
  })

  it('requires an artist and title for a new song, and untick works', async () => {
    await startSplit(makeActions())
    fireEvent.click(screen.getByLabelText('Select Live'))
    fireEvent.change(screen.getByLabelText('New song artist'), { target: { value: ' ' } })
    expect((screen.getByRole('button', { name: 'Review split' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('New song artist'), { target: { value: 'MJ' } })
    expect((screen.getByRole('button', { name: 'Review split' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByLabelText('Select Live'))
    expect((screen.getByRole('button', { name: 'Review split' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('cancel on the confirmation calls nothing', async () => {
    const actions = makeActions()
    await startSplit(actions)
    fireEvent.click(screen.getByLabelText('Select Live'))
    fireEvent.click(screen.getByRole('button', { name: 'Review split' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    mutating(actions).forEach((fn) => expect(fn).not.toHaveBeenCalled())
  })
})

describe('merge songs', () => {
  async function reviewSongMerge(actions: CatalogAdminActions) {
    await openSongA(actions)
    fireEvent.click(screen.getByRole('button', { name: 'Merge song into...' }))
    const review = screen.getByRole('button', { name: 'Review merge' }) as HTMLButtonElement
    expect(review.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Merge song target'), { target: { value: 'song-b' } })
    fireEvent.click(review)
  }

  it('fetches the song-level radius, names it, and merges on confirm', async () => {
    const actions = makeActions()
    await reviewSongMerge(actions)

    const panel = await screen.findByRole('alertdialog')
    expect(panel.textContent).toContain('3 repertoires and 2 playlists')
    expect(actions.getBlastRadius).toHaveBeenCalledWith({ songId: 'song-a' })
    mutating(actions).forEach((fn) => expect(fn).not.toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Merge songs' }))
    await waitFor(() => expect(refreshSpy).toHaveBeenCalledTimes(1))
    expect(actions.mergeSongs).toHaveBeenCalledWith('song-a', 'song-b')
  })

  it('offers no confirm while the radius is loading or failed', async () => {
    const actions = makeActions({
      getBlastRadius: vi.fn((target) =>
        'songId' in target ? Promise.reject(new Error('radius down')) : Promise.resolve(RADII.v1),
      ),
    })
    await reviewSongMerge(actions)

    expect(await screen.findByText(/Counts unavailable: radius down/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Merge songs' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    mutating(actions).forEach((fn) => expect(fn).not.toHaveBeenCalled())
  })

  it('shows a loading line while the radius is pending', async () => {
    const actions = makeActions({
      getBlastRadius: vi.fn((target) =>
        'songId' in target ? new Promise<never>(() => {}) : Promise.resolve(RADII.v1),
      ),
    })
    await reviewSongMerge(actions)
    expect(screen.getAllByText('Loading counts...').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Merge songs' })).toBeNull()
  })
})
