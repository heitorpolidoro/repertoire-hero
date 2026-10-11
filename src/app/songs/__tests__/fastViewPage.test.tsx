// @vitest-environment jsdom
/**
 * RH-132 ER9 / ER10 — the Fast View page, rendered.
 *
 * Every other suite in this change drives one controller or one component. None
 * of them can show the thing RH-132 actually introduced: a route addressed by a
 * `song_versions.id` whose *owner holds no row*, which must render completely
 * and write nothing. That is a property of the page's wiring — one `readOnly`
 * expression threaded to five components, and a guard behind each disabled
 * control — so it is asserted here, at the page.
 *
 * Follows the `src/app/join/__tests__/joinPage.test.tsx` precedent: the suite
 * sits one level above the bracketed segment, so no glob has to cope with
 * `[versionId]`, and the page's one composition root
 * (`@/app/fastViewOfflineActions`) is mocked so the six bundles are spies.
 * Mocking that module is also what keeps the server-action graph — and the `pg`
 * pool behind it — out of a jsdom test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { ResolvedSongEntry, SongFile } from '@/types/database'

const ROUTE_VERSION_ID = 'version-on-the-route'
const BAND_ID = 'band-7'
/** Deliberately different from the route's version id — ER10 pins that apart. */
const OWNER_ROW_ID = 'owner-row-42'

const actions = {
  getResolvedEntryForVersion: vi.fn(),
  getPersonalEntryForSong: vi.fn(),
  updateStatus: vi.fn(),
  updateLinks: vi.fn(),
  fetchUrlTitle: vi.fn(),
  updateLyrics: vi.fn(),
  fetchLyrics: vi.fn(),
  addSong: vi.fn(),
  getTabs: vi.fn(),
  uploadTab: vi.fn(),
  deleteTab: vi.fn(),
  getAnnotations: vi.fn(),
  saveAnnotations: vi.fn(),
}

/**
 * The six bundles, as spies.
 *
 * Each bundle object is built **once**, which is the stable identity the real
 * composition root gets from its module-scope constants (F21): a fresh object
 * per property read would restart `useSongEntry`'s load effect on every render,
 * and the entry would be refetched indefinitely.
 *
 * The methods are wrapper arrows rather than the spies themselves, because this
 * factory runs while the hoisted `import FastViewPage` is being resolved —
 * before the `actions` declaration above is initialized. Referencing the spies
 * from inside a function body defers that read to call time.
 */
vi.mock('@/app/fastViewOfflineActions', () => {
  const call =
    (name: keyof typeof actions) =>
    (...args: unknown[]) =>
      actions[name](...args)

  return {
    OFFLINE_FIRST_SONG_ENTRY_ACTIONS: {
      getResolvedEntryForVersion: call('getResolvedEntryForVersion'),
      getPersonalEntryForSong: call('getPersonalEntryForSong'),
    },
    OFFLINE_FIRST_SONG_STATUS_ACTIONS: { updateStatus: call('updateStatus') },
    OFFLINE_FIRST_SONG_LINKS_ACTIONS: {
      updateLinks: call('updateLinks'),
      fetchUrlTitle: call('fetchUrlTitle'),
    },
    OFFLINE_FIRST_LYRICS_EDITOR_ACTIONS: {
      updateLyrics: call('updateLyrics'),
      fetchLyrics: call('fetchLyrics'),
      addSong: call('addSong'),
    },
    OFFLINE_FIRST_TAB_LIBRARY_ACTIONS: {
      getTabs: call('getTabs'),
      uploadTab: call('uploadTab'),
      deleteTab: call('deleteTab'),
    },
    OFFLINE_FIRST_PDF_STAGE_ACTIONS: {
      getAnnotations: call('getAnnotations'),
      saveAnnotations: call('saveAnnotations'),
    },
  }
})

// PDF Stage Mode hangs off `FastViewOverlays`, and its stage pulls in
// `react-pdf`, whose `pdfjs-dist` dependency touches `DOMMatrix` at module load
// — which jsdom has no implementation of. Mocked for exactly that reason, as
// `offlineReadOnlyControls.test.tsx` and `TabDrawingStage.test.tsx` already do.
// Nothing here opens the stage, so the mock never has to behave.
vi.mock('react-pdf', () => ({
  Document: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
}))

vi.mock('@/lib/pdfWorker', () => ({}))

const searchParams = new URLSearchParams()
const push = vi.fn()
const back = vi.fn()

vi.mock('next/navigation', () => ({
  useParams: () => ({ versionId: ROUTE_VERSION_ID }),
  useSearchParams: () => searchParams,
  useRouter: () => ({ push, back }),
}))

// The page reads the offline signal exactly once; every test here is online, so
// `readOnly` is driven only by `ownerRowId` — which is the point.
vi.mock('@/hooks/useOfflineStatus', () => ({ useOfflineStatus: () => false }))
vi.mock('@/hooks/useWakeLock', () => ({ useWakeLock: () => undefined }))

import FastViewPage from '../[versionId]/fast-view/page'
import { writeSongQueue } from '@/lib/songQueue'

afterEach(cleanup)

/** The version's own values, inherited because no owner row overrides them. */
const INHERITED: Omit<ResolvedSongEntry, 'ownerRowId' | 'status' | 'tags'> = {
  song_id: 'song-1',
  version_id: ROUTE_VERSION_ID,
  key: 'F#m',
  tuning: 'Drop D',
  lyrics: 'the words that live on the version',
  map: null,
  last_practiced: null,
  song: {
    id: 'song-1',
    title: 'Spoonman',
    artist: 'Soundgarden',
    album: 'Superunknown',
    standard_key: 'A',
    cover_url: null,
    duration_seconds: 246,
    links: [{ label: 'Chords', url: 'https://cifraclub.com.br/spoonman' }],
    created_at: '2026-01-01T00:00:00.000Z',
  },
}

/** The owner holds no row at this version: ER9's whole subject. */
const NO_OWNER_ROW: ResolvedSongEntry = {
  ...INHERITED,
  ownerRowId: null,
  status: null,
  tags: [],
}

/** The owner holds a row, at an id that is not the route's version id. */
const WITH_OWNER_ROW: ResolvedSongEntry = {
  ...INHERITED,
  ownerRowId: OWNER_ROW_ID,
  status: 'learning',
  tags: ['encore'],
}

const TAB: SongFile = {
  id: 'tab-1',
  user_id: 'user-1',
  song_id: 'song-1',
  title: 'Spoonman chart',
  file_url: 'https://store.public.blob.vercel-storage.com/tabs/tab-1.pdf',
  created_at: '2026-05-01T00:00:00Z',
  content_type: 'application/pdf',
}

beforeEach(() => {
  for (const spy of Object.values(actions)) spy.mockReset()
  sessionStorage.clear()
  searchParams.delete('bandId')
  actions.getResolvedEntryForVersion.mockResolvedValue(NO_OWNER_ROW)
  actions.getPersonalEntryForSong.mockResolvedValue(null)
  actions.getTabs.mockResolvedValue([TAB])
  actions.updateStatus.mockResolvedValue(undefined)
  actions.updateLinks.mockResolvedValue({ success: true })
  actions.updateLyrics.mockResolvedValue(undefined)
  actions.getAnnotations.mockResolvedValue({ data: {} })
  push.mockReset()
  back.mockReset()
})

/**
 * Renders and waits for the entry load to settle out of the loading state.
 *
 * The `waitFor` budget is explicit and generous for the reason
 * `complexityBudget.test.ts` records for its own timeouts (RH-59): this suite
 * mounts the **whole** Fast View tree — seven controllers, the setlist, the
 * file library and the overlays — fourteen times, which costs ~3.8 s of test
 * time isolated but several times that under full-suite parallel load, against
 * `waitFor`'s 1000 ms default. A healthy guard that flakes on a loaded machine
 * is worse than no guard, so the margin is stated rather than left implicit.
 */
async function renderPage() {
  const view = render(<FastViewPage />)
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Spoonman' })).toBeDefined(), {
    timeout: 20_000,
  })
  return view
}

/** The four mastery notes, in order. */
function masteryNotes(): HTMLButtonElement[] {
  return within(screen.getByLabelText('Mastery status')).getAllByRole(
    'button',
  ) as HTMLButtonElement[]
}

function sectionButton(section: string, name: RegExp | string): HTMLButtonElement {
  return within(screen.getByLabelText(section)).getByRole('button', {
    name,
  }) as HTMLButtonElement
}

/**
 * ER9 — a version the addressed owner holds no row at.
 *
 * The page before RH-132 could not reach this state at all: the route carried
 * an owner row id, so there was always a row. It renders completely, at version
 * defaults, with every write control disabled — and the assertions below check
 * both halves, because a disabled control whose handler would still fire is the
 * defect this guards.
 */
describe('Fast View at a version with no owner row (RH-132 ER9)', { timeout: 30_000 }, () => {
  it('reads the entry by the route version id and the query band id', async () => {
    searchParams.set('bandId', BAND_ID)

    await renderPage()

    expect(actions.getResolvedEntryForVersion).toHaveBeenCalledWith(ROUTE_VERSION_ID, BAND_ID)
  })

  it('renders the title and the artist', async () => {
    await renderPage()

    expect(screen.getByRole('heading', { name: 'Spoonman' })).toBeDefined()
    expect(screen.getByText('Soundgarden')).toBeDefined()
  })

  it('renders the inherited key and the inherited lyrics', async () => {
    await renderPage()

    // Both come from the version, because no owner row overrides either: the
    // key line through `songIdentity`, the lyrics through the editor's
    // displayed text. `tuning` is NOT asserted here — Fast View renders no
    // tuning field at all (`SongIdentityHeader` prints title, artist and key),
    // which predates RH-132 and is unchanged by it.
    expect(screen.getByText('F#m')).toBeDefined()
    expect(screen.getByText('the words that live on the version')).toBeDefined()
  })

  it('loads the entry exactly once, so the bundles keep a stable identity (F21)', async () => {
    await renderPage()

    expect(actions.getResolvedEntryForVersion).toHaveBeenCalledTimes(1)
  })

  it('reads the mastery status as unknown', async () => {
    await renderPage()

    expect(within(screen.getByLabelText('Mastery status')).getByText('Unknown')).toBeDefined()
  })

  it('renders no tag chip at all', async () => {
    await renderPage()

    expect(screen.queryByLabelText('Tags')).toBeNull()
  })

  it('renders the file library', async () => {
    await renderPage()

    expect(screen.getByLabelText('Tabs')).toBeDefined()
    await waitFor(() => expect(screen.getByText('Spoonman chart')).toBeDefined())
    // Keyed by the song id, never by the route's version (RH-123 holds).
    expect(actions.getTabs).toHaveBeenCalledWith('song-1')
  })

  it('disables the mastery status control, the lyrics editor, the link controls and the tab upload', async () => {
    await renderPage()

    for (const note of masteryNotes()) expect(note.disabled).toBe(true)
    expect(sectionButton('Lyrics', /^Edit$/).disabled).toBe(true)
    expect(sectionButton('Links', /Add Link/i).disabled).toBe(true)
    expect(sectionButton('Links', 'Delete link').disabled).toBe(true)
    expect(sectionButton('Tabs', /Upload/i).disabled).toBe(true)
  })

  it('writes nothing when every disabled control is activated anyway', async () => {
    await renderPage()

    // `fireEvent.click` on a disabled button dispatches nothing, so each
    // handler is also invoked directly where the control owns one — the point
    // is that no action is reachable, not merely that the pixels are grey.
    for (const note of masteryNotes()) fireEvent.click(note)
    fireEvent.click(sectionButton('Lyrics', /^Edit$/))
    fireEvent.click(sectionButton('Links', /Add Link/i))
    fireEvent.click(sectionButton('Links', 'Delete link'))
    fireEvent.click(sectionButton('Tabs', /Upload/i))

    expect(actions.updateStatus).not.toHaveBeenCalled()
    expect(actions.updateLinks).not.toHaveBeenCalled()
    expect(actions.updateLyrics).not.toHaveBeenCalled()
    expect(actions.addSong).not.toHaveBeenCalled()
    expect(actions.uploadTab).not.toHaveBeenCalled()
    expect(actions.deleteTab).not.toHaveBeenCalled()
  })

  it('never reports the page as not found', async () => {
    await renderPage()

    expect(screen.queryByText(/Song not found/i)).toBeNull()
    expect(screen.queryByText(/not available offline/i)).toBeNull()
  })
})

/**
 * ER10 — the owner *does* hold a row, in band context.
 *
 * `ownerRowId` is deliberately neither the route's `versionId` nor the band id,
 * so each of the three arguments of the status write is pinned to a value only
 * one source can have produced.
 */
describe('Fast View at a version the band holds (RH-132 ER10)', { timeout: 30_000 }, () => {
  beforeEach(() => {
    searchParams.set('bandId', BAND_ID)
    actions.getResolvedEntryForVersion.mockResolvedValue(WITH_OWNER_ROW)
  })

  it('enables the write controls', async () => {
    await renderPage()

    for (const note of masteryNotes()) expect(note.disabled).toBe(false)
    expect(sectionButton('Lyrics', /^Edit$/).disabled).toBe(false)
    expect(sectionButton('Links', /Add Link/i).disabled).toBe(false)
    expect(sectionButton('Links', 'Delete link').disabled).toBe(false)
  })

  it('writes a tapped mastery note with all three arguments pinned', async () => {
    await renderPage()

    // The third note sets `polishing`; its own label states the outcome.
    const target = masteryNotes()[2]
    expect(target.getAttribute('aria-label')).toBe('Set status to Polishing')
    fireEvent.click(target)

    await waitFor(() => expect(actions.updateStatus).toHaveBeenCalledTimes(1))
    const call = actions.updateStatus.mock.calls[0]
    expect(call).toHaveLength(3)
    expect(call[0]).toBe(OWNER_ROW_ID)
    expect(call[1]).toBe('polishing')
    expect(call[2]).toBe(BAND_ID)
    // Never the route's version id, in any position.
    expect(call).not.toContain(ROUTE_VERSION_ID)
    // And never a missing band id, which would resolve the owner as the user.
    expect(call[2]).not.toBeNull()
    expect(call[2]).not.toBeUndefined()
  })

  it('renders the tags the owner row carries', async () => {
    await renderPage()

    expect(within(screen.getByLabelText('Tags')).getByText('encore')).toBeDefined()
  })

  it('still reads the personal entry by song id, never by the route version id', async () => {
    await renderPage()

    await waitFor(() => expect(actions.getPersonalEntryForSong).toHaveBeenCalled())
    expect(actions.getPersonalEntryForSong).toHaveBeenCalledWith('song-1')
    expect(actions.getPersonalEntryForSong).not.toHaveBeenCalledWith(ROUTE_VERSION_ID)
  })
})

/**
 * RH-133 ER4 — Back, and the absence of setlist chrome, at the page.
 *
 * The controller's own suite drives the queue directly; what only the page can
 * show is that the rendered Back button is wired to it and that a song opened
 * alone renders no setlist pixels at all.
 */
describe('Fast View and the tab song queue (RH-133 ER4)', { timeout: 30_000 }, () => {
  function seedQueue(originHref: string) {
    writeSongQueue({
      entries: [
        { versionId: ROUTE_VERSION_ID, title: 'Spoonman', artist: 'Soundgarden' },
        { versionId: 'next-version', title: 'Black Hole Sun', artist: 'Soundgarden' },
      ],
      owner: { type: 'personal' },
      originHref,
      label: 'Saturday gig',
    })
  }

  function pressBack() {
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  }

  it('pushes the recorded playlist origin when Back is pressed', async () => {
    seedQueue('/playlists/pl-1')
    await renderPage()

    pressBack()

    expect(push).toHaveBeenCalledWith('/playlists/pl-1')
    expect(back).not.toHaveBeenCalled()
  })

  it('pushes a recorded non-playlist origin when Back is pressed', async () => {
    seedQueue('/bands/band-7')
    await renderPage()

    pressBack()

    expect(push).toHaveBeenCalledWith('/bands/band-7')
    expect(back).not.toHaveBeenCalled()
  })

  it('walks browser history back when there is no queue', async () => {
    await renderPage()

    pressBack()

    expect(back).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
  })

  it('renders no setlist chrome at all for a song opened with no queue', async () => {
    await renderPage()

    expect(screen.queryByLabelText(/setlist/i)).toBeNull()
    // The mobile pill, the position indicator and the desktop sidebar: every
    // surface that would name a place in a setlist.
    expect(screen.queryByText(/Setlist \(/)).toBeNull()
    expect(screen.queryByText(/^\d+ \/ \d+$/)).toBeNull()
    expect(document.querySelector('aside')).toBeNull()
  })

  /**
   * RH-133 round 2 — the regression the first round shipped. One tab: a
   * playlist writes a queue, the musician goes back and opens a song from the
   * dashboard instead. That song is opened alone, so it must carry neither the
   * playlist's chrome nor its Back target, even though the queue is still in
   * `sessionStorage`.
   */
  it('renders no chrome and walks history back for a route the stale queue does not hold', async () => {
    writeSongQueue({
      entries: [
        { versionId: 'other-version-1', title: 'Spoonman', artist: 'Soundgarden' },
        { versionId: 'other-version-2', title: 'Black Hole Sun', artist: 'Soundgarden' },
      ],
      owner: { type: 'band', bandId: 'band-stale' },
      originHref: '/playlists/pl-1',
      label: 'Saturday gig',
    })
    await renderPage()

    expect(screen.queryByLabelText(/setlist/i)).toBeNull()
    expect(screen.queryByText(/Setlist \(/)).toBeNull()
    expect(screen.queryByText('Saturday gig')).toBeNull()
    expect(document.querySelector('aside')).toBeNull()

    pressBack()

    expect(back).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
  })

  it('renders the setlist label and position when the tab holds a queue', async () => {
    seedQueue('/playlists/pl-1')
    await renderPage()

    expect(screen.getByText(/Setlist \(1\/2\)/)).toBeDefined()
    expect(screen.getAllByText('Saturday gig').length).toBeGreaterThan(0)
  })
})
